import {connectionWriteKey} from '../connection-write-policy';
import {IdentityError,assertCurrentIdentity,identityPredicate,type IdentityPrincipal,type IdentityPolicy} from './authority';

type Scope={db:D1Database;principal:IdentityPrincipal;policy:IdentityPolicy;closure:ClosureAdmission};
/** `refuse` (every ordinary workspace route): a closing account's batches abort atomically. `permit` is only for the
 * WH-018 account lifecycle surface (closure status/resume and export), which must keep working while the account closes. */
export type ClosureAdmission='refuse'|'permit';
const scopes=new WeakMap<object,Scope>();
/** Internal maintenance entry points must never accept customer workspace authority. */
export function assertMaintenanceDatabase(db:D1Database){if(scopes.has(db))throw new Error('Platform maintenance authority is required.');}
const unavailable=()=>new IdentityError(401,'proof_required','Sign in with your current passkey to continue.');
const changed=()=>new IdentityError(409,'identity_changed','Your account access changed. Sign in again and review the current state before continuing.');
const accountClosing=()=>new IdentityError(409,'account_closing','This account is closing. Only closure status and your account export remain available.');
function scope(db:object,userId?:string){
 const value=scopes.get(db);
 if(!value||(userId!==undefined&&value.principal.accountId!==userId))throw unavailable();
 return value;
}

/** The HTTP boundary supplies a resolved capability, never an account ID as authority.
 * Every domain statement runs in the SAME transaction as a current-identity assertion.
 * Domain SQL still owns resource, feature, revision and exact-review authorization.
 * Background maintenance deliberately receives its own raw DB, not this user scope. */
export function admitWorkspace(db:D1Database,principal:IdentityPrincipal,closure:ClosureAdmission='refuse'):D1Database{
 if(closure!=='refuse'&&closure!=='permit')throw unavailable();
 const context:Scope={db,principal,policy:{purpose:'workspace',freshPasskey:false,bindIdentityRevision:false},closure};
 identityPredicate(db,principal,context.policy); // Refuse cloned, restricted or foreign-DB capabilities.
 const statements=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 async function batch<T=unknown>(input:D1PreparedStatement[]):Promise<D1Result<T>[]> {
  const underlying=input.map(statement=>{const original=statements.get(statement);if(!original)throw unavailable();return original;});
  const gate=identityPredicate(db,principal,context.policy);
  // This inserts zero rows on success. The always-empty table's abort trigger
  // rejects the whole batch on failure; no check/write race or durable guard rows.
  // WH-018 stop-new-work rides the same statement (denied=2 aborts as account_closing) so a closure committed between
  // requests or mid-flow, such as a delayed OAuth callback, refuses every later ordinary batch inside its own
  // transaction, and a read-only batch still issues no write other than this always-empty assertion.
  const closing=context.closure==='refuse'?' OR EXISTS(SELECT 1 FROM account_closures WHERE account_id=?)':'';
  const check=db.prepare(`INSERT INTO identity_admission_checks(denied) SELECT CASE WHEN NOT (${gate.sql}) THEN 1 ELSE 2 END WHERE NOT (${gate.sql})${closing}`).bind(...gate.params,...gate.params,...(closing?[principal.accountId]:[]));
  try{return (await db.batch<T>([check,...underlying])).slice(1);}
  catch(error){if(String(error).includes('identity_admission_denied'))throw changed();if(String(error).includes('account_closing'))throw accountClosing();throw error;}
 }
 function statement(original:D1PreparedStatement):D1PreparedStatement{
  const wrapped:D1PreparedStatement={
   bind:(...values)=>statement(original.bind(...values)),
   async first<T=unknown>(column?:string):Promise<T|null>{
    const row=(await batch<Record<string,unknown>>([wrapped]))[0].results[0];
    if(!row)return null;
    if(column===undefined)return row as T;
    if(!Object.hasOwn(row,column))throw new Error('Unknown database result column.');
    return row[column] as T;
   },
   async run<T=Record<string,unknown>>(){return (await batch<T>([wrapped]))[0];},
   async all<T=Record<string,unknown>>(){return (await batch<T>([wrapped]))[0];},
   raw:()=>{throw new Error('Workspace operations use named database columns.');},
  };
  statements.set(wrapped,original);return Object.freeze(wrapped);
 }
 const admitted:D1Database=Object.freeze({prepare:(query:string)=>statement(db.prepare(query)),batch,
  exec:()=>{throw new Error('Workspace operations require prepared statements.');},
  dump:()=>{throw new Error('Database dumps are not workspace operations.');},
  withSession:()=>{throw new Error('Workspace authority cannot be detached from its database.');},
 });
 scopes.set(admitted,context);return admitted;
}

export function workspacePrincipal(db:object,userId:string){return scope(db,userId).principal;}
export function workspacePredicate(db:object,userId:string){
 const c=scope(db,userId);return identityPredicate(c.db,c.principal,c.policy);
}
export async function assertWorkspace(db:object,userId:string){
 const c=scope(db,userId);
 if(c.closure==='permit'){await assertCurrentIdentity(c.db,c.principal,c.policy);return;}
 // One final read admits both identity and closure state immediately before the effect. No second asynchronous
 // closure lookup can open a gap after the identity check; a previously admitted request grants no later authority.
 const gate=identityPredicate(c.db,c.principal,c.policy);
 const row=await c.db.prepare(`SELECT CASE WHEN NOT (${gate.sql}) THEN 1 WHEN EXISTS(SELECT 1 FROM account_closures WHERE account_id=?) THEN 2 ELSE 0 END denied`).bind(...gate.params,userId).first<{denied:number}>();
 if(row?.denied===0)return;
 if(row?.denied===2)throw accountClosing();
 // Preserve the exact fresh-proof error, but never turn a refused admission into permission if state changes again.
 await assertCurrentIdentity(c.db,c.principal,c.policy);throw changed();
}
/** Elevation only tightens this request. Every later commit rechecks actual proof age. */
export async function requireFreshWorkspace(db:object,userId:string){
 const c=scope(db,userId);c.policy={...c.policy,freshPasskey:true};
 await assertWorkspace(db,userId);
}
/** External effects cannot share a D1 transaction: recheck immediately before dispatch.
 * Callers retain their existing receipt and uncertain-outcome protocol after dispatch. */
export function workspaceTransport(db:object,userId:string,transport:typeof fetch=globalThis.fetch.bind(globalThis)):typeof fetch{
 scope(db,userId);
 return async(input,init)=>{await assertWorkspace(db,userId);return transport(input,init);};
}

/** Pass the same authority to storage and service bindings handed to domain tools. */
export function workspaceBindings(env:Env,db:D1Database,userId:string):Env{
 scope(db,userId);
 const bindings:Record<string,unknown>={...env,DB:db};
 if(env.FILES)bindings.FILES=new Proxy(env.FILES,{get(target,key){
  if(typeof key!=='string'||!['get','head','put','delete','list'].includes(key))throw new Error('Unsupported workspace storage operation.');
  const method=Reflect.get(target,key) as (...args:unknown[])=>Promise<unknown>;
  return async(...args:unknown[])=>{await assertWorkspace(db,userId);const result=await method.apply(target,args);await assertWorkspace(db,userId);return result;};
 }});
 for(const [key,binding] of Object.entries(env)){
  if(key==='ASSETS'||!binding||typeof binding!=='object'||!('fetch' in binding)||typeof binding.fetch!=='function')continue;
  const transport=workspaceTransport(db,userId,binding.fetch.bind(binding) as typeof fetch);
  bindings[key]={fetch:async(input:RequestInfo|URL,init?:RequestInit)=>{
   const response=await transport(input,init);
   try{await assertWorkspace(db,userId);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
   return response;
  }};
 }
 return bindings as unknown as Env;
}

/** Custody of one OAuth response already requested by this session. Revocation
 * must not strand a new provider credential. This capability cannot activate it,
 * read other credentials, send provider requests or authorize another operation. */
export async function prepareOAuthCustody(db:D1Database,userId:string,provider:'github'|'cloudflare',stateHash:string,keyring:string,clientId:string){
 const c=scope(db,userId);
 if(!/^[a-f0-9]{64}$/.test(stateHash)||!/^[A-Za-z0-9_.-]{1,128}$/.test(clientId))throw unavailable();
 const table=provider==='github'?'github_oauth_states':'cloudflare_oauth_states',flowAdmission=provider==='cloudflare'?' AND cancelled=0':'';
 if(!await db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? AND state_hash=? AND authority_id=? AND claimed=1${flowAdmission} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(userId,stateHash,c.principal.authorityId).first())throw changed();
 const tokenId=crypto.randomUUID(),writeKey=await connectionWriteKey(db,keyring);let remembered=false;
 const held=await db.prepare(`INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state)
 SELECT ?,?,?,?,?,?,?,'dispatched' WHERE EXISTS(SELECT 1 FROM ${table} WHERE user_id=? AND state_hash=? AND authority_id=? AND claimed=1${flowAdmission} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(tokenId,userId,provider,clientId,stateHash,writeKey.active_key,writeKey.revision,userId,stateHash,c.principal.authorityId).run();
 if(held.meta.changes!==1)throw changed();
 const release=()=>c.db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=? AND user_id=? AND provider=?').bind(tokenId,userId,provider);
 const settle=async(outcome:import('../connection-oauth-response').OAuthSettlement)=>{
  const readback=async()=>!!await c.db.prepare('SELECT 1 FROM connection_oauth_outcomes WHERE id=? AND user_id=? AND provider=? AND client_id=? AND state_hash=? AND key_id=? AND revision=? AND state=? AND reason=? AND http_status=? AND NOT EXISTS(SELECT 1 FROM connection_oauth_exchanges WHERE token_id=?)').bind(tokenId,userId,provider,clientId,stateHash,writeKey.active_key,writeKey.revision,outcome.state,outcome.reason,outcome.httpStatus,tokenId).first();
  if(await readback())return;
  try{await c.db.batch([
   c.db.prepare('INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,?,?,?,created_at FROM connection_oauth_exchanges WHERE token_id=? AND user_id=? AND provider=? AND client_id=?').bind(outcome.state,outcome.reason,outcome.httpStatus,tokenId,userId,provider,clientId),
   release(),c.db.prepare(`DELETE FROM ${table} WHERE user_id=? AND state_hash=?`).bind(userId,stateHash),
  ]);}catch{if(!await readback())throw new Error('OAuth outcome could not be saved.');}
  if(!await readback())throw new Error('OAuth outcome could not be confirmed.');
 };
 const confirmed=async()=>!!await c.db.prepare(provider==='github'
  ? "SELECT 1 FROM github_connections WHERE user_id=? AND active_token_id=?"
  : "SELECT 1 FROM cloudflare_token_vault WHERE user_id=? AND id=? AND state='active'").bind(userId,tokenId).first();
 return Object.freeze({tokenId,confirmed,settle,
  async remember(ciphertext:string,expiresAt:string,refresh?:{ciphertext:string;expiresAt:string|null}){
   if(remembered||!ciphertext||ciphertext.length>16384||!Number.isFinite(Date.parse(expiresAt)))throw new Error('Invalid OAuth custody operation.');
   if(refresh&&(provider!=='github'||!refresh.ciphertext||refresh.ciphertext.length>16384||refresh.expiresAt!==null&&!Number.isFinite(Date.parse(refresh.expiresAt))))throw new Error('Invalid OAuth refresh custody operation.');
   remembered=true;
   const vault=provider==='github'?'github_token_vault':'cloudflare_token_vault';
   const saved=async()=>{
    if(!await c.db.prepare(`SELECT 1 FROM ${vault} WHERE id=? AND user_id=? AND expires_at=?`).bind(tokenId,userId,expiresAt).first())return false;
    return !refresh||!!await c.db.prepare('SELECT 1 FROM github_refresh_custody WHERE token_id=? AND user_id=? AND client_id=? AND expires_at IS ?').bind(tokenId,userId,clientId,refresh.expiresAt).first();
   };
   if(await saved()){await release().run();return;}
   // An issued token survives sign-out, disconnect and lost commit acknowledgment.
   // Its exact admission holds the current write key until ciphertext is durable.
   const statements=provider==='github'?[
    c.db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(tokenId,userId,ciphertext,expiresAt),
    c.db.prepare("INSERT INTO github_token_staging(token_id,state_hash,expires_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute'))").bind(tokenId,stateHash),
   ]:[c.db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'staged')").bind(tokenId,userId,ciphertext,expiresAt)];
   if(refresh)statements.push(c.db.prepare('INSERT INTO github_refresh_custody(token_id,user_id,client_id,ciphertext,expires_at) VALUES(?,?,?,?,?)').bind(tokenId,userId,clientId,refresh.ciphertext,refresh.expiresAt));
   statements.push(release());
   try{await c.db.batch(statements);}catch(error){if(!await saved())throw error;}
  },
  async identifyGitHub(githubUserId:number){
   // Only the direct authenticated /user response for this exact issued token
   // may identify its retained grant. A later connection/login is not evidence.
   if(provider!=='github'||!remembered||!Number.isSafeInteger(githubUserId)||githubUserId<1)throw new Error('Invalid GitHub custody identity.');
   const identity=String(githubUserId);
   const saved=()=>c.db.prepare('SELECT 1 FROM github_refresh_custody WHERE token_id=? AND user_id=? AND client_id=? AND github_user_id=?').bind(tokenId,userId,clientId,identity).first();
   if(await saved())return;
   try{await c.db.prepare('UPDATE github_refresh_custody SET github_user_id=? WHERE token_id=? AND user_id=? AND client_id=? AND github_user_id IS NULL').bind(identity,tokenId,userId,clientId).run();}
   catch{if(!await saved())throw new Error('GitHub custody identity could not be saved.');}
   if(!await saved())throw new Error('GitHub custody identity could not be confirmed.');
  },
  async retire(){
   // Exact settlement survives sign-out. Never retire an activated credential.
   await c.db.batch(provider==='github'?[
    c.db.prepare("UPDATE github_token_vault SET state='revoking' WHERE id=? AND user_id=? AND NOT EXISTS(SELECT 1 FROM github_connections WHERE active_token_id=?)").bind(tokenId,userId,tokenId),
    c.db.prepare('DELETE FROM github_token_staging WHERE token_id=?').bind(tokenId),
    c.db.prepare('DELETE FROM github_oauth_states WHERE user_id=? AND state_hash=?').bind(userId,stateHash),
   ]:[
    c.db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE id=? AND user_id=? AND state='staged'").bind(tokenId,userId),
    c.db.prepare('DELETE FROM cloudflare_oauth_states WHERE user_id=? AND state_hash=?').bind(userId,stateHash),
   ]);
  },
 });
}

/** Settle only one already reviewed GitHub grant effect after its dispatch.
 * This capability survives sign-out, contains no provider client, and cannot
 * create/review/dispatch an action or change its immutable credential scope. */
export async function githubGrantCustody(db:D1Database,userId:string,id:string){
 const c=scope(db,userId);
 if(!await db.prepare("SELECT 1 FROM github_grant_revocations WHERE id=? AND user_id=? AND state='review'").bind(id,userId).first())throw changed();
 const saved=()=>c.db.prepare("SELECT 1 FROM github_grant_revocations WHERE id=? AND user_id=? AND state='revoked' AND http_status=204").bind(id,userId).first();
 return Object.freeze({
  async revoked(){
   if(await saved())return;
   try{await c.db.batch([
    c.db.prepare("UPDATE github_grant_revocations SET state='revoked',http_status=204,settled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state IN ('dispatching','uncertain')").bind(id,userId),
    c.db.prepare("DELETE FROM github_refresh_custody WHERE user_id=? AND EXISTS(SELECT 1 FROM github_grant_revocations a WHERE a.id=? AND a.user_id=github_refresh_custody.user_id AND a.client_id=github_refresh_custody.client_id AND a.github_user_id=github_refresh_custody.github_user_id AND a.state='revoked' AND github_refresh_custody.token_id IN (SELECT value FROM json_each(a.token_ids)))").bind(userId,id),
    c.db.prepare("DELETE FROM github_token_vault WHERE user_id=? AND state='revoking' AND id IN (SELECT value FROM github_grant_revocations a,json_each(a.token_ids) WHERE a.id=? AND a.user_id=? AND a.state='revoked')").bind(userId,id,userId),
   ]);}catch{if(!await saved())throw new Error('GitHub grant outcome could not be saved.');}
   if(!await saved())throw new Error('GitHub grant outcome could not be confirmed.');
  },
  async uncertain(){await c.db.prepare("UPDATE github_grant_revocations SET state='uncertain' WHERE id=? AND user_id=? AND state='dispatching'").bind(id,userId).run();},
 });
}

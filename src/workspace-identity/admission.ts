import {connectionWriteKey} from '../connection-write-policy';
import {IdentityError,assertCurrentIdentity,identityPredicate,type IdentityPrincipal,type IdentityPolicy} from './authority';

type Scope={db:D1Database;principal:IdentityPrincipal;policy:IdentityPolicy};
const scopes=new WeakMap<object,Scope>();
/** Internal maintenance entry points must never accept customer workspace authority. */
export function assertMaintenanceDatabase(db:D1Database){if(scopes.has(db))throw new Error('Platform maintenance authority is required.');}
const unavailable=()=>new IdentityError(401,'proof_required','Sign in with your current passkey to continue.');
const changed=()=>new IdentityError(409,'identity_changed','Your account access changed. Sign in again and review the current state before continuing.');
function scope(db:object,userId?:string){
 const value=scopes.get(db);
 if(!value||(userId!==undefined&&value.principal.accountId!==userId))throw unavailable();
 return value;
}

/** The HTTP boundary supplies a resolved capability, never an account ID as authority.
 * Every domain statement runs in the SAME transaction as a current-identity assertion.
 * Domain SQL still owns resource, feature, revision and exact-review authorization.
 * Background maintenance deliberately receives its own raw DB, not this user scope. */
export function admitWorkspace(db:D1Database,principal:IdentityPrincipal):D1Database{
 const context:Scope={db,principal,policy:{purpose:'workspace',freshPasskey:false,bindIdentityRevision:false}};
 identityPredicate(db,principal,context.policy); // Refuse cloned, restricted or foreign-DB capabilities.
 const statements=new WeakMap<D1PreparedStatement,D1PreparedStatement>();
 async function batch<T=unknown>(input:D1PreparedStatement[]):Promise<D1Result<T>[]> {
  const underlying=input.map(statement=>{const original=statements.get(statement);if(!original)throw unavailable();return original;});
  const gate=identityPredicate(db,principal,context.policy);
  // This inserts zero rows on success. The always-empty table's abort trigger
  // rejects the whole batch on failure; no check/write race or durable guard rows.
  const check=db.prepare(`INSERT INTO identity_admission_checks(denied) SELECT 1 WHERE NOT (${gate.sql})`).bind(...gate.params);
  try{return (await db.batch<T>([check,...underlying])).slice(1);}
  catch(error){if(String(error).includes('identity_admission_denied'))throw changed();throw error;}
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
 const c=scope(db,userId);await assertCurrentIdentity(c.db,c.principal,c.policy);
}
/** Elevation only tightens this request. Every later commit rechecks actual proof age. */
export async function requireFreshWorkspace(db:object,userId:string){
 const c=scope(db,userId);c.policy={...c.policy,freshPasskey:true};
 await assertCurrentIdentity(c.db,c.principal,c.policy);
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
export async function prepareOAuthCustody(db:D1Database,userId:string,provider:'github'|'cloudflare',stateHash:string,keyring:string){
 const c=scope(db,userId);
 if(!/^[a-f0-9]{64}$/.test(stateHash))throw unavailable();
 const table=provider==='github'?'github_oauth_states':'cloudflare_oauth_states',flowAdmission=provider==='cloudflare'?' AND cancelled=0':'';
 if(!await db.prepare(`SELECT 1 FROM ${table} WHERE user_id=? AND state_hash=? AND authority_id=? AND claimed=1${flowAdmission} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`).bind(userId,stateHash,c.principal.authorityId).first())throw changed();
 const tokenId=crypto.randomUUID(),writeKey=await connectionWriteKey(db,keyring);let remembered=false;
 const held=await db.prepare(`INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,state_hash,key_id,revision,state)
 SELECT ?,?,?,?,?,?,'dispatched' WHERE EXISTS(SELECT 1 FROM ${table} WHERE user_id=? AND state_hash=? AND authority_id=? AND claimed=1${flowAdmission} AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(tokenId,userId,provider,stateHash,writeKey.active_key,writeKey.revision,userId,stateHash,c.principal.authorityId).run();
 if(held.meta.changes!==1)throw changed();
 const settle=()=>c.db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=? AND user_id=? AND provider=?').bind(tokenId,userId,provider).run();
 const confirmed=async()=>!!await c.db.prepare(provider==='github'
  ? "SELECT 1 FROM github_connections WHERE user_id=? AND active_token_id=?"
  : "SELECT 1 FROM cloudflare_token_vault WHERE user_id=? AND id=? AND state='active'").bind(userId,tokenId).first();
 return Object.freeze({tokenId,confirmed,settle,
  async remember(ciphertext:string,expiresAt:string){
   if(remembered||!ciphertext||ciphertext.length>16384||!Number.isFinite(Date.parse(expiresAt)))throw new Error('Invalid OAuth custody operation.');
   remembered=true;
   const vault=provider==='github'?'github_token_vault':'cloudflare_token_vault';
   const saved=()=>c.db.prepare(`SELECT 1 FROM ${vault} WHERE id=? AND user_id=? AND expires_at=?`).bind(tokenId,userId,expiresAt).first();
   if(await saved()){await settle();return;}
   // An issued token survives sign-out, disconnect and lost commit acknowledgment.
   // Its exact admission holds the current write key until ciphertext is durable.
   const statements=provider==='github'?[
    c.db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'active')").bind(tokenId,userId,ciphertext,expiresAt),
    c.db.prepare("INSERT INTO github_token_staging(token_id,state_hash,expires_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute'))").bind(tokenId,stateHash),
   ]:[c.db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'staged')").bind(tokenId,userId,ciphertext,expiresAt)];
   statements.push(c.db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=? AND user_id=? AND provider=?').bind(tokenId,userId,provider));
   try{await c.db.batch(statements);}catch(error){if(!await saved())throw error;}
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

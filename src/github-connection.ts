import {sealConnectionWrite} from './connection-write-policy';
import {readOAuthTokenResponse} from './connection-oauth-response';
import {assertWorkspace,workspacePrincipal,prepareOAuthCustody} from './workspace-identity/admission';
import {hashToken,newSessionToken} from './security';
import {seal,unseal,connectionKeyringMetadata} from './connection-vault';
import {connectionFeature,connectionInclusion,requireFeature,assertFeature,featurePredicate,type ConnectionUse} from './feature-admission';
import {backupRecoveryRead} from './connection-recovery';
export class ConnectionError extends Error{constructor(public status:number,message:string){super(message);}}
type GitHubConfig={clientId:string;clientSecret:string;appId:number;slug:string;key:string};
const callback='https://whumpo.com/api/connections/github/callback';
const API='https://api.github.com';
const apiHeaders={'accept':'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Whumpo-test'};
export function githubConfig(env:Env):GitHubConfig|undefined{
 if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.GITHUB_APP_ID||!env.GITHUB_APP_SLUG||!env.CONNECTION_ENCRYPTION_KEYRING)return;
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(env.GITHUB_CLIENT_ID)||!/^[a-z0-9-]{1,100}$/.test(env.GITHUB_APP_SLUG)||!Number.isSafeInteger(Number(env.GITHUB_APP_ID))||Number(env.GITHUB_APP_ID)<1)return;
 try{connectionKeyringMetadata(env.CONNECTION_ENCRYPTION_KEYRING);}catch{return;}
 return {clientId:env.GITHUB_CLIENT_ID,clientSecret:env.GITHUB_CLIENT_SECRET,appId:Number(env.GITHUB_APP_ID),slug:env.GITHUB_APP_SLUG,key:env.CONNECTION_ENCRYPTION_KEYRING};
}
function required(config:GitHubConfig|undefined){if(!config)throw new ConnectionError(503,'GitHub connection is not configured yet.');return config;}
function aad(user:string,id:string,purpose:string){return `whumpo:github:${purpose}:${user}:${id}`;}
async function request(url:string,options:RequestInit,transport:typeof fetch){
 try{return await transport(url,{...options,redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new ConnectionError(503,'GitHub could not be reached. Try again later.');}
}
async function readJSON(response:Response){
 if(!response.ok||!response.body){await response.body?.cancel();throw new ConnectionError(response.status===401?401:503,response.status===401?'GitHub access expired or was revoked. Connect again.':'GitHub could not complete this request.');}
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>524288)throw Error();chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}const data:unknown=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data as Record<string,unknown>;}catch{await reader.cancel();throw new ConnectionError(503,'GitHub returned an unreadable response.');}
}
async function revoke(config:GitHubConfig,token:string,transport:typeof fetch){
 const response=await request(API+'/applications/'+config.clientId+'/token',{method:'DELETE',headers:{...apiHeaders,authorization:'Basic '+btoa(config.clientId+':'+config.clientSecret),'content-type':'application/json'},body:JSON.stringify({access_token:token})},transport);await response.body?.cancel();return response.status===204;
}
export async function cleanupGitHub(db:D1Database,config:GitHubConfig|undefined,transport:typeof fetch=fetch,userId:string|null=null){
 if(!config)return;
 // Interactive callers supply an owner; only the scheduled pass is global.
 await db.batch([
  db.prepare("DELETE FROM github_oauth_states WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (? IS NULL OR user_id=?)").bind(userId,userId),
  db.prepare("UPDATE github_connections SET active_token_id=NULL WHERE (? IS NULL OR user_id=?) AND active_token_id IN (SELECT t.id FROM github_token_vault t JOIN github_refresh_custody r ON r.token_id=t.id WHERE t.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(userId,userId),
  db.prepare("UPDATE github_token_vault SET state='revoking' WHERE (? IS NULL OR user_id=?) AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id)").bind(userId,userId),
  db.prepare("DELETE FROM github_token_vault WHERE NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id) AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (? IS NULL OR user_id=?)").bind(userId,userId),
  db.prepare("UPDATE github_token_vault SET state='revoking' WHERE (? IS NULL OR user_id=?) AND EXISTS(SELECT 1 FROM github_token_staging s WHERE s.token_id=github_token_vault.id AND (s.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM github_oauth_states f WHERE f.user_id=github_token_vault.user_id AND f.state_hash=s.state_hash AND f.claimed=1 AND f.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))) AND NOT EXISTS(SELECT 1 FROM github_connections c WHERE c.active_token_id=github_token_vault.id)").bind(userId,userId),
  db.prepare("DELETE FROM github_token_staging WHERE token_id IN (SELECT id FROM github_token_vault WHERE state='revoking' AND (? IS NULL OR user_id=?))").bind(userId,userId)
 ]);
 const {results}=await db.prepare("SELECT t.id,t.user_id,t.ciphertext,r.client_id AS refresh_client FROM github_token_vault t LEFT JOIN github_refresh_custody r ON r.token_id=t.id WHERE r.access_revoked_at IS NULL AND (r.client_id IS NULL OR r.client_id=?) AND t.state='revoking' AND (? IS NULL OR t.user_id=?) AND NOT EXISTS(SELECT 1 FROM github_grant_revocations a WHERE a.state IN ('dispatching','uncertain') AND t.id IN (SELECT value FROM json_each(a.token_ids))) AND NOT EXISTS(SELECT 1 FROM github_revocation_claims r WHERE r.token_id=t.id AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) ORDER BY t.expires_at,t.id LIMIT 5").bind(config.clientId,userId,userId).all<{id:string;user_id:string;ciphertext:string;refresh_client:string|null}>();
 for(const row of results){
  if(row.refresh_client!==null&&row.refresh_client!==config.clientId)continue;
  const claim=crypto.randomUUID();
  try{
   const admitted=await db.prepare("INSERT INTO github_revocation_claims(token_id,claim_id,expires_at) SELECT id,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute') FROM github_token_vault WHERE id=? AND user_id=? AND state='revoking' AND NOT EXISTS(SELECT 1 FROM github_connections WHERE active_token_id=github_token_vault.id) AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id AND access_revoked_at IS NOT NULL) ON CONFLICT(token_id) DO UPDATE SET claim_id=excluded.claim_id,expires_at=excluded.expires_at WHERE github_revocation_claims.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(claim,row.id,row.user_id).run();
   if(admitted.meta.changes!==1)continue;
   const token=await unseal(config.key,aad(row.user_id,row.id,'token'),row.ciphertext);
   if(!await db.prepare("SELECT t.id FROM github_token_vault t JOIN github_revocation_claims r ON r.token_id=t.id WHERE t.id=? AND t.user_id=? AND t.state='revoking' AND r.claim_id=? AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM github_connections WHERE active_token_id=t.id) AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=t.id AND access_revoked_at IS NOT NULL)").bind(row.id,row.user_id,claim).first())continue;
   if(await revoke(config,token,transport))await db.batch([
    // A single-token 204 only settles access-token revocation. The separately
    // encrypted refresh credential remains a grant-reconciliation obligation.
    db.prepare("UPDATE github_refresh_custody SET access_revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE token_id=? AND user_id=? AND client_id=? AND access_revoked_at IS NULL AND EXISTS(SELECT 1 FROM github_revocation_claims r JOIN github_token_vault t ON t.id=r.token_id WHERE r.token_id=github_refresh_custody.token_id AND r.claim_id=? AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND t.state='revoking')").bind(row.id,row.user_id,config.clientId,claim),
    db.prepare("DELETE FROM github_token_vault WHERE id=? AND user_id=? AND state='revoking' AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id) AND EXISTS(SELECT 1 FROM github_revocation_claims WHERE token_id=github_token_vault.id AND claim_id=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(row.id,row.user_id,claim),
    db.prepare('DELETE FROM github_revocation_claims WHERE token_id=? AND claim_id=?').bind(row.id,claim),
   ]);
   else await db.prepare('DELETE FROM github_revocation_claims WHERE token_id=? AND claim_id=?').bind(row.id,claim).run();
  }catch{/* Retain encrypted work and let this bounded claim expire before retry. */}
 }
}
export async function connectionStatus(db:D1Database,userId:string,config:GitHubConfig|undefined){
 const c=await db.prepare('SELECT c.login,c.connected_at,t.expires_at,t.state,(SELECT client_id FROM github_refresh_custody WHERE token_id=t.id) AS refresh_client FROM github_connections c LEFT JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=?').bind(userId).first<{login:string;connected_at:string;expires_at:string|null;state:string|null;refresh_client:string|null}>();
 const pending=await db.prepare("SELECT COUNT(*) AS n FROM github_token_vault t WHERE user_id=? AND (expires_at>? OR EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=t.id)) AND (state='revoking' OR EXISTS(SELECT 1 FROM github_token_staging s WHERE s.token_id=t.id AND s.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))").bind(userId,new Date().toISOString()).first<{n:number}>();
 const connected=!!config&&(!c?.refresh_client||c.refresh_client===config.clientId)&&c?.state==='active'&&!!c.expires_at&&c.expires_at>new Date().toISOString();
 const inclusion=await connectionInclusion(db,userId,'github');
 return {github:{enabled:!!config,inclusion,connected,expired:!!config&&c?.state==='active'&&!!c.expires_at&&c.expires_at<=new Date().toISOString(),login:c?.login??null,expiresAt:c?.expires_at??null,revocationPending:!!pending?.n,installURL:config&&inclusion.read?'https://github.com/apps/'+config.slug+'/installations/new':null,backupEnabled:connected&&inclusion.read},cloudflare:{enabled:false,connected:false}};
}
export async function startGitHub(db:D1Database,userId:string,configuration:GitHubConfig|undefined){
 if(await db.prepare("SELECT 1 FROM connection_oauth_exchanges WHERE user_id=? AND provider='github'").bind(userId).first())throw new ConnectionError(409,'A previous connection is awaiting provider recovery.');
 const config=required(configuration),scope=connectionFeature(userId,'github',null,'connect'),gate=featurePredicate(db,scope);await requireFeature(db,scope);await db.prepare('DELETE FROM github_token_vault WHERE NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id) AND user_id=? AND expires_at<=?').bind(userId,new Date().toISOString()).run();const count=await db.prepare('SELECT COUNT(*) AS n FROM github_token_vault WHERE user_id=? AND (expires_at>? OR EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=github_token_vault.id))').bind(userId,new Date().toISOString()).first<{n:number}>();if((count?.n??0)>=5)throw new ConnectionError(429,'Finish pending GitHub disconnects and provider recovery before reconnecting.');
 if(await db.prepare("SELECT 1 FROM github_grant_revocations WHERE client_id=? AND state IN ('dispatching','uncertain')").bind(config.clientId).first())throw new ConnectionError(409,'GitHub access removal is awaiting provider recovery.');
 const state=newSessionToken(),stateHash=await hashToken(state),verifier=newSessionToken();const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));const challenge=btoa(Array.from(digest,b=>String.fromCharCode(b)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const inserted=await db.prepare(`INSERT INTO github_oauth_states(user_id,state_hash,authority_id,verifier_ciphertext,expires_at) SELECT ?,?,?,?,? WHERE ${gate.sql} ON CONFLICT(user_id) DO UPDATE SET state_hash=excluded.state_hash,authority_id=excluded.authority_id,verifier_ciphertext=excluded.verifier_ciphertext,expires_at=excluded.expires_at,claimed=0`).bind(userId,stateHash,workspacePrincipal(db,userId).authorityId,await sealConnectionWrite(db,config.key,aad(userId,stateHash,'pkce'),verifier),new Date(Date.now()+600000).toISOString(),...gate.params).run();
 if(inserted.meta.changes!==1){await assertFeature(db,scope);throw new ConnectionError(409,'GitHub authorization was not started.');}
 const url=new URL('https://github.com/login/oauth/authorize');url.searchParams.set('client_id',config.clientId);url.searchParams.set('redirect_uri',callback);url.searchParams.set('state',state);url.searchParams.set('code_challenge',challenge);url.searchParams.set('code_challenge_method','S256');
 return {url:url.href};
}
export async function cancelGitHub(db:D1Database,userId:string,state:string){
 if(!/^[0-9a-f]{64}$/.test(state))return;
 await db.prepare('DELETE FROM github_oauth_states WHERE user_id=? AND authority_id=? AND state_hash=?').bind(userId,workspacePrincipal(db,userId).authorityId,await hashToken(state)).run();
}
export async function finishGitHub(db:D1Database,userId:string,state:string,code:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration);if(!/^[0-9a-f]{64}$/.test(state)||!code||code.length>512)throw new ConnectionError(400,'Invalid GitHub authorization response.');
 const scope=connectionFeature(userId,'github',null,'connect'),gate=featurePredicate(db,scope);await requireFeature(db,scope);
 const stateHash=await hashToken(state);const flow=await db.prepare(`UPDATE github_oauth_states SET claimed=1 WHERE user_id=? AND state_hash=? AND authority_id=? AND claimed=0 AND expires_at>? AND ${gate.sql} RETURNING verifier_ciphertext`).bind(userId,stateHash,workspacePrincipal(db,userId).authorityId,new Date().toISOString(),...gate.params).first<{verifier_ciphertext:string}>();if(!flow)throw new ConnectionError(400,'This GitHub authorization expired or was already used. Start again.');
 const verifier=await unseal(config.key,aad(userId,stateHash,'pkce'),flow.verifier_ciphertext);
 await assertFeature(db,scope);
 const custody=await prepareOAuthCustody(db,userId,'github',stateHash,config.key,config.clientId);
 const response=await readOAuthTokenResponse('github',await request('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:callback,code_verifier:verifier})},transport)).catch(()=>{throw new ConnectionError(503,'GitHub returned an unreadable token response. Provider recovery is required.');});
 if(response.kind==='rejected'){await custody.settle(response.settlement);throw new ConnectionError(400,'GitHub rejected this authorization. Start a new connection after checking your account and app configuration.');}
 const data=response.data;
 if(typeof data.access_token!=='string'||!/^gh[uo]_[A-Za-z0-9_]{1,4090}$/.test(data.access_token)||Object.hasOwn(data,'refresh_token')&&(typeof data.refresh_token!=='string'||!/^ghr_[A-Za-z0-9_]{1,4090}$/.test(data.refresh_token)))throw new ConnectionError(503,'GitHub returned an invalid access token.');
 const validLifetime=Number.isSafeInteger(data.expires_in)&&Number(data.expires_in)>0&&Number(data.expires_in)<=28800;
 const refreshToken=typeof data.refresh_token==='string'?data.refresh_token:undefined;
 const validRefreshLifetime=Number.isSafeInteger(data.refresh_token_expires_in)&&Number(data.refresh_token_expires_in)>0&&Number(data.refresh_token_expires_in)<=15897600;
 const tokenId=custody.tokenId,expires=validLifetime?new Date(Date.now()+Number(data.expires_in)*1000).toISOString():'9999-12-31T23:59:59.999Z';
 // Store the encrypted credential and its staging lease atomically. An active
 // vault row grants no access without the separately guarded connection pointer.
 // A failed save that returned a refresh credential needs separate grant evidence;
 // revoking only the access token cannot create an all-credentials-settled receipt.
 try{await custody.remember(await seal(config.key,aad(userId,tokenId,'token'),data.access_token),expires,refreshToken?{ciphertext:await seal(config.key,aad(userId,tokenId,'refresh'),refreshToken),expiresAt:validRefreshLifetime?new Date(Date.now()+Number(data.refresh_token_expires_in)*1000).toISOString():null}:undefined);}
 catch{try{if(await revoke(config,data.access_token,transport)&&!Object.hasOwn(data,'refresh_token'))await custody.settle({state:'revoked',reason:'provider_revoked',httpStatus:204});}catch{}throw new ConnectionError(503,'GitHub access could not be saved. Provider recovery is required; revoke the app in GitHub settings.');}
 try{
  if(!validLifetime||!data.access_token.startsWith('ghu_')||refreshToken&&!validRefreshLifetime)throw new ConnectionError(503,'GitHub must return an expiring GitHub App user token. Check the app configuration.');
  await assertFeature(db,scope);
  const who=await readJSON(await request(API+'/user',{headers:{...apiHeaders,authorization:'Bearer '+data.access_token}},transport));
  if(!Number.isSafeInteger(who.id)||Number(who.id)<1||typeof who.login!=='string'||! /^[A-Za-z0-9-]{1,39}$/.test(who.login))throw new ConnectionError(503,'GitHub returned an invalid account.');
  if(refreshToken)await custody.identifyGitHub(Number(who.id));
  let results;try{results=await db.batch([
   db.prepare(`INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) SELECT t.user_id,?,?,t.id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM github_token_vault t JOIN github_token_staging s ON s.token_id=t.id JOIN github_oauth_states f ON f.user_id=t.user_id AND f.state_hash=s.state_hash WHERE t.id=? AND t.user_id=? AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.state_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND f.authority_id=? AND f.claimed=1 AND f.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${gate.sql} ON CONFLICT(user_id) DO UPDATE SET github_user_id=excluded.github_user_id,login=excluded.login,active_token_id=excluded.active_token_id,connected_at=excluded.connected_at`).bind(String(who.id),who.login,tokenId,userId,stateHash,workspacePrincipal(db,userId).authorityId,...gate.params),
   // Retire old usable credentials only after the replacement pointer wins.
   // Other pending callbacks retain their own staging records until cleanup.
   db.prepare("UPDATE github_token_vault SET state='revoking' WHERE user_id=? AND id!=? AND state='active' AND NOT EXISTS(SELECT 1 FROM github_token_staging WHERE token_id=github_token_vault.id) AND EXISTS(SELECT 1 FROM github_connections WHERE user_id=? AND active_token_id=?)").bind(userId,tokenId,userId,tokenId),
   db.prepare('DELETE FROM github_token_staging WHERE token_id=? AND EXISTS(SELECT 1 FROM github_connections WHERE user_id=? AND active_token_id=?)').bind(tokenId,userId,tokenId),
   db.prepare('DELETE FROM github_oauth_states WHERE user_id=? AND state_hash=?').bind(userId,stateHash)
  ]);}catch{if(await custody.confirmed()){await assertWorkspace(db,userId);return {connected:true};}throw new ConnectionError(503,'GitHub connection could not be confirmed. Refresh its status before starting again.');}
  if(results[0].meta.changes!==1){await assertFeature(db,scope);throw new ConnectionError(409,'This connection was cancelled or replaced. Start again if you still want to connect.');}
 }finally{
  await custody.retire();
  await cleanupGitHub(db,config,transport,userId);
 }
 return {connected:true};
}
export async function disconnectGitHub(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 await db.batch([db.prepare('DELETE FROM github_oauth_states WHERE user_id=?').bind(userId),db.prepare("UPDATE github_token_vault SET state='revoking' WHERE user_id=?").bind(userId),db.prepare('UPDATE github_connections SET active_token_id=NULL WHERE user_id=?').bind(userId),db.prepare('DELETE FROM github_token_staging WHERE token_id IN (SELECT id FROM github_token_vault WHERE user_id=?)').bind(userId)]);
 await cleanupGitHub(db,configuration,transport,userId);return connectionStatus(db,userId,configuration);
}

export async function githubInstallations(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration),access=await githubAccess(db,userId,config,transport,{projectId:null,operation:'read'});
 const data=await readJSON(await access.send('/user/installations?per_page=100'));
 // Recheck after the entire bounded body, not just after receiving headers.
 await access.assertCurrent();
 if(!Array.isArray(data.installations)||data.installations.length>100)throw new ConnectionError(503,'GitHub returned invalid installation data.');
 const installations=data.installations.flatMap((entry:unknown)=>{
  if(!entry||typeof entry!=='object')return [];const i=entry as Record<string,unknown>,account=i.account as Record<string,unknown>|null;
  if(i.app_id!==config.appId||i.suspended_at!=null||!Number.isSafeInteger(i.id)||Number(i.id)<1||!account||typeof account.login!=='string'||! /^[A-Za-z0-9-]{1,39}$/.test(account.login))return [];
  return [{id:i.id,account:account.login,repositorySelection:i.repository_selection==='selected'?'selected':'all'}];
 });
 return {installations,truncated:typeof data.total_count==='number'&&data.total_count>100};
}

/** Internal capability. Recovery is bound to an owned dispatched receipt and exact read paths. */
export async function githubAccess(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch,usage:ConnectionUse){
 const config=required(configuration),use={...usage};
 if(!('recoveryId' in use))await requireFeature(db,connectionFeature(userId,'github',use.projectId,use.operation));
 const current=await db.prepare("SELECT c.github_user_id,t.id FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND t.state='active' AND t.expires_at>? AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=t.id AND client_id!=?)").bind(userId,new Date().toISOString(),config.clientId).first<{github_user_id:string;id:string}>();
 if(!current)throw new ConnectionError(401,'Connect GitHub again before using repository backups.');
 async function assertCurrent(operation='recoveryId' in use?null:use.operation){
  await assertWorkspace(db,userId);
  if('recoveryId' in use){
   const b=await db.prepare("SELECT b.* FROM github_backups b JOIN projects p ON p.id=b.project_id JOIN github_connections c ON c.user_id=b.user_id AND c.github_user_id=b.github_user_id JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE b.id=? AND b.user_id=? AND p.owner_user_id=? AND b.github_user_id=? AND b.state IN ('dispatching','uncertain') AND t.id=? AND t.state='active' AND t.expires_at>?").bind(use.recoveryId,userId,userId,current!.github_user_id,current!.id,new Date().toISOString()).first<{repo_owner:string;repo_name:string;branch:string;path:string}>();
   if(!b)throw new ConnectionError(403,'Only an owned uncertain backup with current provider consent can be reconciled.');return b;
  }
  const gate=featurePredicate(db,connectionFeature(userId,'github',use.projectId,operation!));
  const active=await db.prepare(`SELECT ${gate.sql} AS included FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND c.github_user_id=? AND t.id=? AND t.state='active' AND t.expires_at>?`).bind(...gate.params,userId,current!.github_user_id,current!.id,new Date().toISOString()).first<{included:number}>();
  if(!active)throw new ConnectionError(401,'GitHub access changed. Reconnect and prepare a new review.');
  if(active.included!==1)throw new ConnectionError(403,'Feature eligibility or project ownership changed. Prepare a new review.');
 }

 await assertCurrent();
 return {tokenId:current.id,githubUserId:current.github_user_id,assertCurrent,async send(path:string,options:RequestInit={},operation:'read'|'prepare'|'confirm'|'dispatch'='recoveryId' in use?'read':use.operation){
  if(!path.startsWith('/')||path.startsWith('//'))throw new ConnectionError(400,'Invalid GitHub API path.');
  const row=await db.prepare("SELECT t.ciphertext FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND t.id=? AND t.state='active' AND t.expires_at>?").bind(userId,current.id,new Date().toISOString()).first<{ciphertext:string}>();
  if(!row)throw new ConnectionError(401,'GitHub access changed. Reconnect and prepare a new review.');
  const token=await unseal(config.key,aad(userId,current.id,'token'),row.ciphertext);
  const recovery=await assertCurrent(operation);
  if(recovery&&!backupRecoveryRead(recovery,path,options))throw new ConnectionError(403,'Backup reconciliation can only inspect its recorded destination.');
  const response=await request(API+path,{...options,headers:{...apiHeaders,'content-type':'application/json',authorization:'Bearer '+token}},transport);
  try{await assertCurrent(operation);}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return response;
 }};
}
export {readJSON as readGitHubJSON};
export type {GitHubConfig};

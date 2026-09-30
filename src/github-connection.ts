import {hashToken,newSessionToken} from './security';
import {seal,unseal} from './connection-vault';
export class ConnectionError extends Error{constructor(public status:number,message:string){super(message);}}
type GitHubConfig={clientId:string;clientSecret:string;appId:number;slug:string;key:string};
const callback='https://whumpo.com/api/connections/github/callback';
const API='https://api.github.com';
const apiHeaders={'accept':'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'Whumpo-test'};
export function githubConfig(env:Env):GitHubConfig|undefined{
 if(!env.GITHUB_CLIENT_ID||!env.GITHUB_CLIENT_SECRET||!env.GITHUB_APP_ID||!env.GITHUB_APP_SLUG||!env.CONNECTION_ENCRYPTION_KEY)return;
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(env.GITHUB_CLIENT_ID)||!/^[a-z0-9-]{1,100}$/.test(env.GITHUB_APP_SLUG)||!/^[0-9a-f]{64}$/.test(env.CONNECTION_ENCRYPTION_KEY)||!Number.isSafeInteger(Number(env.GITHUB_APP_ID))||Number(env.GITHUB_APP_ID)<1)return;
 return {clientId:env.GITHUB_CLIENT_ID,clientSecret:env.GITHUB_CLIENT_SECRET,appId:Number(env.GITHUB_APP_ID),slug:env.GITHUB_APP_SLUG,key:env.CONNECTION_ENCRYPTION_KEY};
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
export async function cleanupGitHub(db:D1Database,config:GitHubConfig|undefined,transport:typeof fetch=fetch){
 if(!config)return;
 const now=new Date().toISOString();await db.batch([db.prepare('DELETE FROM github_oauth_states WHERE expires_at<=?').bind(now),db.prepare('DELETE FROM github_token_vault WHERE expires_at<=?').bind(now)]);
 const {results}=await db.prepare("SELECT id,user_id,ciphertext FROM github_token_vault WHERE state='revoking' LIMIT 5").all<{id:string;user_id:string;ciphertext:string}>();
 for(const row of results){try{const token=await unseal(config.key,aad(row.user_id,row.id,'token'),row.ciphertext);if(await revoke(config,token,transport))await db.prepare("DELETE FROM github_token_vault WHERE id=? AND state='revoking'").bind(row.id).run();}catch{/* Retain encrypted revocation work until retry or token expiry. */}}
}
export async function connectionStatus(db:D1Database,userId:string,config:GitHubConfig|undefined){
 const c=await db.prepare('SELECT c.login,c.connected_at,t.expires_at,t.state FROM github_connections c LEFT JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=?').bind(userId).first<{login:string;connected_at:string;expires_at:string|null;state:string|null}>();
 const pending=await db.prepare("SELECT COUNT(*) AS n FROM github_token_vault WHERE user_id=? AND state='revoking' AND expires_at>?").bind(userId,new Date().toISOString()).first<{n:number}>();
 const connected=!!config&&c?.state==='active'&&!!c.expires_at&&c.expires_at>new Date().toISOString();
 return {github:{enabled:!!config,connected,expired:!!config&&c?.state==='active'&&!!c.expires_at&&c.expires_at<=new Date().toISOString(),login:c?.login??null,expiresAt:c?.expires_at??null,revocationPending:!!pending?.n,installURL:config?'https://github.com/apps/'+config.slug+'/installations/new':null,backupEnabled:connected},cloudflare:{enabled:false,connected:false}};
}
export async function startGitHub(db:D1Database,userId:string,sessionHash:string,configuration:GitHubConfig|undefined){
 const config=required(configuration);await db.prepare('DELETE FROM github_token_vault WHERE user_id=? AND expires_at<=?').bind(userId,new Date().toISOString()).run();const count=await db.prepare('SELECT COUNT(*) AS n FROM github_token_vault WHERE user_id=? AND expires_at>?').bind(userId,new Date().toISOString()).first<{n:number}>();if((count?.n??0)>=5)throw new ConnectionError(429,'Finish pending GitHub disconnects or wait for existing access to expire before reconnecting.');
 const state=newSessionToken(),stateHash=await hashToken(state),verifier=newSessionToken();const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));const challenge=btoa(Array.from(digest,b=>String.fromCharCode(b)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 await db.prepare('INSERT INTO github_oauth_states(user_id,state_hash,session_hash,verifier_ciphertext,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET state_hash=excluded.state_hash,session_hash=excluded.session_hash,verifier_ciphertext=excluded.verifier_ciphertext,expires_at=excluded.expires_at,claimed=0').bind(userId,stateHash,sessionHash,await seal(config.key,aad(userId,stateHash,'pkce'),verifier),new Date(Date.now()+600000).toISOString()).run();
 const url=new URL('https://github.com/login/oauth/authorize');url.searchParams.set('client_id',config.clientId);url.searchParams.set('redirect_uri',callback);url.searchParams.set('state',state);url.searchParams.set('code_challenge',challenge);url.searchParams.set('code_challenge_method','S256');
 return {url:url.href};
}
export async function cancelGitHub(db:D1Database,userId:string,sessionHash:string,state:string){
 if(!/^[0-9a-f]{64}$/.test(state))return;
 await db.prepare('DELETE FROM github_oauth_states WHERE user_id=? AND session_hash=? AND state_hash=?').bind(userId,sessionHash,await hashToken(state)).run();
}
export async function finishGitHub(db:D1Database,userId:string,sessionHash:string,state:string,code:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration);if(!/^[0-9a-f]{64}$/.test(state)||!code||code.length>512)throw new ConnectionError(400,'Invalid GitHub authorization response.');
 const stateHash=await hashToken(state);const flow=await db.prepare('UPDATE github_oauth_states SET claimed=1 WHERE user_id=? AND state_hash=? AND session_hash=? AND claimed=0 AND expires_at>? RETURNING verifier_ciphertext').bind(userId,stateHash,sessionHash,new Date().toISOString()).first<{verifier_ciphertext:string}>();if(!flow)throw new ConnectionError(400,'This GitHub authorization expired or was already used. Start again.');
 const verifier=await unseal(config.key,aad(userId,stateHash,'pkce'),flow.verifier_ciphertext);
 const data=await readJSON(await request('https://github.com/login/oauth/access_token',{method:'POST',headers:{accept:'application/json','content-type':'application/json'},body:JSON.stringify({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:callback,code_verifier:verifier})},transport));
 if(typeof data.access_token!=='string'||!/^gh[uo]_[A-Za-z0-9_]{1,4090}$/.test(data.access_token))throw new ConnectionError(503,'GitHub returned an invalid access token.');
 const validLifetime=Number.isSafeInteger(data.expires_in)&&Number(data.expires_in)>0&&Number(data.expires_in)<=28800;
 const tokenId=crypto.randomUUID(),expires=validLifetime?new Date(Date.now()+Number(data.expires_in)*1000).toISOString():'9999-12-31T23:59:59.999Z';
 // Start fail-closed: even a misconfigured nonexpiring token is queued for revocation.
 try{await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,?,'revoking')").bind(tokenId,userId,await seal(config.key,aad(userId,tokenId,'token'),data.access_token),expires).run();}catch{try{await revoke(config,data.access_token,transport);}catch{}throw new ConnectionError(503,'GitHub access could not be saved. Start again later or revoke the app in GitHub settings.');}
 try{
  if(!validLifetime||!data.access_token.startsWith('ghu_'))throw new ConnectionError(503,'GitHub must return an expiring GitHub App user token. Check the app configuration.');
  const who=await readJSON(await request(API+'/user',{headers:{...apiHeaders,authorization:'Bearer '+data.access_token}},transport));
  if(!Number.isSafeInteger(who.id)||Number(who.id)<1||typeof who.login!=='string'||! /^[A-Za-z0-9-]{1,39}$/.test(who.login))throw new ConnectionError(503,'GitHub returned an invalid account.');
  const now=new Date().toISOString();let results;try{results=await db.batch([
   db.prepare("UPDATE github_token_vault SET state='revoking' WHERE id=(SELECT active_token_id FROM github_connections WHERE user_id=?) AND EXISTS(SELECT 1 FROM github_oauth_states WHERE user_id=? AND state_hash=? AND claimed=1 AND expires_at>?)").bind(userId,userId,stateHash,now),
   db.prepare("UPDATE github_token_vault SET state='active' WHERE id=? AND EXISTS(SELECT 1 FROM github_oauth_states WHERE user_id=? AND state_hash=? AND claimed=1 AND expires_at>?)").bind(tokenId,userId,stateHash,now),
   db.prepare("INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM github_token_vault WHERE id=? AND state='active') ON CONFLICT(user_id) DO UPDATE SET github_user_id=excluded.github_user_id,login=excluded.login,active_token_id=excluded.active_token_id,connected_at=excluded.connected_at").bind(userId,String(who.id),who.login,tokenId,now,tokenId),
   db.prepare('DELETE FROM github_oauth_states WHERE user_id=? AND state_hash=?').bind(userId,stateHash)
  ]);}catch{const committed=await db.prepare('SELECT user_id FROM github_connections WHERE user_id=? AND active_token_id=?').bind(userId,tokenId).first();if(committed)return {connected:true};throw new ConnectionError(503,'GitHub connection could not be confirmed. Refresh its status before starting again.');}
  if(results[1].meta.changes!==1)throw new ConnectionError(409,'This connection was cancelled or replaced. Start again if you still want to connect.');
 }finally{await cleanupGitHub(db,config,transport);}
 return {connected:true};
}
export async function disconnectGitHub(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 await db.batch([db.prepare('DELETE FROM github_oauth_states WHERE user_id=?').bind(userId),db.prepare("UPDATE github_token_vault SET state='revoking' WHERE user_id=?").bind(userId),db.prepare('UPDATE github_connections SET active_token_id=NULL WHERE user_id=?').bind(userId)]);
 await cleanupGitHub(db,configuration,transport);return connectionStatus(db,userId,configuration);
}

export async function githubInstallations(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration),access=await githubAccess(db,userId,config,transport);
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

/** Internal capability: no raw token is returned, and each request rechecks local access. */
export async function githubAccess(db:D1Database,userId:string,configuration:GitHubConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration);
 const current=await db.prepare("SELECT c.github_user_id,t.id FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND t.state='active' AND t.expires_at>?").bind(userId,new Date().toISOString()).first<{github_user_id:string;id:string}>();
 if(!current)throw new ConnectionError(401,'Connect GitHub again before using repository backups.');
 async function assertCurrent(){
  if(!await db.prepare("SELECT c.user_id FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND c.github_user_id=? AND t.id=? AND t.state='active' AND t.expires_at>?").bind(userId,current!.github_user_id,current!.id,new Date().toISOString()).first())throw new ConnectionError(401,'GitHub access changed. Reconnect and prepare a new review.');
 }
 return {tokenId:current.id,githubUserId:current.github_user_id,assertCurrent,async send(path:string,options:RequestInit={}){
  if(!path.startsWith('/')||path.startsWith('//'))throw new ConnectionError(400,'Invalid GitHub API path.');
  const row=await db.prepare("SELECT t.ciphertext FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id AND t.user_id=c.user_id WHERE c.user_id=? AND t.id=? AND t.state='active' AND t.expires_at>?").bind(userId,current.id,new Date().toISOString()).first<{ciphertext:string}>();
  if(!row)throw new ConnectionError(401,'GitHub access changed. Reconnect and prepare a new review.');
  const token=await unseal(config.key,aad(userId,current.id,'token'),row.ciphertext);
  const response=await request(API+path,{...options,headers:{...apiHeaders,'content-type':'application/json',authorization:'Bearer '+token}},transport);
  try{await assertCurrent();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return response;
 }};
}
export {readJSON as readGitHubJSON};
export type {GitHubConfig};

import {hashToken,newSessionToken} from './security';
import {seal,unseal} from './connection-vault';
import {ConnectionError} from './github-connection';
type CloudflareConfig={clientId:string;clientSecret:string;key:string};
const callback='https://digifender.com/api/connections/cloudflare/callback';
const scopes=['zone.read','dns.read','dns.write'];
const now=()=>new Date().toISOString();
const aad=(user:string,id:string,purpose:string)=>`tellumo:cloudflare:${purpose}:${user}:${id}`;
export function cloudflareConfig(env:Env):CloudflareConfig|undefined{
 if(!env.CLOUDFLARE_CLIENT_ID||!env.CLOUDFLARE_CLIENT_SECRET||!env.CONNECTION_ENCRYPTION_KEY)return;
 if(!/^[A-Za-z0-9_.-]{1,128}$/.test(env.CLOUDFLARE_CLIENT_ID)||! /^[0-9a-f]{64}$/.test(env.CONNECTION_ENCRYPTION_KEY))return;
 return {clientId:env.CLOUDFLARE_CLIENT_ID,clientSecret:env.CLOUDFLARE_CLIENT_SECRET,key:env.CONNECTION_ENCRYPTION_KEY};
}
function required(config:CloudflareConfig|undefined){if(!config)throw new ConnectionError(503,'Cloudflare connection is awaiting platform configuration.');return config;}
async function request(url:string,init:RequestInit,transport:typeof fetch){
 try{return await transport(url,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)});}catch{throw new ConnectionError(503,'Cloudflare could not be reached. Try again later.');}
}
async function json(response:Response){
 if(!response.ok||!response.body){await response.body?.cancel();throw new ConnectionError(response.status===401||response.status===403?401:503,'Cloudflare access could not be verified. Reconnect or try again later.');}
 const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144)throw Error();chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const value:unknown=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as Record<string,unknown>;}catch{await reader.cancel();throw new ConnectionError(503,'Cloudflare returned an unreadable response.');}
}
function oauthHeaders(config:CloudflareConfig){return {'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+btoa(encodeURIComponent(config.clientId)+':'+encodeURIComponent(config.clientSecret))};}
type Tokens={access:string;refresh?:string};
async function revoke(config:CloudflareConfig,tokens:Tokens,transport:typeof fetch){
 // No replacement authorization begins while a prior token still needs revocation.
 let complete=true;
 for(const [token,hint] of [[tokens.access,'access_token'],[tokens.refresh,'refresh_token']] as const){
  if(!token)continue;const response=await request('https://dash.cloudflare.com/oauth2/revoke',{method:'POST',headers:oauthHeaders(config),body:new URLSearchParams({token,token_type_hint:hint})},transport);await response.body?.cancel();if(response.status!==200)complete=false;
 }
 return complete;
}
export async function cleanupCloudflare(db:D1Database,config:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 if(!config)return;
 await db.batch([db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE state='staged' AND created_at<?").bind(new Date(Date.now()-120000).toISOString()),db.prepare('DELETE FROM cloudflare_oauth_states WHERE expires_at<=?').bind(now()),db.prepare('DELETE FROM cloudflare_token_vault WHERE expires_at<=?').bind(now())]);
 const {results}=await db.prepare("SELECT id,user_id,ciphertext FROM cloudflare_token_vault WHERE state='revoking' AND (revoke_after IS NULL OR revoke_after<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) LIMIT 5").all<{id:string;user_id:string;ciphertext:string}>();
 for(const row of results){
  const attempt=crypto.randomUUID();
  const claimed=await db.prepare("UPDATE cloudflare_token_vault SET revoke_attempt=?,revoke_after=? WHERE id=? AND state='revoking' AND (revoke_after IS NULL OR revoke_after<=?)").bind(attempt,new Date(Date.now()+120000).toISOString(),row.id,now()).run();
  if(claimed.meta.changes!==1)continue;
  try{const tokens=JSON.parse(await unseal(config.key,aad(row.user_id,row.id,'token'),row.ciphertext)) as Tokens;if(await revoke(config,tokens,transport))await db.prepare("DELETE FROM cloudflare_token_vault WHERE id=? AND state='revoking' AND revoke_attempt=?").bind(row.id,attempt).run();}
  catch{/* Keep encrypted work for retry. The lease prevents overlapping revocations. */}
 }
}
export async function cloudflareStatus(db:D1Database,userId:string,config:CloudflareConfig|undefined){
 const row=await db.prepare("SELECT id,created_at,expires_at FROM cloudflare_token_vault WHERE user_id=? AND state='active' AND expires_at>?").bind(userId,now()).first<{created_at:string;expires_at:string}>();
 const pending=await db.prepare("SELECT COUNT(*) n FROM cloudflare_token_vault WHERE user_id=? AND state='revoking' AND expires_at>?").bind(userId,now()).first<{n:number}>();
 return {enabled:!!config,connected:!!config&&!!row,expiresAt:row?.expires_at??null,connectedAt:row?.created_at??null,revocationPending:!!pending?.n,dnsChangesEnabled:!!config&&!!row};
}
export async function startCloudflare(db:D1Database,userId:string,sessionHash:string,configuration:CloudflareConfig|undefined){
 const config=required(configuration),state=newSessionToken(),stateHash=await hashToken(state),verifier=newSessionToken();
 const challenge=btoa(Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))),b=>String.fromCharCode(b)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
 const stamp=now();
 await db.prepare('DELETE FROM cloudflare_token_vault WHERE user_id=? AND expires_at<=?').bind(userId,stamp).run();
 const result=await db.prepare(`INSERT INTO cloudflare_oauth_states(user_id,state_hash,session_hash,verifier_ciphertext,expires_at)
 SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM cloudflare_token_vault WHERE user_id=? AND expires_at>?)
 ON CONFLICT(user_id) DO UPDATE SET state_hash=excluded.state_hash,session_hash=excluded.session_hash,verifier_ciphertext=excluded.verifier_ciphertext,expires_at=excluded.expires_at,claimed=0,cancelled=0
 WHERE (cloudflare_oauth_states.claimed=0 OR cloudflare_oauth_states.expires_at<=?) AND NOT EXISTS(SELECT 1 FROM cloudflare_token_vault WHERE user_id=? AND expires_at>?)`).bind(userId,stateHash,sessionHash,await seal(config.key,aad(userId,stateHash,'pkce'),verifier),new Date(Date.now()+600000).toISOString(),userId,stamp,stamp,userId,stamp).run();
 if(result.meta.changes!==1)throw new ConnectionError(409,'Disconnect existing Cloudflare access and finish pending authorization or revocation before connecting again. An interrupted authorization may take ten minutes to expire.');
 const url=new URL('https://dash.cloudflare.com/oauth2/auth');for(const [k,v] of Object.entries({client_id:config.clientId,response_type:'code',redirect_uri:callback,scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(k,v);
 return {url:url.href};
}
export async function cancelCloudflare(db:D1Database,userId:string,sessionHash:string,state:string){
 if(!/^[0-9a-f]{64}$/.test(state))return;
 await db.prepare('UPDATE cloudflare_oauth_states SET cancelled=1 WHERE user_id=? AND session_hash=? AND state_hash=?').bind(userId,sessionHash,await hashToken(state)).run();
}
export async function finishCloudflare(db:D1Database,userId:string,sessionHash:string,state:string,code:string,configuration:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 const config=required(configuration);if(!/^[0-9a-f]{64}$/.test(state)||!code||code.length>2048||/[\x00-\x20\x7f]/.test(code))throw new ConnectionError(400,'Invalid Cloudflare authorization response.');
 const stateHash=await hashToken(state),flow=await db.prepare('UPDATE cloudflare_oauth_states SET claimed=1 WHERE user_id=? AND state_hash=? AND session_hash=? AND claimed=0 AND cancelled=0 AND expires_at>? RETURNING verifier_ciphertext').bind(userId,stateHash,sessionHash,now()).first<{verifier_ciphertext:string}>();
 if(!flow)throw new ConnectionError(400,'This Cloudflare authorization expired, was cancelled or was already used.');
 const verifier=await unseal(config.key,aad(userId,stateHash,'pkce'),flow.verifier_ciphertext);
 const data=await json(await request('https://dash.cloudflare.com/oauth2/token',{method:'POST',headers:oauthHeaders(config),body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback,code_verifier:verifier})},transport));
 const validToken=(value:unknown):value is string=>typeof value==='string'&&/^[\x21-\x7e]{1,3500}$/.test(value);
 if(!validToken(data.access_token)||data.refresh_token!==undefined&&!validToken(data.refresh_token))throw new ConnectionError(503,'Cloudflare returned an invalid credential. Revoke the application in Cloudflare settings before trying again.');
 const tokens:Tokens={access:data.access_token,...(typeof data.refresh_token==='string'?{refresh:data.refresh_token}:{})};
 const validLifetime=Number.isSafeInteger(data.expires_in)&&Number(data.expires_in)>0&&Number(data.expires_in)<=28800;
 const expiry=validLifetime&&!tokens.refresh?new Date(Date.now()+Number(data.expires_in)*1000).toISOString():'9999-12-31T23:59:59.999Z',tokenId=crypto.randomUUID();
 try{await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'staged')").bind(tokenId,userId,await seal(config.key,aad(userId,tokenId,'token'),JSON.stringify(tokens)),expiry,now()).run();}
 catch{const saved=await db.prepare('SELECT id FROM cloudflare_token_vault WHERE id=? AND user_id=?').bind(tokenId,userId).first();if(!saved){try{await revoke(config,tokens,transport);}catch{}throw new ConnectionError(503,'Cloudflare access could not be saved. Revoke the application in Cloudflare settings.');}}
 try{
  // RFC 6749: omitted scope means exactly the originally requested scope.
  const granted=data.scope===undefined?scopes:typeof data.scope==='string'?data.scope.split(/\s+/).filter(Boolean):[];
  if(!validLifetime||tokens.refresh||String(data.token_type).toLowerCase()!=='bearer'||scopes.some(s=>!granted.includes(s))||granted.some(s=>!scopes.includes(s)))throw new ConnectionError(503,'Cloudflare must grant only the requested DNS/zone scopes with an expiring bearer token and no refresh token.');
  let applied;
  try{applied=await db.batch([
   db.prepare("UPDATE cloudflare_token_vault SET state='active' WHERE id=? AND user_id=? AND state='staged' AND EXISTS(SELECT 1 FROM cloudflare_oauth_states WHERE user_id=? AND state_hash=? AND session_hash=? AND claimed=1 AND cancelled=0 AND expires_at>?)").bind(tokenId,userId,userId,stateHash,sessionHash,now()),
   db.prepare('DELETE FROM cloudflare_oauth_states WHERE user_id=? AND state_hash=?').bind(userId,stateHash)
  ]);}catch{if(await db.prepare("SELECT id FROM cloudflare_token_vault WHERE id=? AND user_id=? AND state='active'").bind(tokenId,userId).first())return {connected:true};throw new ConnectionError(503,'Cloudflare connection could not be confirmed. Refresh its status.');}
  if(applied[0].meta.changes!==1)throw new ConnectionError(409,'Cloudflare authorization was cancelled before it completed.');
  return {connected:true};
 }finally{await db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE id=? AND state='staged'").bind(tokenId).run();await cleanupCloudflare(db,config,transport);}
}
export async function disconnectCloudflare(db:D1Database,userId:string,configuration:CloudflareConfig|undefined,transport:typeof fetch=fetch){
 await db.batch([db.prepare('UPDATE cloudflare_oauth_states SET cancelled=1 WHERE user_id=?').bind(userId),db.prepare("UPDATE cloudflare_token_vault SET state='revoking' WHERE user_id=?").bind(userId)]);
 await cleanupCloudflare(db,configuration,transport);return cloudflareStatus(db,userId,configuration);
}
export async function cloudflareZones(db:D1Database,userId:string,configuration:CloudflareConfig|undefined,page=1,transport:typeof fetch=fetch){
 const config=required(configuration);if(!Number.isSafeInteger(page)||page<1||page>100)throw new ConnectionError(400,'Choose a valid zone page.');
 const row=await db.prepare("SELECT id,ciphertext FROM cloudflare_token_vault WHERE user_id=? AND state='active' AND expires_at>?").bind(userId,now()).first<{id:string;ciphertext:string}>();
 if(!row)throw new ConnectionError(401,'Connect Cloudflare to view authorized zones.');
 const tokens=JSON.parse(await unseal(config.key,aad(userId,row.id,'token'),row.ciphertext)) as Tokens;
 const data=await json(await request('https://api.cloudflare.com/client/v4/zones?per_page=50&page='+page,{headers:{authorization:'Bearer '+tokens.access}},transport));
 if(data.success!==true||!Array.isArray(data.result)||data.result.length>50)throw new ConnectionError(503,'Cloudflare returned invalid zone data.');
 // Disconnect during the provider read must not return a stale authorized result.
 if(!(await db.prepare("SELECT id FROM cloudflare_token_vault WHERE id=? AND user_id=? AND state='active' AND expires_at>?").bind(row.id,userId,now()).first()))throw new ConnectionError(401,'Cloudflare access changed. Refresh its status.');
 const zones=data.result.flatMap((entry:unknown)=>{if(!entry||typeof entry!=='object')return [];const z=entry as Record<string,unknown>;return typeof z.id==='string'&&/^[0-9a-f]{32}$/.test(z.id)&&typeof z.name==='string'&&z.name.length<=253&&/^[a-z0-9.-]+$/.test(z.name)?[{id:z.id,name:z.name,status:z.status==='active'?'active':'not_active'}]:[];});
 const info=data.result_info as Record<string,unknown>|undefined;
 return {zones,page,hasMore:typeof info?.total_pages==='number'&&info.total_pages>page};
}

/** Server-only capability; each call rechecks the owner's exact current credential. */
export async function cloudflareAccess(db:D1Database,userId:string,configuration:CloudflareConfig|undefined,transport:typeof fetch=fetch,expectedToken?:string){
 const config=required(configuration);
 const row=await db.prepare("SELECT id FROM cloudflare_token_vault WHERE user_id=? AND state='active' AND expires_at>?").bind(userId,now()).first<{id:string}>();
 if(!row||expectedToken&&row.id!==expectedToken)throw new ConnectionError(401,'Cloudflare access changed. Connect and prepare a fresh DNS review.');
 return {tokenId:row.id,async send(path:string,method:'GET'|'POST'='GET',body?:unknown){
  if(!/^\/zones\/[0-9a-f]{32}(?:\/dns_records(?:\/[0-9a-f]{32})?)?(?:\?[^#]*)?$/.test(path)||method==='POST'&&!/^\/zones\/[0-9a-f]{32}\/dns_records$/.test(path))throw new ConnectionError(400,'Invalid Cloudflare DNS operation.');
  const active=await db.prepare("SELECT ciphertext FROM cloudflare_token_vault WHERE id=? AND user_id=? AND state='active' AND expires_at>?").bind(row.id,userId,now()).first<{ciphertext:string}>();
  if(!active)throw new ConnectionError(401,'Cloudflare access changed. Refresh its status.');
  const tokens=JSON.parse(await unseal(config.key,aad(userId,row.id,'token'),active.ciphertext)) as Tokens;
  return json(await request('https://api.cloudflare.com/client/v4'+path,{method,headers:{authorization:'Bearer '+tokens.access,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},transport));
 }};
}
export type {CloudflareConfig};

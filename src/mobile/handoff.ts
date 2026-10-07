import {hashToken,newSessionToken} from '../security';
import {assertCurrentIdentity,identityPredicate,resolveIdentity,type IdentityPrincipal} from '../workspace-identity/authority';
import {workspaceIdentity} from '../workspace-identity/http';
import {identityRequestContext} from '../workspace-identity/protocol';
import {MobileError,browserReturn,iso,maskAccount,mobileErrorResponse,mobileInput,mobileResponse,mobileUUID,nativeIdentityConfiguration,sessionInfo,versioned,type MobileEnvironment} from './protocol';

const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:true} as const;
const source=`EXISTS(SELECT 1 FROM identity_current_authorities a WHERE a.kind='session' AND a.client='web'
 AND a.authority_id=mobile_identity_handoffs.source_session_id AND a.account_id=mobile_identity_handoffs.account_id
 AND a.auth_epoch=mobile_identity_handoffs.auth_epoch)`;
const proof=()=>new MobileError('proof_required',{proof:'signin'});
export async function cleanMobileHandoffs(db:D1Database){
 return db.prepare('DELETE FROM mobile_identity_handoffs WHERE id IN (SELECT id FROM mobile_identity_handoffs WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)').run();
}
export async function startMobileHandoff(env:MobileEnvironment,input:unknown){
 const data=versioned(input,['purpose','state','codeChallenge','codeChallengeMethod','redirectUri'],env);
 if(!['signin','signup','recovery'].includes(String(data.purpose))||typeof data.state!=='string'||! /^[A-Za-z0-9_-]{16,128}$/.test(data.state)
  ||typeof data.codeChallenge!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(data.codeChallenge)||data.codeChallengeMethod!=='S256'||data.redirectUri!==browserReturn)throw new MobileError('invalid_request');
 const signing=nativeIdentityConfiguration(env),id=crypto.randomUUID(),browserToken=newSessionToken();
 await cleanMobileHandoffs(env.DB);
 const saved=await env.DB.prepare(`INSERT INTO mobile_identity_handoffs(id,browser_hash,purpose,state_hash,code_challenge,redirect_uri,signing_origin,created_at,expires_at)
  VALUES(?,?,?,?,?,?,?,unixepoch(),unixepoch()+300) RETURNING expires_at`).bind(id,await hashToken(browserToken),data.purpose,await hashToken(data.state),data.codeChallenge,browserReturn,signing.origin).first<{expires_at:number}>();
 if(!saved)throw new MobileError('unavailable');
 return {handoffId:id,browserPath:'/workspace/native/'+browserToken,expiresAt:iso(saved.expires_at)};
}
async function browserInput(request:Request,env:MobileEnvironment){
 identityRequestContext(request,env);
 if(request.headers.has('authorization')||new URL(request.url).search)throw new MobileError('invalid_request');
 const data=versioned(await mobileInput(request),['browserToken'],env);
 if(typeof data.browserToken!=='string'||! /^[0-9a-f]{64}$/.test(data.browserToken))throw new MobileError('invalid_request');
 const principal=await workspaceIdentity(request,env);
 if(principal.client!=='web')throw proof();
 return {hash:await hashToken(data.browserToken),principal};
}
export async function readMobileHandoff(env:MobileEnvironment,browserHash:string,p:IdentityPrincipal){
 if(p.client!=='web')throw proof();
 const gate=identityPredicate(env.DB,p,workspace),signing=nativeIdentityConfiguration(env);
 // Bind the browser's current account/session before showing the confirmation. A later
 // account switch, browser reauthentication, revocation or recovery cannot change it.
 await env.DB.prepare(`UPDATE mobile_identity_handoffs SET account_id=?,source_session_id=?,auth_epoch=?
  WHERE browser_hash=? AND source_session_id IS NULL AND expires_at>unixepoch() AND signing_origin=? AND ${gate.sql}`)
  .bind(p.accountId,p.authorityId,p.authEpoch,browserHash,signing.origin,...gate.params).run();
 const row=await env.DB.prepare(`SELECT h.purpose,u.email FROM mobile_identity_handoffs h JOIN users u ON u.id=h.account_id
  WHERE h.browser_hash=? AND h.source_session_id=? AND h.account_id=? AND h.auth_epoch=? AND h.expires_at>unixepoch()
  AND h.code_hash IS NULL AND h.signing_origin=? AND ${gate.sql}`)
  .bind(browserHash,p.authorityId,p.accountId,p.authEpoch,signing.origin,...gate.params).first<{purpose:string;email:string}>();
 if(!row)throw proof();
 await assertCurrentIdentity(env.DB,p,workspace);
 return {account:{label:maskAccount(row.email)},purpose:row.purpose};
}
export async function completeMobileHandoff(env:MobileEnvironment,browserHash:string,p:IdentityPrincipal){
 if(p.client!=='web')throw proof();
 const gate=identityPredicate(env.DB,p,workspace),code=newSessionToken(),signing=nativeIdentityConfiguration(env);
 const row=await env.DB.prepare(`UPDATE mobile_identity_handoffs SET code_hash=?,code_expires_at=min(expires_at,unixepoch()+60)
  WHERE browser_hash=? AND source_session_id=? AND account_id=? AND auth_epoch=? AND expires_at>unixepoch()
  AND code_hash IS NULL AND signing_origin=? AND ${gate.sql} RETURNING id`)
  .bind(await hashToken(code),browserHash,p.authorityId,p.accountId,p.authEpoch,signing.origin,...gate.params).first<{id:string}>();
 if(!row)throw proof();
 // State is returned by the app; the browser never needs its value. App Link parsing
 // binds handoffId and the local state before exchange. No bearer enters a URL.
 return {returnUrl:browserReturn+'?handoffId='+row.id+'&code='+code};
}
export async function exchangeMobileHandoff(env:MobileEnvironment,input:unknown){
 const data=versioned(input,['handoffId','code','state','codeVerifier'],env);
 if(typeof data.handoffId!=='string'||!mobileUUID.test(data.handoffId)||typeof data.code!=='string'||! /^[0-9a-f]{64}$/.test(data.code)
  ||typeof data.state!=='string'||! /^[A-Za-z0-9_-]{16,128}$/.test(data.state)||typeof data.codeVerifier!=='string'||! /^[A-Za-z0-9._~-]{43,128}$/.test(data.codeVerifier))throw new MobileError('invalid_request');
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.codeVerifier)));
 const challenge=btoa(String.fromCharCode(...digest)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const signing=nativeIdentityConfiguration(env),nonce=crypto.randomUUID(),token=newSessionToken(),id=crypto.randomUUID();
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE mobile_identity_handoffs SET consumed_at=unixepoch(),exchange_nonce=?
   WHERE id=? AND code_hash=? AND state_hash=? AND code_challenge=? AND signing_origin=? AND redirect_uri=?
   AND consumed_at IS NULL AND expires_at>unixepoch() AND code_expires_at>unixepoch() AND ${source}`)
   .bind(nonce,data.handoffId,await hashToken(data.code),await hashToken(data.state),challenge,signing.origin,browserReturn),
  env.DB.prepare(`INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at)
   SELECT ?,?,a.account_id,1,a.auth_epoch,'android',a.credential_id,'passkey',a.proof_at,unixepoch(),a.expires_at
   FROM mobile_identity_handoffs h JOIN identity_current_authorities a ON a.authority_id=h.source_session_id AND a.account_id=h.account_id
   WHERE h.id=? AND h.exchange_nonce=? AND h.auth_epoch=a.auth_epoch AND a.kind='session' AND a.client='web'
   AND a.expires_at>unixepoch() AND h.signing_origin=?`)
   .bind(id,await hashToken(token),data.handoffId,nonce,signing.origin)
 ]);
 if(results[0].meta.changes!==1||results[1].meta.changes!==1)throw proof();
 const p=await resolveIdentity(env.DB,{version:1,client:'android',kind:'session',token});
 return {session:{token,...sessionInfo(p)}};
}
/** Cookie transport remains outside /api/mobile, with the unchanged exact Origin rule. */
export async function handleMobileHandoffRequest(request:Request,env:MobileEnvironment):Promise<Response|null>{
 const path=new URL(request.url).pathname;if(!path.startsWith('/api/mobile-handoff/'))return null;
 try{
  const key=request.headers.get('cf-connecting-ip')??'local';
  if(!(await env.API_LIMITER.limit({key})).success||!(await env.AUTH_LIMITER.limit({key:'native-handoff:'+key})).success)throw new MobileError('rate_limited',{retryAfterSeconds:60});
  if(!['/api/mobile-handoff/v1/read','/api/mobile-handoff/v1/complete'].includes(path))throw new MobileError('not_found');
  const {hash,principal}=await browserInput(request,env);
  return mobileResponse(path.endsWith('/read')?await readMobileHandoff(env,hash,principal):await completeMobileHandoff(env,hash,principal));
 }catch(error){return mobileErrorResponse(error,env);}
}
/** No generated/customer content, provider credentials or bearer enters this browser page. */
export function mobileHandoffPage(request:Request):Response|null{
 const url=new URL(request.url);
 if(url.pathname==='/app/return')return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo Android return</title><main><h1>Open Whumpo for Android</h1><p>This link could not open the app. Return to the installed app and start a new browser sign-in.</p></main></html>',{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; base-uri 'none'; frame-ancestors 'none'"}});
 const match=url.pathname.match(/^\/workspace\/native\/([0-9a-f]{64})$/);if(!match)return null;
 if(request.method!=='GET'||url.search||request.headers.has('authorization'))return new Response('Not found',{status:404});
 const nonce=newSessionToken();
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Return to Whumpo for Android</title><main><h1>Return to Whumpo for Android</h1><p>Finish sign-in, account setup or recovery in your browser. Then return here to confirm the account for your app.</p><p><a href="/workspace" target="_blank" rel="noopener">Open sign-in or recovery</a> · <a href="/workspace?signup=true" target="_blank" rel="noopener">Create an invited account</a> · <a href="/workspace/support" target="_blank" rel="noopener">Help</a></p><p id="status" role="status" aria-live="polite"></p><button id="continue" type="button">Check signed-in account</button></main><script nonce="${nonce}">const button=document.getElementById('continue'),status=document.getElementById('status');let confirmed=false;button.onclick=async()=>{button.disabled=true;try{const response=await fetch('/api/mobile-handoff/v1/'+(confirmed?'complete':'read'),{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,browserToken:'${match[1]}'})});const data=await response.json();if(!response.ok){status.textContent=data.error?.message||'Start again from the app.';return;}if(confirmed){const next=new URL(data.returnUrl);if(next.origin!=='https://whumpo.com'||next.pathname!=='/app/return')throw Error();location.assign(next.href);}else{status.textContent='Continue as '+data.account.label+'?';button.textContent='Continue to the Android app';confirmed=true;}}catch{status.textContent='The reply did not arrive. Start a new browser return from the app.';}finally{button.disabled=false;}};</script></html>`;
 return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`}});
}

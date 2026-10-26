import {hashToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,resolveIdentity,type IdentityPrincipal} from './authority';
import {identityRecord,identityRequestContext,identityUnavailable,invalidIdentityRequest,identityChanged,type IdentityEnvironment} from './protocol';
import {signupOptions,signupVerify,loginOptions,loginVerify,addPasskeyOptions,addPasskeyVerify,reauthenticationOptions,reauthenticationVerify} from './ceremonies';
import {readKitState,prepareKit,acknowledgeKit,rotateKit,completeEnrollment,cancelEnrollment} from './kits';
import {startRecovery,readRecoveryState,reviewRecovery,secureRecovery,recoveryCompletionOptions,recoveryCompletionVerify,removePasskey} from './recovery';
import type {IdentityState,IdentityKey} from './presentation';

type Environment=IdentityEnvironment&Pick<Env,'AUTH_LIMITER'|'API_LIMITER'|'TURNSTILE_SITE_KEY'>;
type Authority={kind:'session'|'grant';token:string;principal:IdentityPrincipal};
const prefix='/api/auth/identity/',versionPrefix=prefix+'v1/';
export const identityCookies={session:'__Host-whumpo_session',grant:'__Secure-whumpo_identity_grant',challenge:'__Secure-whumpo_identity_challenge'} as const;
type CookieKind=keyof typeof identityCookies;
function cookie(kind:CookieKind,token:string,expiresAt:number){
 // Secure is mandatory, including localhost. Ordinary Lax permits the reviewed OAuth
 // top-level return; restricted grants/challenges stay Strict. Origin still gates all POSTs.
 return `${identityCookies[kind]}=${token}; Path=${kind==='session'?'/':prefix}; Secure; HttpOnly; SameSite=${kind==='session'?'Lax':'Strict'}; Expires=${new Date(expiresAt*1000).toUTCString()}`;
}
function clear(headers:Headers,kind:CookieKind){headers.append('set-cookie',cookie(kind,'',0));}
function clearAll(headers:Headers){for(const kind of ['session','grant','challenge'] as const)clear(headers,kind);}
function token(request:Request,kind:CookieKind){
 const parts=(request.headers.get('cookie')??'').split(';').map(v=>v.trim()).filter(v=>v.split('=',1)[0]===identityCookies[kind]);
 if(parts.length>1)throw invalidIdentityRequest();
 if(!parts.length)return null;
 const value=parts[0].slice(identityCookies[kind].length+1);
 if(!/^[a-f0-9]{64}$/.test(value))throw new IdentityError(401,'proof_required','Sign in again to continue.');
 return value;
}
function selected(request:Request){
 const session=token(request,'session'),grant=token(request,'grant');
 if(session&&grant)throw invalidIdentityRequest();
 return grant?{kind:'grant' as const,token:grant}:session?{kind:'session' as const,token:session}:null;
}
async function principal(request:Request,env:IdentityEnvironment){
 const proof=selected(request);if(!proof)throw new IdentityError(401,'proof_required','Sign in to continue.');
 return resolveIdentity(env.DB,{version:1,client:'web',...proof});
}
/** Workspace callers explicitly select only ordinary authority; no grant or old cookie reader. */
export async function workspaceIdentity(request:Request,env:IdentityEnvironment){
 const p=await resolveIdentity(env.DB,{version:1,client:'web',kind:'session',token:token(request,'session')});
 await assertCurrentIdentity(env.DB,p,{purpose:'workspace',freshPasskey:false,bindIdentityRevision:false});return p;
}
function issued(headers:Headers,authority:Authority){
 clear(headers,authority.kind==='session'?'grant':'session');clear(headers,'challenge');
 headers.append('set-cookie',cookie(authority.kind,authority.token,authority.principal.expiresAt));
 return {version:1,purpose:authority.principal.purpose};
}
function challenged(headers:Headers,result:{completed:unknown}|{options:unknown;challengeToken:string}){
 clear(headers,'challenge');
 if('completed'in result)return {version:1,completed:result.completed};
 headers.append('set-cookie',cookie('challenge',result.challengeToken,Math.floor(Date.now()/1000)+300));
 return {version:1,options:result.options};
}
function effect(headers:Headers,result:{receipt:unknown;authority:Authority|null}){
 if(result.authority)issued(headers,result.authority);
 return {version:1,receipt:result.receipt};
}
async function input(request:Request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw invalidIdentityRequest();
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>73728))throw invalidIdentityRequest();
 const reader=request.body?.getReader();if(!reader)throw invalidIdentityRequest();
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>73728)throw invalidIdentityRequest();chunks.push(chunk.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)) as unknown;}catch{throw invalidIdentityRequest();}
}
export async function readIdentityState(env:IdentityEnvironment,p:IdentityPrincipal):Promise<IdentityState>{
 const policy={purpose:p.purpose,freshPasskey:false,bindIdentityRevision:true},gate=identityPredicate(env.DB,p,policy);
 const user=await env.DB.prepare(`SELECT email,unixepoch() now FROM users WHERE id=? AND ${gate.sql}`).bind(p.accountId,...gate.params).first<{email:string;now:number}>();
 if(!user)throw identityChanged();
 const keys=await env.DB.prepare(`SELECT id,name,status,created_at FROM identity_credentials WHERE account_id=? AND ${gate.sql} ORDER BY created_at,id`).bind(p.accountId,...gate.params).all<IdentityKey>();
 const kit=await readKitState(env.DB,p);
 const progress=p.purpose==='recovery'?await readRecoveryState(env.DB,p):null;
 const canComplete=progress?!!await env.DB.prepare(`SELECT 1 FROM identity_recovery_ready WHERE attempt_id=? AND account_id=? AND ${gate.sql}`).bind(p.attempt!.id,p.accountId,...gate.params).first():false;
 // Reject a mixed snapshot if a review, key, kit or epoch changed between reads.
 await assertCurrentIdentity(env.DB,p,policy);
 return {accountId:p.accountId,email:user.email,purpose:p.purpose,stage:p.stage,attemptId:p.attempt?.id??null,
  expectedRevision:p.attempt?.revision??p.credentialRevision,expectedEpoch:p.authEpoch,keys:keys.results,
  freshPasskey:p.proof.method==='passkey'&&p.proof.verifiedAt>user.now-600&&p.proof.attemptRevision===(p.attempt?.revision??null),
  expiresAt:p.expiresAt,kit,recovery:progress?{status:progress.status,review:progress.review,canComplete}:null};
}
async function logout(request:Request,env:IdentityEnvironment){
 const proof=selected(request),challenge=token(request,'challenge');
 const statements=[];
 if(proof){
  const table=proof.kind==='session'?'identity_sessions':'identity_grants',hash=await hashToken(proof.token);
  statements.push(env.DB.prepare(`DELETE FROM identity_challenges WHERE authority_kind=? AND authority_id IN (SELECT id FROM ${table} WHERE token_hash=?)`).bind(proof.kind,hash));
  statements.push(env.DB.prepare(`DELETE FROM ${table} WHERE token_hash=?`).bind(hash));
 }
 if(challenge)statements.push(env.DB.prepare('DELETE FROM identity_challenges WHERE token_hash=?').bind(await hashToken(challenge)));
 if(statements.length)await env.DB.batch(statements);
 return {version:1,signedOut:true};
}
/** Isolated current transport; the coordinated cutover installs this as the sole identity router. */
export async function handleIdentityRequest(request:Request,env:Environment):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(prefix))return null;
 const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 try{
  identityRequestContext(request,env);
  if(!url.pathname.startsWith(versionPrefix))throw new IdentityError(409,'client_upgrade_required','Update Whumpo to continue.');
  if(url.search)throw invalidIdentityRequest();
  const action=url.pathname.slice(versionPrefix.length);
  if(action.endsWith('/verify'))clear(headers,'challenge');
  if(action==='logout')clearAll(headers);
  const limiterKey=request.headers.get('cf-connecting-ip')??'local';
  if(!(await env.API_LIMITER.limit({key:limiterKey})).success
   ||(!['state','config','logout'].includes(action)&&!(await env.AUTH_LIMITER.limit({key:limiterKey})).success))return respond({error:'Too many identity requests. Try again in a minute.',code:'rate_limited'},429);
  let data:unknown;
  try{data=await input(request);}catch(error){
   // A same-origin, admitted verification attempt burns its proof even when JSON
   // decoding/size validation fails before the domain verifier can consume it.
   if(action.endsWith('/verify')){const challenge=token(request,'challenge');if(challenge)await env.DB.prepare('DELETE FROM identity_challenges WHERE token_hash=?').bind(await hashToken(challenge)).run();}
   throw error;
  }
  if(action==='config'){identityRecord(data,['version']);if(!env.TURNSTILE_SITE_KEY)throw identityUnavailable();return respond({version:1,inviteRequired:true,turnstileSiteKey:env.TURNSTILE_SITE_KEY});}
  if(action==='logout'){identityRecord(data,['version']);return respond(await logout(request,env));}
  if(action==='state'){
   identityRecord(data,['version']);const proof=selected(request);
   return respond({version:1,identity:proof?await readIdentityState(env,await resolveIdentity(env.DB,{version:1,client:'web',...proof})):null});
  }
  if(action==='signup/options')return respond(challenged(headers,await signupOptions(request,env,data)));
  if(action==='signup/verify')return respond(issued(headers,await signupVerify(request,env,token(request,'challenge'),data)));
  if(action==='login/options')return respond(challenged(headers,await loginOptions(request,env,data)));
  if(action==='login/verify')return respond(issued(headers,await loginVerify(request,env,token(request,'challenge'),data)));
  if(action==='recovery/start')return respond(issued(headers,await startRecovery(request,env,data)));
  const p=await principal(request,env);
  switch(action){
   case 'add/options':return respond(challenged(headers,await addPasskeyOptions(request,env,p,data)));
   case 'add/verify':return respond({version:1,...await addPasskeyVerify(request,env,p,token(request,'challenge'),data)});
   case 'reauth/options':return respond(challenged(headers,await reauthenticationOptions(request,env,p,data)));
   case 'reauth/verify':return respond(issued(headers,await reauthenticationVerify(request,env,p,token(request,'challenge'),data)));
   case 'kit/prepare':return respond({version:1,...await prepareKit(request,env,p,data)});
   case 'kit/save':return respond({version:1,...await acknowledgeKit(request,env,p,data)});
   case 'kit/rotate':return respond(effect(headers,await rotateKit(request,env,p,data)));
   case 'enrollment/complete':return respond(effect(headers,await completeEnrollment(request,env,p,data)));
   case 'enrollment/cancel':{const result=await cancelEnrollment(request,env,p,data);clearAll(headers);return respond({version:1,...result});}
   case 'recovery/review':return respond({version:1,...await reviewRecovery(request,env,p,data)});
   case 'recovery/secure':return respond(effect(headers,await secureRecovery(request,env,p,data)));
   case 'recovery/complete/options':return respond(challenged(headers,await recoveryCompletionOptions(request,env,p,data)));
   case 'recovery/complete/verify':return respond(effect(headers,await recoveryCompletionVerify(request,env,p,token(request,'challenge'),data)));
   case 'passkey/remove':{const result=await removePasskey(request,env,p,data);clearAll(headers);return respond({version:1,...result});}
   default:return respond({error:'This identity action is not supported.',code:'client_upgrade_required'},409);
  }
 }catch(error){
  // Unexpected errors may contain SQL/provider details. They are never serialized or logged here.
  // DEBUG-TEMP identity-error-log: remove after the signup outage is diagnosed.
  if(!(error instanceof IdentityError))console.error('DEBUG-TEMP identity',String((error as Error)?.name),String((error as Error)?.message).slice(0,300),String((error as Error)?.stack??'').split('\n').slice(0,3).join(' | ').slice(0,400));
  const failure=error instanceof IdentityError?error:identityUnavailable();return respond({error:failure.message,code:failure.code},failure.status);
 }
}

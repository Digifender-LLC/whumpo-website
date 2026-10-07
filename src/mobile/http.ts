import {assertCurrentIdentity,identityPredicate,resolveIdentity} from '../workspace-identity/authority';
import {loginOptions,loginVerify,reauthenticationOptions,reauthenticationVerify} from '../workspace-identity/ceremonies';
import {exchangeMobileHandoff,startMobileHandoff} from './handoff';
import {MobileError,admitMobileClient,browserReturn,iso,maskAccount,minimumBuild,mobileErrorResponse,mobileInput,mobilePrefix,mobileRequestContext,mobileResponse,mobileUUID,nativeIdentityConfiguration,sessionInfo,versioned,type MobileEnvironment} from './protocol';

import {mobileWorkspace,mobileWorkspaceOperation} from './workspace';

const anonymous=new Set(['GET /config','POST /session/login/options','POST /session/login/verify','POST /session/handoff/start','POST /session/handoff/exchange']);
const authenticated=new Set(['GET /session','POST /session/logout','POST /session/reauth/options','POST /session/reauth/verify']);
const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:false} as const;
/** Closed native transport. No generic proxy to cookie workspace routes. */
export async function handleMobileRequest(request:Request,env:Env,ctx:ExecutionContext):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/api/mobile'&&!url.pathname.startsWith('/api/mobile/'))return null;
 try{
  const path=url.pathname.slice(mobilePrefix.length),operation=request.method+' '+path;
  const client=admitMobileClient(request,env,operation==='GET /config'),isWorkspace=mobileWorkspaceOperation(request.method,path),isAuthenticated=authenticated.has(operation)||isWorkspace;
  if(!url.pathname.startsWith(mobilePrefix+'/'))throw new MobileError('client_update_required',{minimumBuild:minimumBuild(env),contract:1,next:'update_app'});
  if(url.search&&!isWorkspace)throw new MobileError('invalid_request');
  if(!anonymous.has(operation)&&!isAuthenticated)throw new MobileError('not_found');
  const authorization=request.headers.get('authorization');
  if(anonymous.has(operation)&&authorization!==null)throw new MobileError('invalid_request');
  const address=request.headers.get('cf-connecting-ip')??'local';
  if(!(await env.API_LIMITER.limit({key:address})).success||(!['GET /config','GET /session','POST /session/logout'].includes(operation)&&!isWorkspace&&!(await env.AUTH_LIMITER.limit({key:'native:'+address})).success))throw new MobileError('rate_limited',{retryAfterSeconds:60});
  if(operation==='GET /config')return mobileResponse({contract:1,minimumBuild:minimumBuild(env),rpId:'whumpo.com',browserReturn});
  const rp=mobileRequestContext(request,env);
  const token=isAuthenticated?/^Bearer ([a-f0-9]{64})$/.exec(authorization??'')?.[1]:null;
  if(isAuthenticated&&!token)throw new MobileError('proof_required',{proof:'signin'});
  const p=token?await resolveIdentity(env.DB,{version:1,client:'android',kind:'session',token}):null;
  if(p){
   await assertCurrentIdentity(env.DB,p,workspace);
   if(!(await env.API_LIMITER.limit({key:'native-session:'+p.authorityId})).success)throw new MobileError('rate_limited',{retryAfterSeconds:60});
  }
  if(isWorkspace)return await mobileWorkspace(request,env,p!,client,ctx);
  if(operation==='GET /session'){
   const gate=identityPredicate(env.DB,p!,workspace);
   const user=await env.DB.prepare(`SELECT email FROM users WHERE id=? AND ${gate.sql}`).bind(p!.accountId,...gate.params).first<{email:string}>();
   if(!user)throw new MobileError('identity_changed');
   return mobileResponse({session:sessionInfo(p!),account:{id:p!.accountId,label:maskAccount(user.email)}});
  }
  const input=await mobileInput(request);
  if(operation==='POST /session/handoff/start')return mobileResponse(await startMobileHandoff(env,input));
  if(operation==='POST /session/handoff/exchange')return mobileResponse(await exchangeMobileHandoff(env,input));
  if(path.endsWith('/options')){
   versioned(input,[],env);
   const result=p?await reauthenticationOptions(request,env,p,input,rp):await loginOptions(request,env,input,rp);
   const row=await env.DB.prepare("SELECT expires_at FROM identity_challenges WHERE id=? AND client='android'").bind(result.challengeToken).first<{expires_at:number}>();
   if(!row)throw new MobileError('unavailable');
   return mobileResponse({challengeId:result.challengeToken,expiresAt:iso(row.expires_at),options:result.options});
  }
  if(path.endsWith('/verify')){
   let data:Record<string,unknown>;
   try{data=versioned(input,['challengeId','credential'],env);if(new TextEncoder().encode(JSON.stringify(data.credential)).length>8192)throw new MobileError('payload_too_large');}catch(error){
    // Recognizable native challenges burn on invalid envelopes as on failed assertions.
    const id=(input as {challengeId?:unknown})?.challengeId;if(typeof id==='string'&&mobileUUID.test(id))await env.DB.prepare("DELETE FROM identity_challenges WHERE id=? AND client='android'").bind(id).run();throw error;
   }
   if(typeof data.challengeId!=='string'||!mobileUUID.test(data.challengeId))throw new MobileError('invalid_request');
   const result=p?await reauthenticationVerify(request,env,p,data.challengeId,{version:1,credential:data.credential},rp,token!):await loginVerify(request,env,data.challengeId,{version:1,credential:data.credential},rp);
   return mobileResponse({session:{...(!p?{token:result.token}:{}),...sessionInfo(result.principal)}});
  }
  versioned(input,[],env);
  const gate=identityPredicate(env.DB,p!,workspace);
  await env.DB.batch([
   env.DB.prepare("DELETE FROM identity_challenges WHERE authority_id=? AND client='android'").bind(p!.authorityId),
   env.DB.prepare(`DELETE FROM identity_sessions WHERE id=? AND client='android' AND ${gate.sql}`).bind(p!.authorityId,...gate.params)
  ]);
  return mobileResponse({signedOut:true});
 }catch(error){return mobileErrorResponse(error,env);}
}
export function mobileAssetLinks(env:MobileEnvironment){
 try{const c=nativeIdentityConfiguration(env);return new Response(JSON.stringify([{relation:['delegate_permission/common.handle_all_urls','delegate_permission/common.get_login_creds'],target:{namespace:'android_app',package_name:c.packageName,sha256_cert_fingerprints:[c.certificate]}}]),{headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}});}
 catch{return new Response('Not configured',{status:404,headers:{'cache-control':'no-store'}});}
}

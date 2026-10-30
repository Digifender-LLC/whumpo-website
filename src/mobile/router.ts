// Mounted first in handle(). Everything under /api/mobile is a native route: bearer only, never a cookie, never the browser Origin rule.
// Every other route refuses a bearer, so a native token cannot reach a web handler.
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {bearerToken,mobilePrincipal} from './auth';
import {config,loginOptionsOperation,loginVerifyOperation,logoutOperation,reauthOptionsOperation,reauthVerifyOperation,sessionOperation} from './identity';
import {bootstrap,chatList,chatTurn,confirmReview,reviewList,sendMessage,type MobileDeps} from './workspace';
import {MobileError,admitClient,refusal,signin,type MobileEnvironment} from './transport';

const base='/api/mobile',prefix='/api/mobile/v1/';
/** Admission shared by every mobile route, before any limiter or database work. */
function admit(request:Request,env:MobileEnvironment,isConfig:boolean,query=false){
 admitClient(request,env,isConfig);
 if(request.headers.has('cookie'))throw new MobileError('invalid_request');
 if(!query&&new URL(request.url).search)throw new MobileError('unknown_field');
 if(request.method==='GET'&&(request.body||(request.headers.get('content-length')??'0')!=='0'))throw new MobileError('invalid_request');
}
const ipOf=(request:Request)=>request.headers.get('cf-connecting-ip')??'local';
/** No authority: refuses a bearer, limited per IP by AUTH_LIMITER. */
async function anonymous(request:Request,env:MobileEnvironment,isConfig:boolean,run:()=>Response|Promise<Response>){
 admit(request,env,isConfig);
 if(request.headers.has('authorization'))throw new MobileError('invalid_request');
 if(!(await env.AUTH_LIMITER.limit({key:'mobile:'+ipOf(request)})).success)throw new MobileError('rate_limited');
 return run();
}
/** Bearer session: limited per IP, then per authority (API_LIMITER), after the token resolves to a current android session. */
async function authenticated(request:Request,env:MobileEnvironment,run:(principal:IdentityPrincipal,token:string)=>Response|Promise<Response>,query=false){
 admit(request,env,false,query);
 const token=bearerToken(request);
 if(!token)throw signin();
 if(!(await env.API_LIMITER.limit({key:'mobile:'+ipOf(request)})).success)throw new MobileError('rate_limited');
 const principal=await mobilePrincipal(env.DB,token);
 if(!(await env.API_LIMITER.limit({key:'mobile-account:'+principal.accountId})).success)throw new MobileError('rate_limited');
 return run(principal,token);
}
export async function handleMobileRequest(request:Request,env:MobileEnvironment,deps:MobileDeps):Promise<Response|null>{
 const url=new URL(request.url),method=request.method;
 if(url.pathname!==base&&!url.pathname.startsWith(base+'/')){
  // Bearer tokens are accepted only on mobile routes.
  return /^bearer\s/i.test(request.headers.get('authorization')??'')?Response.json({error:'Sign in to continue.',code:'proof_required'},{status:401,headers:{'cache-control':'no-store'}}):null;
 }
 const action=url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):'';
 try{
  if(method==='GET'&&action==='config')return await anonymous(request,env,true,()=>config(env));
  if(method==='POST'&&action==='session/login/options')return await anonymous(request,env,false,()=>loginOptionsOperation(request,env));
  if(method==='POST'&&action==='session/login/verify')return await anonymous(request,env,false,()=>loginVerifyOperation(request,env));
  if(method==='POST'&&action==='session/reauth/options')return await authenticated(request,env,p=>reauthOptionsOperation(request,env,p));
  if(method==='POST'&&action==='session/reauth/verify')return await authenticated(request,env,(p,token)=>reauthVerifyOperation(request,env,p,token));
  if(method==='GET'&&action==='session')return await authenticated(request,env,p=>sessionOperation(env,p));
  if(method==='POST'&&action==='session/logout')return await authenticated(request,env,(_p,token)=>logoutOperation(request,env,token));
  if(method==='GET'&&action==='bootstrap')return await authenticated(request,env,p=>bootstrap(env,p));
  if(method==='GET'&&action==='chat')return await authenticated(request,env,p=>chatList(request,env,p),true);
  const turnId=/^chat\/turns\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(action);
  if(method==='GET'&&turnId)return await authenticated(request,env,p=>chatTurn(request,env,p,turnId[1]));
  if(method==='POST'&&action==='chat/messages')return await authenticated(request,env,p=>sendMessage(request,env,p,deps));
  if(method==='GET'&&action==='reviews')return await authenticated(request,env,p=>reviewList(request,env,p));
  if(method==='POST'&&action==='reviews/confirm')return await authenticated(request,env,p=>confirmReview(request,env,p,deps));
  throw new MobileError('not_found');
 }catch(error){
  // Unexpected failures may carry SQL or provider detail and a token-bearing request: never serialized, never logged.
  return refusal(error instanceof MobileError?error:new MobileError('unavailable'),env);
 }
}

import {appPasskeyOptions,appPasskeyVerify,recoverAppVisitor} from './app-auth';
import {readAppData,readAppReceipt,revokeAppSession,transitionAppData} from './app-data';
import {BackendError} from './backend-versions';
import type {AuthenticationResponseJSON,RegistrationResponseJSON} from '@simplewebauthn/server';

type AppEnv = Pick<Env,'DB'|'ENVIRONMENT'|'AUTH_LIMITER'|'API_LIMITER'|'BACKEND_RUNTIME'>;
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const route=new RegExp(`^/apps/(${uuid})/(.+)$`);
const headers={
 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
 'x-content-type-options':'nosniff','referrer-policy':'no-referrer',
 'cross-origin-resource-policy':'same-origin','x-frame-options':'DENY',
 'content-security-policy':"default-src 'none'; frame-ancestors 'none'; sandbox"
};
function json(value:unknown,status=200,cookies:string[]=[]){const result=new Headers(headers);for(const cookie of cookies)result.append('set-cookie',cookie);return new Response(JSON.stringify(value),{status,headers:result});}
function cookieName(project:string,kind:'session'|'challenge',local:boolean){return `${local?'local-':'__Host-'}whumpo-app-${kind}-${project}`;}
function cookie(project:string,kind:'session'|'challenge',value:string,local:boolean){return `${cookieName(project,kind,local)}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value?(kind==='session'?86400:300):0}${local?'':'; Secure'}`;}
function token(request:Request,project:string,kind:'session'|'challenge',local:boolean){
 const name=cookieName(project,kind,local),matches=(request.headers.get('cookie')??'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'='));
 if(matches.length!==1)return '';
 const value=matches[0].slice(name.length+1);return /^[0-9a-f]{64}$/.test(value)?value:'';
}
async function body(request:Request):Promise<Record<string,unknown>>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new BackendError(415,'Use JSON for this request');
 if(Number(request.headers.get('content-length')??0)>16384)throw new BackendError(413,'Request is too large');
 const reader=request.body?.getReader();if(!reader)throw new BackendError(400,'Provide a JSON object');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new BackendError(413,'Request is too large');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new BackendError(400,'Provide valid JSON');}
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new BackendError(400,'Provide a JSON object');return value as Record<string,unknown>;
}

// Not mounted on the platform owner origin. A controlled visitor-host entry point
// must call this handler; it must never serve arbitrary generated scripts/HTML.
export async function applicationGateway(request:Request,env:AppEnv):Promise<Response>{
 try{
  const local=String(env.ENVIRONMENT)==='local',origin=local?'http://localhost:8787':'https://apps.digifender.com',url=new URL(request.url);
  if(url.origin!==origin)return json({error:'Application host required'},404);
  const match=url.pathname.match(route);if(!match)return json({error:'Not found'},404);
  const project=match[1],path=match[2],method=request.method;
  if(url.search)return json({error:'Query parameters are not supported'},400);
  if(!['GET','POST'].includes(method))return json({error:'Method not allowed'},405);
  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==origin)||method==='POST'&&request.headers.get('origin')!==origin)return json({error:'Origin check failed'},403);
  const ip=request.headers.get('cf-connecting-ip')??'unknown';
  if(!(await env.API_LIMITER.limit({key:'app:'+ip})).success)return json({error:'Too many requests. Try again in a minute.'},429);
  const session=token(request,project,'session',local);
  if(method==='GET'&&path==='data')return json(await readAppData(env.DB,session,project));
  const receipt=path.match(new RegExp(`^receipts/(${uuid})$`));
  if(method==='GET'&&receipt)return json(await readAppReceipt(env.DB,session,project,receipt[1]));
  if(method!=='POST')return json({error:'Not found'},404);
  if(path.startsWith('auth/')&&!(await env.AUTH_LIMITER.limit({key:'app:'+ip})).success)return json({error:'Too many sign-in attempts. Try again in a minute.'},429);
  const data=await body(request);
  if(path==='data'){
   if(typeof data.id!=='string'||typeof data.revision!=='number'||!Object.hasOwn(data,'input'))throw new BackendError(400,'Provide an operation ID, current revision and input');
   return json(await transitionAppData(env.DB,env.BACKEND_RUNTIME,session,project,data.id,data.revision,data.input));
  }
  const passkey=path.match(/^auth\/(signup|login|add)\/(options|verify)$/);
  if(passkey){
   const kind=passkey[1] as 'signup'|'login'|'add';
   if(passkey[2]==='options'){
    const result=await appPasskeyOptions(env.DB,project,kind,local,kind==='signup'&&typeof data.inviteCode==='string'?data.inviteCode:kind==='add'?session:'');
    return json({options:result.options},200,[cookie(project,'challenge',result.challengeToken,local)]);
   }
   if(!data.credential||typeof data.credential!=='object'||Array.isArray(data.credential))throw new BackendError(400,'Provide a passkey response');
   const result=await appPasskeyVerify(env.DB,project,kind,token(request,project,'challenge',local),data.credential as AuthenticationResponseJSON|RegistrationResponseJSON,local,session);
   const cookies=[cookie(project,'challenge','',local)];if(result.session)cookies.push(cookie(project,'session',result.session,local));
   return json({authenticated:true,...(result.recoveryCode?{recoveryCode:result.recoveryCode}:{})},200,cookies);
  }
  if(path==='auth/recover'){
   if(typeof data.code!=='string')throw new BackendError(400,'Provide an application recovery code');
   const result=await recoverAppVisitor(env.DB,project,data.code);
   return json({authenticated:true,recoveryCode:result.recoveryCode},200,[cookie(project,'session',result.session,local),cookie(project,'challenge','',local)]);
  }
  if(path==='auth/logout'){
   await revokeAppSession(env.DB,session);return json({signedOut:true},200,[cookie(project,'session','',local),cookie(project,'challenge','',local)]);
  }
  return json({error:'Not found'},404);
 }catch(cause){
  if(cause instanceof BackendError)return json({error:cause.message},cause.status);
  // Never log credentials, request bodies or raw database errors. A storage
  // failure can be a lost acknowledgment; the client must not blindly retry.
  return json({error:'Application request unavailable. Read current data or sign in again before retrying.'},503);
 }
}

import {customerCeilingFromEnv} from './notification-configurations';
import {visitorProject,visitorOrigin} from './hosts';
import {deleteAppAccount,exportAppAccount,prepareAppDeletion,readAppDeletion} from './app-lifecycle';
import {appPasskeyOptions,appPasskeyVerify,recoverAppVisitor} from './app-auth';
import {readAppData,readAppReceipt,revokeAppSession,transitionAppData} from './app-data';
import {BackendError} from './backend-versions';
import {liveAppPage} from './app-pages';
import {backendFormConfig} from './backend-form-render';
import {handleModuleRequest} from './shared-modules/api';
import {visitorPrincipal} from './shared-modules/access';
import {ModuleError,moduleRequest} from './shared-modules/policy';
import {publicClientKey,reservePublicClient,PublicClientLimitError} from './public-admission';
import {verifyTurnstile} from './turnstile';
import {servingStopped} from './operator-serving';
import {moduleCompositions} from './module-compositions';
import type {AuthenticationResponseJSON,RegistrationResponseJSON} from '@simplewebauthn/server';

type AppEnv = Pick<Env,'DB'|'ENVIRONMENT'|'AUTH_LIMITER'|'API_LIMITER'|'BACKEND_RUNTIME'|'TURNSTILE_SECRET'> & {FILES?:R2Bucket};
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

async function jpegBody(request:Request){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/jpeg')throw new BackendError(415,'Use a prepared JPEG for this upload');
 if(Number(request.headers.get('content-length')??0)>1048576)throw new BackendError(413,'Files must be at most 1 MiB');
 const reader=request.body?.getReader();if(!reader)throw new BackendError(400,'Choose a file');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw new BackendError(413,'Files must be at most 1 MiB');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}

// Not mounted on the platform owner origin. A controlled visitor-host entry point
// must call this handler; it must never serve arbitrary generated scripts/HTML.
export async function applicationGateway(request:Request,env:AppEnv,fetcher:typeof fetch=fetch):Promise<Response>{
 try{
  const local=String(env.ENVIRONMENT)==='local',url=new URL(request.url),hostProject=visitorProject(url.hostname),origin=local?'http://localhost:8787':hostProject?visitorOrigin(hostProject):'';
  if(!local&&hostProject)url.pathname='/apps/'+hostProject+url.pathname;
  if(url.origin!==origin)return json({error:'Application host required'},404);
  const match=url.pathname.match(route);if(!match)return json({error:'Not found'},404);
  const project=match[1],path=match[2],method=request.method;
  if(url.search)return json({error:'Query parameters are not supported'},400);
  if(!['GET','HEAD','POST'].includes(method))return json({error:'Method not allowed'},405);
  if(request.headers.get('sec-fetch-site')==='cross-site'||(request.headers.has('origin')&&request.headers.get('origin')!==origin)||method==='POST'&&request.headers.get('origin')!==origin)return json({error:'Origin check failed'},403);
  const ip=request.headers.get('cf-connecting-ip')??'unknown';
  if(!(await env.API_LIMITER.limit({key:'app:'+ip})).success)return json({error:'Too many requests. Try again in a minute.'},429);
  const session=token(request,project,'session',local);
  // WH-070: read-only composition source for the project's own visitor page. Published or live only, never a draft;
  // the project must own an access module instance. It carries no identity: every decision stays in POST modules.
  const composition=path.match(/^compositions\/([a-z-]{1,40})\.js$/);
  if(composition){
   if(method!=='GET'&&method!=='HEAD')return json({error:'Method not allowed'},405);
   const found=Object.hasOwn(moduleCompositions,composition[1])?moduleCompositions[composition[1]]:null;
   if(!found||found.status==='draft'||await servingStopped(env.DB,project)||!await env.DB.prepare("SELECT 1 FROM module_instances WHERE project_id=? AND kind='access'").bind(project).first())return json({error:'Not found'},404);
   const result=new Headers(headers);result.set('content-type','text/javascript; charset=utf-8');
   return new Response(method==='HEAD'?null:found.source,{headers:result});
  }
  if(method==='HEAD')return json({error:'Method not allowed'},405);
  // Exact deletion receipts remain checkable after withdrawal or sign-out.
  // They prove only this request's completion, never restore authorization.
  if(method==='POST'&&path==='account/delete'){
   const data=await body(request);
   if(typeof data.id!=='string'||typeof data.revision!=='number')throw new BackendError(400,'Provide the deletion request and reviewed revision');
   return json(await deleteAppAccount(env.DB,session,project,data.id,data.revision,data.confirmation));
  }
  const deletionStatus=path.match(new RegExp(`^account/deletions/(${uuid})/(0|[1-9][0-9]{0,15})$`));
  if(method==='GET'&&deletionStatus)return json(await readAppDeletion(env.DB,session,project,deletionStatus[1],Number(deletionStatus[2])));
  // Operator serving stop: only a visitor's own sign-in, recovery, passkey replacement, sign-out, saved-data and
  // request-receipt reads, export and deletion stay available, so existing visitors keep access to their stored data.
  // New signups, modules, configuration and execution are refused with the same response as an application without a
  // live page; the visitor page treats that configuration answer as its account-only view.
  if(await servingStopped(env.DB,project)&&!(method==='GET'&&(path==='export'||path==='data'||new RegExp(`^receipts/${uuid}$`).test(path)))&&!(method==='POST'&&(path==='account/deletion-review'||path==='auth/recover'||path==='auth/logout'||/^auth\/(login|add)\/(options|verify)$/.test(path))))
   return json({error:'Application page unavailable'},404);
  // WH-126 shared module requests (whumpo-modules v1), same-origin POST only. The principal is derived solely from this
  // project's visitor session cookie (never a workspace cookie); module serving checks the instance's own activation.
  // WH-128 module uploads: one cleaned-JPEG body (at most 1 MiB, streamed with a hard bound) with the whumpo-modules v1
  // envelope in the whumpo-module-request header (base64url JSON). Only files.putBytes is accepted here, and
  // files.putBytes is accepted nowhere else; storage keys are chosen by the server.
  if(path==='modules/upload'){
   if(method!=='POST')return json({error:'Not found'},404);
   try{
    const header=request.headers.get('whumpo-module-request')??'';
    if(!header||header.length>4096||!/^[A-Za-z0-9_-]+$/.test(header))throw new ModuleError('invalid_request');
    let decoded:unknown;try{decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(atob(header.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));}catch{throw new ModuleError('invalid_request');}
    const envelope=moduleRequest(decoded);
    if(envelope.operation!=='files.putBytes')throw new ModuleError('invalid_request');
    const upload=await jpegBody(request);
    const principal=await visitorPrincipal(env.DB,session,project,envelope.resourceId)??{kind:'public' as const,projectId:project};
    return json(await handleModuleRequest(env.DB,principal,envelope,undefined,{files:env.FILES,upload}));
   }catch(cause){if(cause instanceof ModuleError)return json(cause.body(),cause.status);throw cause;}
  }
  if(path==='modules'){
   if(method!=='POST')return json({error:'Not found'},404);
   try{
    const envelope=moduleRequest(await body(request));
    if(envelope.operation==='files.putBytes')throw new ModuleError('invalid_request','Upload files through the module upload route.');
    const principal=await visitorPrincipal(env.DB,session,project,envelope.resourceId)??{kind:'public' as const,projectId:project};
    if(envelope.operation==='files.read'){
     // Approved, re-hashed JPEG bytes only; sandboxed, never cached and same-origin.
     const read=await handleModuleRequest(env.DB,principal,envelope,undefined,{files:env.FILES});
     const bytes=(read.result as {bytes?:unknown}).bytes;
     if(!(bytes instanceof Uint8Array))throw new ModuleError('unavailable');
     return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(bytes.length),'content-disposition':'inline; filename="file.jpg"','cache-control':'private, no-store','content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','x-frame-options':'DENY'}});
    }
    return json(await handleModuleRequest(env.DB,principal,envelope,undefined,{notices:{customerCeilingCents:customerCeilingFromEnv(env as {NOTIFICATION_CUSTOMER_CEILING_CENTS?:string})},publicAdmission:async()=>{
     // WH-127 anonymous public form intake reuses the contact form's admission: deployed environments fail closed
     // without the Turnstile secret, one connection gets the contact allowance per project per UTC day (shared with the
     // contact form, counted before verification), and Siteverify must name this visitor host, the module-form action
     // and this exact resource. The commit trigger repeats the public form, publication and atomic caps.
     if(!local&&!env.TURNSTILE_SECRET)throw new ModuleError('unavailable','Public form submissions are temporarily unavailable.');
     try{await reservePublicClient(env.DB,'contact',project,await publicClientKey(request,'contact',project));}
     catch(cause){if(cause instanceof PublicClientLimitError)throw new ModuleError('limited','Too many submissions from this connection today. Please try again tomorrow.');throw cause;}
     if(local)return;
     const token=request.headers.get('whumpo-turnstile-response');
     if(!token||token.length>2048)throw new ModuleError('forbidden','Complete verification before sending.');
     let outcome:'verified'|'failed'|'unavailable';
     try{outcome=await verifyTurnstile(fetcher,env.TURNSTILE_SECRET!,token,ip,{hostname:url.hostname,action:'module-form',cdata:envelope.resourceId});}catch{outcome='unavailable';}
     if(outcome==='unavailable')throw new ModuleError('unavailable','Verification is unavailable. Try again later.');
     if(outcome==='failed')throw new ModuleError('forbidden','Verification failed. Reload the form and try again.');
    }}));
   }catch(cause){if(cause instanceof ModuleError)return json(cause.body(),cause.status);throw cause;}
  }
  // WH-126: visitor identity belongs to the project's access module instance. Sign-in, recovery, sign-out, account
  // export and the visitor's own deletion review need only that instance to be active, never a visitor application.
  if(method==='GET'&&path==='export')return await exportAppAccount(env.DB,session,project);
  if(method==='POST'&&(path.startsWith('auth/')||path==='account/deletion-review')){
   if(path.startsWith('auth/')&&!(await env.AUTH_LIMITER.limit({key:'app:'+ip})).success)return json({error:'Too many sign-in attempts. Try again in a minute.'},429);
   const data=await body(request);
   if(path==='account/deletion-review'){
    if(Object.keys(data).length)throw new BackendError(400,'Review your current application account');
    return json(await prepareAppDeletion(env.DB,session,project));
   }
   const passkey=path.match(/^auth\/(signup|login|add)\/(options|verify)$/);
   if(passkey){
    const kind=passkey[1] as 'signup'|'login'|'add';
    if(passkey[2]==='options'){
     const result=await appPasskeyOptions(env.DB,project,kind,local,kind==='signup'&&typeof data.inviteCode==='string'?data.inviteCode:kind==='add'?session:'',ip);
     return json({options:result.options},200,[cookie(project,'challenge',result.challengeToken,local)]);
    }
    if(!data.credential||typeof data.credential!=='object'||Array.isArray(data.credential))throw new BackendError(400,'Provide a passkey response');
    const result=await appPasskeyVerify(env.DB,project,kind,token(request,project,'challenge',local),data.credential as AuthenticationResponseJSON|RegistrationResponseJSON,local,session);
    const cookies=[cookie(project,'challenge','',local)];if(result.session)cookies.push(cookie(project,'session',result.session,local));
    return json({authenticated:true,...(result.recoveryCode?{recoveryCode:result.recoveryCode}:{})},200,cookies);
   }
   if(path==='auth/recover'){
    if(typeof data.code!=='string'||typeof data.nonce!=='string'||!/^[0-9a-f]{64}$/.test(data.nonce))throw new BackendError(400,'Provide an application recovery code and a fresh recovery nonce');
    const result=await recoverAppVisitor(env.DB,project,data.code,data.nonce);
    return json({authenticated:true,recoveryCode:result.recoveryCode},200,[cookie(project,'session',result.session,local),cookie(project,'challenge','',local)]);
   }
   if(path==='auth/logout'){
    await revokeAppSession(env.DB,session);return json({signedOut:true},200,[cookie(project,'session','',local),cookie(project,'challenge','',local)]);
   }
   return json({error:'Not found'},404);
  }
  // The visitor application consumes those identities through its reviewed live page.
  const page=await liveAppPage(env.DB,project);if(!page)return json({error:'Application page unavailable'},404);
  if(method==='GET'&&path==='config')return json({form:JSON.parse(page.config_json),pageId:page.id});
  if(method==='GET'&&path==='data')return json(await readAppData(env.DB,session,project));
  const receipt=path.match(new RegExp(`^receipts/(${uuid})$`));
  if(method==='GET'&&receipt)return json(await readAppReceipt(env.DB,session,project,receipt[1]));
  if(method!=='POST')return json({error:'Not found'},404);
  const data=await body(request);
  if(path==='data'){
   if(data.pageId!==page.id)throw new BackendError(409,'Application page changed. Reload before sending another change');
   if(typeof data.id!=='string'||typeof data.revision!=='number'||!Object.hasOwn(data,'input'))throw new BackendError(400,'Provide an operation ID, current revision and input');
   const form=backendFormConfig(JSON.parse(page.config_json)),input=data.input;
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==form.fields.length||form.fields.some(f=>{const value=(input as Record<string,unknown>)[f.key];return f.type==='choice'?typeof value!=='string'||!f.options.some(o=>o.value===value):f.type==='text'?typeof value!=='string'||value.length>300:f.type==='number'?typeof value!=='number'||!Number.isFinite(value):typeof value!=='boolean';}))throw new BackendError(400,'Provide the fields shown in the current application form');
   return json(await transitionAppData(env.DB,env.BACKEND_RUNTIME,session,project,data.id,data.revision,data.input));
  }
  return json({error:'Not found'},404);
 }catch(cause){
  if(cause instanceof BackendError)return json({error:cause.message},cause.status);
  // Never log credentials, request bodies or raw database errors. A storage
  // failure can be a lost acknowledgment; the client must not blindly retry.
  return json({error:'Application request unavailable. Read current data or sign in again before retrying.'},503);
 }
}

/** WH-018 account lifecycle transport: same-origin JSON POST only, authenticated by the ordinary Whumpo passkey session
 * and admitted with closure `permit`, so closure status/resume and the account export keep working while every other
 * workspace route refuses a closing account. Confirmation and download additionally require a fresh passkey proof inside
 * the handlers. No Chat, agent or model reaches this surface; responses are `no-store` and nothing is logged. */
import {workspaceIdentity} from '../workspace-identity/http';
import {IdentityError} from '../workspace-identity/authority';
import {admitWorkspace,workspaceBindings,workspaceTransport} from '../workspace-identity/admission';
import {ModuleError} from '../shared-modules/policy';
import {AccountLifecycleError,prepareClosure,confirmClosure,resumeClosure,closureStatus} from './closure';
import {prepareAccountExport,downloadAccountExport} from './export';

export const accountLifecyclePrefix='/api/account/v1/';
const maxBody=4096;
async function body(request:Request):Promise<unknown>{
 const invalid=()=>new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw invalid();
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBody))throw invalid();
 const text=await request.text();if(text.length>maxBody)throw invalid();
 try{return JSON.parse(text) as unknown;}catch{throw invalid();}
}
type Context={db:D1Database;scoped:Env;user:string;transport:typeof fetch;data:unknown};
type Handler=(c:Context)=>Promise<Response|unknown>;
/** The route table: each action is one POST. Every handler runs under the closure-permitting admission built in the dispatcher. */
const actions:Record<string,Handler>={
 'export/prepare':c=>prepareAccountExport(c.db,c.user,c.data),
 'export/download':c=>downloadAccountExport(c.scoped,c.user,c.data),
 'closure/prepare':c=>prepareClosure(c.db,c.user,c.data),
 'closure/confirm':c=>confirmClosure(c.scoped,c.user,c.data,c.transport),
 'closure/resume':c=>resumeClosure(c.scoped,c.user,c.data,c.transport),
 'closure/status':c=>closureStatus(c.db,c.user,c.data),
};
export const accountLifecycleActions=Object.keys(actions);

/** Returns null for every other path. */
export async function handleAccountLifecycleRequest(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(accountLifecyclePrefix))return null;
 const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
 const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 try{
  const action=url.pathname.slice(accountLifecyclePrefix.length);
  if(!Object.hasOwn(actions,action)||request.method!=='POST'||url.search)return respond({error:'Not found',code:'not_found'},404);
  const principal=await workspaceIdentity(request,env),db=admitWorkspace(env.DB,principal,'permit'),user=principal.accountId;
  const result=await actions[action]({db,scoped:workspaceBindings(env,db,user),user,transport:workspaceTransport(db,user),data:await body(request)});
  return result instanceof Response?result:respond(result);
 }catch(error){
  if(error instanceof IdentityError)return respond({error:error.message,code:error.code},error.status);
  if(error instanceof AccountLifecycleError)return respond({error:error.message,code:error.code},error.status);
  if(error instanceof ModuleError)return respond({error:'An export section is unavailable. Prepare a new export.',code:'stale_review'},409);
  return respond({error:'Account request unavailable.',code:'unavailable'},503);
 }
}

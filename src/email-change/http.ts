/** WH-201 trusted HTTP adapter for the verified address change (docs/email-change-and-compromise.md section 2). Direct owner
 * controls only: the routes sit behind the workspace identity (a current ordinary session), never in Chat, and no agent action can
 * prepare, confirm, cancel or read a change. Origin, content type, body size and rate-limit checks run here as well as at the
 * Worker edge. Addresses and tokens appear only in request bodies, are never logged and never enter model context.
 *
 * While platform delivery is not active (WH-202 supplies the sender and outbox) a change request returns `delivery_unavailable`
 * after the authority check and stores nothing: not a change, not a limit row, not a notice. The seam is `options.delivery`;
 * production passes `emailChangeDelivery(env)`, which is null today. */
import {IdentityError,type IdentityPrincipal} from '../workspace-identity/authority';
import {requireFreshWorkspace} from '../workspace-identity/admission';
import {EmailChangeError} from './policy';
import {parseChangeReference,parseChangeRequest,parseConfirmation,cancelEmailChange,confirmEmailChange,readAccountEmail,requestEmailChange,undoEmailChange} from './change';
import type {ChangeStep,EmailChange,NoticeDraft} from './change';
import {tokenVerifier} from './token';
import {ownerPrincipal,persistStep,readAccount,readChange,readChangeByRequest,readChangeByVerifier,readHolders,readLimits,readPendingChange,readUndoableChange,storeError} from './store';

/** Where the module's notice drafts go once a step has committed. WH-202 replaces this with the shared outbox written in the same
 * batch; until it exists there is no sender, so `emailChangeDelivery` is null and nothing is ever queued. */
export interface EmailChangeDelivery {queue(drafts:NoticeDraft[],changeId:string|null):Promise<void>}
export const emailChangeDelivery=(_env:unknown):EmailChangeDelivery|null=>null;
type Environment={AUTH_LIMITER:{limit(options:{key:string}):Promise<{success:boolean}>}};
export type EmailChangeOptions={delivery?:EmailChangeDelivery|null;now?:()=>number};

const base='/api/account/email',maxBody=4096;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store',pragma:'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
// Fixed messages: nothing here echoes an address, token, change ID from another account or database text.
const failures:Record<string,[number,string,string]>={
 AUTH_REQUIRED:[401,'proof_required','Sign in with your current passkey to continue.'],
 PROOF_REQUIRED:[401,'proof_required','Verify your current passkey to continue.'],
 IDENTITY_CHANGED:[409,'identity_changed','Your account access changed. Verify your current access and review this action again.'],
 IDENTITY_INCOMPLETE:[403,'identity_incomplete','Complete the current identity flow before using this action.'],
 INVALID_REQUEST:[400,'invalid_request','Invalid request.'],UNKNOWN_FIELD:[400,'invalid_request','Invalid request.'],RETIRED_AUTHORITY:[400,'invalid_request','Invalid request.'],
 UNSUPPORTED_VERSION:[409,'client_upgrade_required','Update Whumpo to continue.'],
 INVALID_ADDRESS:[400,'invalid_address','Enter one email address.'],NO_CHANGE:[400,'no_change','That is already your account email.'],
 REQUEST_CONFLICT:[409,'request_conflict','That request ID was already used for a different request.'],
 RATE_LIMITED:[429,'rate_limited','Too many attempts. Try again later.'],
 STALE_CHANGE:[409,'stale_change','That change is no longer current. Review your account email and try again.'],
 CHANGE_CLOSED:[409,'change_closed','That change is closed.'],TOKEN_EXPIRED:[409,'token_expired','That confirmation has expired. Request the change again.'],
 ADDRESS_UNAVAILABLE:[409,'address_unavailable','That address cannot be used.'],INVALID_TOKEN:[400,'invalid_token','That confirmation is not valid.'],
 UNKNOWN_CHANGE:[404,'unknown_change','Change not found.'],UNDO_UNAVAILABLE:[409,'undo_unavailable','That change can no longer be undone.'],
};
const failure=(code:string)=>{

 if(code==='DELIVERY_UNAVAILABLE')return respond({version:1,status:'delivery_unavailable'});
 const [status,name,message]=failures[code]??[503,'unavailable','Account email is temporarily unavailable.'];return respond({error:message,code:name},status);};

async function readBody(request:Request):Promise<unknown> {
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new EmailChangeError('INVALID_REQUEST','content-type');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBody))throw new EmailChangeError('INVALID_REQUEST','size');
 const reader=request.body?.getReader();if(!reader)throw new EmailChangeError('INVALID_REQUEST','body');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>maxBody)throw new EmailChangeError('INVALID_REQUEST','size');chunks.push(part.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new EmailChangeError('INVALID_REQUEST','json');}
}

/** Routes `/api/account/email`. `db` is the caller's workspace scope: its batches carry the current-identity predicate. Returns
 * null for any other path. */
export async function accountEmailRoute(request:Request,env:Environment,db:D1Database,principal:IdentityPrincipal,options:EmailChangeOptions={}):Promise<Response|null> {
 const {pathname,search}=new URL(request.url),action=pathname.slice(base.length+1);
 if(pathname!==base&&!(pathname.startsWith(base+'/')&&['change','confirm','cancel','undo'].includes(action)))return null;
 try{
  if(search)throw new EmailChangeError('INVALID_REQUEST','query');
  const delivery=options.delivery??null,clock=options.now??Date.now,userId=principal.accountId;
  if(request.method==='GET'&&pathname===base){
   const account=await readAccount(db,userId);if(!account)throw new EmailChangeError('AUTH_REQUIRED');
   const now=clock(),view=readAccountEmail({principal:ownerPrincipal(principal),account,pending:await readPendingChange(db,userId),now});
   const undo=await readUndoableChange(db,userId,now);
   return respond({version:1,...view,undo:undo?{changeId:undo.changeId,until:undo.undoUntil}:null,deliveryAvailable:delivery!==null});
  }
  if(request.method!=='POST'||pathname===base)return respond({error:'Not found',code:'not_found'},404);
  if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Origin check failed',code:'origin_check_failed'},403);
  if(!(await env.AUTH_LIMITER.limit({key:'email-change:'+userId})).success)return failure('RATE_LIMITED');
  const body=await readBody(request);
  const owner=ownerPrincipal(principal);
  for(let attempt=0;;attempt++){
   const now=clock();
   const account=await readAccount(db,userId);if(!account)throw new EmailChangeError('AUTH_REQUIRED');
   try{
    if(action==='change'){
     const input=parseChangeRequest(body);
     await requireFreshWorkspace(db,userId);
     const limits=await readLimits(db,userId,input.newAddress,now);
     const step=await requestEmailChange({principal:owner,account,request:input,deliveryActive:delivery!==null,prior:await readChangeByRequest(db,userId,input.requestId),
      pending:await readPendingChange(db,userId),holders:await readHolders(db,input.newAddress),limits:{requests:limits.requests,addressSends:limits.addressSends},changeId:crypto.randomUUID(),now});
     await persistStep(db,step,{accountId:userId,address:input.newAddress,seen:limits,now});
     await delivery?.queue(step.notices,step.changes.at(-1)?.changeId??null);
     return respond({version:1,...step.result});
    }
    if(action==='confirm'){
     const {token}=parseConfirmation(body),verifier=await tokenVerifier(token);
     const change=verifier?await readChangeByVerifier(db,verifier):null,limits=await readLimits(db,userId,null,now);
     const step=confirmEmailChange({principal:owner,account,verifier,change,holders:change?await readHolders(db,change.newAddress):{accounts:[],changes:[]},failures:limits.failures,now});
     await persistStep(db,step,{accountId:userId,address:null,seen:limits,now});
     if(step.refusal)throw new EmailChangeError(step.refusal.code,step.refusal.detail);
     if(!step.result)throw new EmailChangeError('CHANGE_CLOSED');
     await delivery?.queue(step.notices,change?.changeId??null);
     return respond({version:1,...step.result});
    }
    const {changeId}=parseChangeReference(body),change=await readChange(db,userId,changeId);
    let step:ChangeStep<unknown>;
    if(action==='cancel')step=cancelEmailChange({principal:owner,account,changeId,change,now});
    else{await requireFreshWorkspace(db,userId);step=undoEmailChange({principal:owner,account,changeId,change,now});}
    await persistStep(db,step,{accountId:userId,address:null,seen:{requests:[],failures:[],addressSends:[]},now});
    await delivery?.queue(step.notices,changeId);
    return respond({version:1,...step.result as Record<string,unknown>});
   }catch(cause){
    // A lost race (another tab, the engine advancing the epoch) rereads once and decides again from the new state.
    const mapped=cause instanceof EmailChangeError?cause:storeError(cause);
    if(mapped?.code==='STALE_CHANGE'&&mapped.detail==='race'&&attempt===0)continue;
    throw mapped??cause;
   }
  }
 }catch(cause){
  if(cause instanceof IdentityError)throw cause;
  if(cause instanceof EmailChangeError)return failure(cause.code);
  const mapped=storeError(cause);
  if(mapped)return failure(mapped.code);
  // Unexpected errors may hold SQL or provider text. They are neither serialized nor logged.
  return failure('UNAVAILABLE');
 }
}
export type {EmailChange};

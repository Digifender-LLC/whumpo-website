/** WH-018 owner account export and closure client. It calls only the six existing `/api/account/v1/` routes with the
 * ordinary same-origin passkey session. The server still enforces the exact review digest, the fresh passkey proof on
 * download/confirm and the stop-new-work guard; this client reauthenticates once through the existing identity ceremony
 * when the proof is stale and retries the same request. No Chat turn, agent action or model reaches it; nothing is
 * cached or stored. */
export const accountLifecyclePrefix='/api/account/v1/';
export const accountLifecycleActions=Object.freeze(['export/prepare','export/download','closure/prepare','closure/confirm','closure/resume','closure/status'] as const);
export type AccountLifecycleAction=typeof accountLifecycleActions[number];
type Fetch=(input:string,init:RequestInit)=>Promise<Response>;
export type AccountTransport={fetch:Fetch;reauth:()=>Promise<unknown>};
export type AccountResult<T>={state:'ok';value:T}|{state:'error';code:string;message:string;status:number};

export type ExportReview={id:string;digest:string;expiresAt:number;format:'whumpo-account-export-v1';visitorData:boolean;projects:number;includes:string[];excludes:string[];notice:string};
export type ClosureReview={id:string;digest:string;expiresAt:number;canConfirm:boolean;needsSupport:boolean;supportMessage:string|null;requiredBeforeClosure:{id:string;count:number;action:string}[];removes:Record<string,number>;effects:string[];remainsAfterClosure:string[]};
export type ClosureStep={step:'freeze'|'withdraw'|'credentials'|'holds'|'operations'|'purge';state:'pending'|'done'|'waiting'|'blocked';attempts:number;updatedAt:number;origin:'owner'|'maintenance'|null;detail:Record<string,unknown>};
export type ClosureStatus={id:string;state:'closing'|'waiting'|'blocked'|'complete';revision?:number;createdAt?:number;updatedAt?:number;completedAt:number|null;steps:ClosureStep[]};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const fallback='This account request could not finish. Try again.';
const proofMessage='Your passkey check did not finish. Try again.';

function body(action:AccountLifecycleAction,data:Record<string,unknown>){
 if(!accountLifecycleActions.includes(action))throw Error('Only account export and closure requests are available here.');
 return JSON.stringify({version:1,...data});
}
/** One request. A stale passkey proof runs `reauth` once and retries the identical body; any other refusal is returned. */
async function request(action:AccountLifecycleAction,data:Record<string,unknown>,{fetch:send,reauth}:AccountTransport):Promise<{ok:true;response:Response}|{ok:false;code:string;message:string;status:number}>{
 const payload=body(action,data);
 for(let attempt=0;;attempt++){
  const response=await send(accountLifecyclePrefix+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body:payload});
  if(response.ok)return {ok:true,response};
  let error:{code?:unknown;error?:unknown}={};try{error=await response.json();}catch{}
  const code=typeof error.code==='string'?error.code:'unavailable';
  if(code==='proof_required'&&attempt===0){await reauth();continue;}
  const message=code==='proof_required'||code==='identity_changed'?proofMessage:typeof error.error==='string'?error.error:fallback;
  return {ok:false,code,message,status:response.status};
 }
}
async function json<T>(action:AccountLifecycleAction,data:Record<string,unknown>,transport:AccountTransport,pick:(value:Record<string,unknown>)=>T):Promise<AccountResult<T>>{
 const result=await request(action,data,transport);
 if(!result.ok)return {state:'error',code:result.code,message:result.message,status:result.status};
 const value=await result.response.json() as Record<string,unknown>;
 if(!value||value.version!==1)return {state:'error',code:'client_upgrade_required',message:'Whumpo needs its current account response. Refresh the app and try again.',status:409};
 return {state:'ok',value:pick(value)};
}
const reviewId=(id:string)=>{if(!uuid.test(id))throw Error('Use a current account review.');return id;};
const reviewDigest=(value:string)=>{if(!digest.test(value))throw Error('Use a current account review.');return value;};

export const newAccountRequestId=()=>crypto.randomUUID();
/** Exact export review. Reusing `requestId` with the same scope returns the same unexpired review. */
export const prepareAccountExport=(requestId:string,visitorData:boolean,t:AccountTransport)=>json('export/prepare',{requestId:reviewId(requestId),visitorData},t,v=>v.review as ExportReview);
/** Streams the archive after a fresh passkey proof; the caller saves the Blob. A stale or changed review is refused. */
export async function downloadAccountExport(review:Pick<ExportReview,'id'|'digest'>,t:AccountTransport):Promise<AccountResult<Blob>>{
 const result=await request('export/download',{reviewId:reviewId(review.id),reviewDigest:reviewDigest(review.digest)},t);
 if(!result.ok)return {state:'error',code:result.code,message:result.message,status:result.status};
 if(result.response.headers.get('content-type')!=='application/zip')return {state:'error',code:'unavailable',message:fallback,status:503};
 try{return {state:'ok',value:await result.response.blob()};}catch{return {state:'error',code:'interrupted',message:'The download was interrupted. Prepare a fresh export.',status:503};}
}
export const prepareAccountClosure=(requestId:string,t:AccountTransport)=>json('closure/prepare',{requestId:reviewId(requestId)},t,v=>v.review as ClosureReview);
/** Confirmation uses the reviewed id and digest and the fixed closure control; it needs a fresh passkey proof. */
export const confirmAccountClosure=(review:Pick<ClosureReview,'id'|'digest'>,t:AccountTransport)=>json('closure/confirm',{reviewId:reviewId(review.id),reviewDigest:reviewDigest(review.digest),confirmation:'close-account'},t,v=>v.closure as ClosureStatus);
export const resumeAccountClosure=(t:AccountTransport)=>json('closure/resume',{},t,v=>v.closure as ClosureStatus);
/** `null` means the account is not closing. */
export async function readAccountClosure(t:AccountTransport):Promise<AccountResult<ClosureStatus|null>>{
 const result=await json('closure/status',{},t,v=>v.closure as ClosureStatus);
 return result.state==='error'&&result.code==='not_found'?{state:'ok',value:null}:result;
}

export const closureStepLabels:Record<ClosureStep['step'],string>={freeze:'Stop new work',withdraw:'Take websites offline',credentials:'Revoke provider authorizations',holds:'Retention review',operations:'Finish unresolved operations',purge:'Delete account data'};
export const closureStateLabels:Record<ClosureStatus['state']|ClosureStep['state'],string>={pending:'Not started',done:'Done',waiting:'Waiting',blocked:'Needs support',closing:'Closing',complete:'Closed'};
/** Plain wording for the content-free journal detail; unknown keys fall back to the key itself. */
const detailLabels:Record<string,string>={newWorkStopped:'New work stopped',websitesWithdrawn:'Websites taken offline',guestLinksRevoked:'Guest links revoked',modulesSuspended:'Modules suspended',pendingProviderRevocations:'Provider revocations pending',providerRetry:'Provider will be retried',providerRevocationsConfirmed:'Provider revocations confirmed',reason:'Reason',support:'Support can help',chatTurnsChecked:'Chat replies checked',backupsChecked:'GitHub backups checked',githubRepositoriesLeftInPlace:'GitHub repositories left in your GitHub account',cloudflareZonesLeftInPlace:'Cloudflare zones left in your Cloudflare account',retentionReviewClear:'No retention review',unresolvedOperations:'Unresolved operations',retainedRecordKinds:'Retained record kinds',projectsRemoved:'Projects removed',objectsQueuedForCleanup:'Files queued for storage cleanup',primaryAccountRowsDeleted:'Account rows deleted'};
const reasonLabels:Record<string,string>={retention_review:'A retention review applies; contact support',retained_records:'Retained records need support to reconcile',paid_plan_active:'Your paid plan is still active; cancel it or contact support'};
export function closureDetail(detail:Record<string,unknown>):string[]{
 return Object.entries(detail).map(([key,value])=>`${detailLabels[key]??key}: ${key==='reason'&&typeof value==='string'?reasonLabels[value]??value:typeof value==='boolean'?(value?'yes':'no'):String(value)}`);
}

/** WH-203 trusted HTTP adapter for the compromise review (docs/email-change-and-compromise.md section 3). Direct owner controls only:
 * the routes sit behind the workspace identity (a current ordinary session) and never in Chat; no agent action can prepare, offer a
 * kit for, save a kit for or commit a review, and no restricted recovery grant reaches them. Origin, content type, body size and the
 * identity route limiter run here as well as at the Worker edge. Every operation needs a fresh passkey except saving a kit, and the
 * commit repeats the epoch, passkey and review binding in its committing batch (review-store.ts). A commit revokes every session,
 * including this one, so the reply clears the session cookie; a lost reply is answered from the saved receipt after signing in again
 * and replaying the same request ID. Provider revocation is only queued (the existing cleaners dispatch); no provider is called here. */
import {IdentityError,type IdentityPrincipal} from '../workspace-identity/authority';
import {requireFreshWorkspace} from '../workspace-identity/admission';
import {identityCookies} from '../workspace-identity/http';
import {recoveryKitFilename,recoveryKitText} from '../workspace-identity/kit-document';
import {hashToken,newSessionToken} from '../security';
import {EmailChangeError,check} from './policy';
import {commitCompromiseReview,parseKitOffer,parseKitSave,parseReviewCommit,parseReviewPrepare,prepareCompromiseReview,prepareReviewKit,saveReviewKit} from './compromise';
import {failure,readBody,respond} from './http';
import type {EmailChangeOptions} from './http';
import {ownerPrincipal,storeError} from './store';
import {insertReview,persistCommit,persistKitOffer,persistKitSaved,readConnections,readOpenReview,readPendingChange,readReview,readSavedReceipt,readSecurityAccount,readSessions,reviewStoreError} from './review-store';

type Environment={AUTH_LIMITER:{limit(options:{key:string}):Promise<{success:boolean}>}};
const base='/api/account/security/review/',actions=['prepare','kit','kit/save','commit'];
const sameList=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);

/** Routes `/api/account/security/review/*`. `db` is the caller's workspace scope. Returns null for any other path. */
export async function securityReviewRoute(request:Request,env:Environment,db:D1Database,principal:IdentityPrincipal,options:EmailChangeOptions={}):Promise<Response|null> {
 const {pathname,search}=new URL(request.url),action=pathname.startsWith(base)?pathname.slice(base.length):'';
 if(!actions.includes(action))return null;
 try{
  if(search)throw new EmailChangeError('INVALID_REQUEST','query');
  if(request.method!=='POST')return respond({error:'Not found',code:'not_found'},404);
  if(request.headers.get('origin')!==new URL(request.url).origin)return respond({error:'Origin check failed',code:'origin_check_failed'},403);
  const userId=principal.accountId,clock=options.now??Date.now;
  if(!(await env.AUTH_LIMITER.limit({key:'security-review:'+userId})).success)return failure('RATE_LIMITED');
  const body=await readBody(request),owner=ownerPrincipal(principal);
  // Everything but saving a kit needs a fresh passkey; the committing statements repeat it.
  if(action!=='kit/save')await requireFreshWorkspace(db,userId);
  for(let attempt=0;;attempt++){
   const now=clock();
   const account=await readSecurityAccount(db,userId);if(!account)throw new EmailChangeError('AUTH_REQUIRED');
   try{
    if(action==='prepare'){
     parseReviewPrepare(body);
     const connections=await readConnections(db,userId,now),open=await readOpenReview(db,userId,now);
     const reuse=open&&open.review.epoch===account.authEpoch&&open.review.credentialRevision===account.credentialRevision&&open.review.kitGeneration===account.kitGeneration
      &&sameList(open.review.credentials,account.credentials)&&sameList(open.review.connections,connections.map(c=>c.connectionId).sort())?open.review:null;
     const prepared=prepareCompromiseReview({principal:owner,account,pending:await readPendingChange(db,userId),sessions:await readSessions(db,userId,account.authEpoch),connections,reviewId:reuse?.reviewId??crypto.randomUUID(),now});
     if(!reuse)await insertReview(db,prepared.review);
     return respond({version:1,...prepared.result,expiresAt:reuse?.expiresAt??prepared.result.expiresAt});
    }
    if(action==='kit'){
     const {reviewId}=parseKitOffer(body),found=await readReview(db,userId,reviewId);
     // One offer per review: the plaintext key is shown once and never stored, so a second offer needs a new review.
     check(!found?.offer,'KIT_OFFER_EXISTS');
     const key=newSessionToken(),offerId=crypto.randomUUID();
     const offer=prepareReviewKit({principal:owner,account,review:found?.review??null,offerId,verifier:await hashToken(key),now});
     await persistKitOffer(db,found!.review,offer);
     const generation=account.kitGeneration+1;
     return respond({version:1,offer:{offerId,generation,expiresAt:offer.expiresAt},key,filename:recoveryKitFilename,
      text:recoveryKitText({key,accountLabel:account.email,generation,offerId,createdAt:Math.floor(now/1000)})});
    }
    if(action==='kit/save'){
     const {offerId}=parseKitSave(body),open=await readOpenReview(db,userId,now);
     check(open?.offer?.offerId===offerId,'UNKNOWN_OFFER');
     const saved=saveReviewKit({principal:owner,account,offer:open!.offer,now});
     if(open!.offer!.savedAt===null)await persistKitSaved(db,open!.review,saved);
     return respond({version:1,saved:true,offerId});
    }
    const input=parseReviewCommit(body);
    const found=await readReview(db,userId,input.reviewId);
    const step=await commitCompromiseReview({principal:owner,account,request:input,prior:await readSavedReceipt(db,userId,input.requestId),review:found?.review??null,
     offer:input.rotateKit?found?.offer??null:null,pending:await readPendingChange(db,userId),connections:await readConnections(db,userId,now),now});
    if(step.receipt)await persistCommit(db,{review:found!.review,offer:found!.offer,step,request:input,account});
    await options.delivery?.queue(step.notices,null);
    const response=respond({version:1,receipt:step.result});
    // Every session is revoked, including this one.
    if(step.receipt)response.headers.append('set-cookie',`${identityCookies.session}=; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
    return response;
   }catch(cause){
    const mapped=cause instanceof EmailChangeError?cause:reviewStoreError(cause)??storeError(cause);
    // A lost race rereads once and decides again from the new state.
    if(mapped?.code==='STALE_REVIEW'&&mapped.detail==='race'&&attempt===0)continue;
    throw mapped??cause;
   }
  }
 }catch(cause){
  if(cause instanceof IdentityError)throw cause;
  if(cause instanceof EmailChangeError)return failure(cause.code);
  const mapped=reviewStoreError(cause)??storeError(cause);
  if(mapped)return failure(mapped.code);
  // Unexpected errors may hold SQL or provider text. They are neither serialized nor logged.
  return failure('UNAVAILABLE');
 }
}

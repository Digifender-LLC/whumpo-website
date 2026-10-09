/** WH-018 exact owner review shared by the account export, account closure and the WH-187 portable project bundle
 * (`account_lifecycle_reviews`). A review is an owner-bound, ten-minute, content-free binding with an opaque digest; an
 * export review (account export or portable bundle) is consumed exactly once together with one monthly download of the
 * shared per-account allowance. No credential, Chat text, filename, object key or provider identifier is stored. */
import {hashToken} from '../security';
import {AccountLifecycleError} from './errors';
import {allowanceMessage} from './project-sections';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reviewSeconds=600;
const now=()=>Math.floor(Date.now()/1000);

/** The client-visible review digest is opaque: a hash of a fresh server-side random value with the binding, so it
 * reveals nothing about the binding (equal bindings give different digests). Exactness is enforced server-side by the
 * stored digest and binding. */
export async function saveReview(db:D1Database,user:string,kind:'export'|'closure',requestId:string,requestHash:string,binding:unknown){
 const reviewDigest=await hashToken(JSON.stringify([crypto.randomUUID(),crypto.randomUUID(),binding])),created=now(),expires=created+reviewSeconds;
 const existing=await db.prepare('SELECT request_hash,review_digest,binding_json,expires_at FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind=?').bind(requestId,user,kind).first<{request_hash:string;review_digest:string;binding_json:string;expires_at:number}>();
 if(existing){
  if(existing.request_hash!==requestHash)throw new AccountLifecycleError(409,'request_conflict','This request ID was already used for a different review.');
  if(existing.expires_at<=created)throw new AccountLifecycleError(409,'stale_review','This review expired. Prepare a new review.');
  return {reviewDigest:existing.review_digest,expiresAt:existing.expires_at,binding:JSON.parse(existing.binding_json) as unknown};
 }
 try{
  await db.batch([
   db.prepare('DELETE FROM account_lifecycle_reviews WHERE user_id=? AND expires_at<=?').bind(user,created),
   db.prepare('INSERT INTO account_lifecycle_reviews(id,user_id,kind,request_hash,binding_json,review_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(requestId,user,kind,requestHash,JSON.stringify(binding),reviewDigest,created,expires),
  ]);
 }catch(error){
  if(String(error).includes('account_lifecycle_review_capacity'))throw new AccountLifecycleError(409,'request_conflict','Too many open account reviews. Wait ten minutes and try again.');
  if(/UNIQUE|PRIMARY KEY/.test(String(error)))throw new AccountLifecycleError(409,'request_conflict','This request ID was already used for a different review.');
  throw error;
 }
 return {reviewDigest,expiresAt:expires,binding};
}
export {saveReview as saveAccountReview};

/** Exact current request shape shared by the account export and the portable bundle routes. */
export function exactRequest(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 const data=value as Record<string,unknown>;
 if(data.version!==1||Object.keys(data).length!==keys.length+1||!keys.every(k=>Object.hasOwn(data,k)))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 return data;
}
/** Validates a download request and returns its exact review ids. */
export function exportDownloadRequest(input:unknown){
 const data=exactRequest(input,['reviewId','reviewDigest']);
 if(typeof data.reviewId!=='string'||!uuid.test(data.reviewId)||typeof data.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewDigest))throw new AccountLifecycleError(400,'invalid_request','Use the current export review.');
 return {reviewId:data.reviewId,reviewDigest:data.reviewDigest};
}
/** The unexpired exact export review owned by this account (account export and portable bundle reviews share the
 * `export` kind, the ten-minute expiry, the per-account review capacity and single use). */
export async function loadExportReview(db:D1Database,user:string,reviewId:string,reviewDigest:string){
 const review=await db.prepare("SELECT binding_json,review_digest,created_at FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND expires_at>unixepoch()").bind(reviewId,user).first<{binding_json:string;review_digest:string;created_at:number}>();
 if(!review||review.review_digest!==reviewDigest)throw new AccountLifecycleError(409,'stale_review','This export review is no longer current. Prepare a new review.');
 return review;
}
/** Single use: a download consumes its exact review and one monthly download (shared per-account allowance) in one
 * transaction. A replay, a concurrent second download or an exhausted allowance is refused. */
export async function consumeExportReview(db:D1Database,user:string,reviewId:string,reviewDigest:string){
 let consumed:D1Result[];
 try{
  consumed=await db.batch([
   db.prepare(`INSERT INTO account_export_usage(user_id,period,downloads) SELECT ?,strftime('%Y-%m','now'),1
    WHERE EXISTS(SELECT 1 FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND review_digest=? AND expires_at>unixepoch())
    ON CONFLICT(user_id,period) DO UPDATE SET downloads=downloads+1`).bind(user,reviewId,user,reviewDigest),
   db.prepare("DELETE FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND review_digest=? AND expires_at>unixepoch() RETURNING id").bind(reviewId,user,reviewDigest),
  ]);
 }catch(error){
  if(/CHECK constraint failed/i.test(String(error)))throw new AccountLifecycleError(409,'request_conflict',allowanceMessage);
  throw error;
 }
 if(!consumed[1]?.results?.length)throw new AccountLifecycleError(409,'stale_review','This export review is no longer current. Prepare a new review.');
}

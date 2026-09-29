import {BillingError} from './billing';
import {hashToken} from './security';
type Snapshot={id:string;user_id:string;period:string;request_hash:string;quoted_units:number;quota_reserved:number;credits_reserved:number;status:string;actual_units:number|null;updated_at:string;chat_revision:number;chat_status:string;mode:string;input_tokens:number|null;output_tokens:number|null};
export type WaiverReview={version:1;id:string;operation:Snapshot;action:'waive';reviewedAt:string;expiresAt:string;digest:string};
const uuid=/^[0-9a-f-]{36}$/;
const fields='o.id,o.user_id,o.period,o.request_hash,o.quoted_units,o.quota_reserved,o.credits_reserved,o.status,o.actual_units,o.updated_at,t.revision AS chat_revision,t.status AS chat_status,t.mode,t.input_tokens,t.output_tokens';
async function operation(db:D1Database,id:string){if(!uuid.test(id))throw new BillingError(400,'Invalid usage operation ID.');const row=await db.prepare('SELECT '+fields+' FROM usage_operations o JOIN chat_turns t ON t.id=o.id AND t.user_id=o.user_id WHERE o.id=?').bind(id).first<Snapshot>();if(!row)throw new BillingError(404,'AI usage operation not found.');return row;}
function eligible(o:Snapshot){if(o.status!=='uncertain'||o.actual_units!==null||o.chat_status!=='uncertain'||o.mode!=='ai'||o.input_tokens!==null||o.output_tokens!==null||!Number.isFinite(Date.parse(o.updated_at))||Date.parse(o.updated_at)>Date.now()-600000)throw new BillingError(409,'Only unresolved AI usage with no saved token receipt, unchanged for at least ten minutes, can be waived.');}
async function fingerprint(value:Omit<WaiverReview,'digest'>){return hashToken(JSON.stringify(value));}
/** Oldest eligible holds only; no customer text or provider data is returned. */
export async function listWaiverCandidates(db:D1Database){
 const result=await db.prepare(`SELECT json_group_array(json_object('operationId',id,'userId',user_id,'period',period,'quotaHold',quota_reserved,'creditHold',credits_reserved,'updatedAt',updated_at)) AS items FROM (
 SELECT o.id,o.user_id,o.period,o.quota_reserved,o.credits_reserved,o.updated_at FROM usage_operations o JOIN chat_turns t ON t.id=o.id AND t.user_id=o.user_id
 WHERE o.status='uncertain' AND o.actual_units IS NULL AND o.updated_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes') AND t.status='uncertain' AND t.mode='ai' AND t.input_tokens IS NULL AND t.output_tokens IS NULL ORDER BY o.updated_at,o.id LIMIT 100)`).first<{items:string}>();
 return JSON.parse(result?.items??'[]') as {operationId:string;userId:string;period:string;quotaHold:number;creditHold:number;updatedAt:string}[];
}
/** Operator-only: no prompts, responses, credentials or account email enter the review. */
export async function inspectWaiver(db:D1Database,id:string):Promise<WaiverReview>{const current=await operation(db,id);eligible(current);const now=Date.now(),review:Omit<WaiverReview,'digest'>={version:1,id:crypto.randomUUID(),operation:current,action:'waive',reviewedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};return {...review,digest:await fingerprint(review)};}
/** Intentionally absent from the HTTP Worker and model tools. A waiver absorbs unknown cost;
 * it is not a provider-usage receipt, a refund of settled charges, or permission to retry. */
export async function applyWaiver(db:D1Database,review:WaiverReview,expectedDigest:string,operator:string,reason:string){
 if(!review||review.version!==1||review.action!=='waive'||!uuid.test(review.id)||!review.operation||typeof review.digest!=='string'||review.digest!==expectedDigest||typeof operator!=='string'||!operator.trim()||operator.length>100||typeof reason!=='string'||reason.trim().length<12||reason.length>1000||/[\x00-\x1f\x7f]/.test(operator+reason))throw new BillingError(400,'A reviewed digest, operator name and concise waiver reason are required.');
 const {digest,...unsigned}=review;if(await fingerprint(unsigned)!==digest)throw new BillingError(409,'Usage review changed. Inspect it again.');
 async function receipt(){return db.prepare('SELECT id,digest,operator,reason FROM usage_waivers WHERE id=?').bind(review.id).first<{id:string;digest:string;operator:string;reason:string}>();}
 function replay(saved:{id:string;digest:string;operator:string;reason:string}){if(saved.digest!==digest||saved.operator!==operator||saved.reason!==reason)throw new BillingError(409,'Waiver receipt does not match this replay.');return {id:saved.id,operationId:review.operation.id,replayed:true};}
 const prior=await receipt();if(prior)return replay(prior);
 try{
  if(!Number.isFinite(Date.parse(review.expiresAt))||Date.parse(review.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(review.reviewedAt))||Date.parse(review.reviewedAt)>Date.now()||Date.parse(review.expiresAt)-Date.parse(review.reviewedAt)!==600000)throw new BillingError(409,'Usage review expired or has invalid timestamps.');
  const current=await operation(db,review.operation.id);eligible(current);if(JSON.stringify(current)!==JSON.stringify(review.operation))throw new BillingError(409,'Usage changed since review. Inspect it again.');
  await db.prepare(`INSERT INTO usage_waivers(id,operation_id,user_id,digest,request_hash,period,quoted_units,quota_reserved,credits_reserved,operation_updated_at,chat_revision,reviewed_at,expires_at,operator,reason,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(review.id,current.id,current.user_id,digest,current.request_hash,current.period,current.quoted_units,current.quota_reserved,current.credits_reserved,current.updated_at,current.chat_revision,review.reviewedAt,review.expiresAt,operator,reason,new Date().toISOString()).first();
 }catch(cause){const saved=await receipt();if(saved)return replay(saved);if(/usage_waiver_stale|UNIQUE constraint/.test(String(cause)))throw new BillingError(409,'Usage changed or another waiver committed. Inspect current state.');throw cause;}
 return {id:review.id,operationId:review.operation.id,replayed:false};
}

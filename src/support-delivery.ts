import type {NotificationSettings} from './support';
/** Sends only to a verified account email (G-E5, WH-202 decision 4). Content-free: the customer is told only that a saved response exists. Never includes the statement, response or reviewer. */
export type SupportNotification={requestId:string;accountId:string;recipient:string;template:'response_saved'};
export type SupportSender=(notification:SupportNotification,settings:NotificationSettings)=>Promise<{accepted:true}|{accepted:false;retryable:boolean}>;
export const maxSupportDeliveryAttempts=5;
const backoffMinutes=(attempts:number)=>Math.min(360,5*2**(attempts-1));
/**
 * Drains external notifications for saved responses. With no selected, implemented and reviewed provider (`settings` null)
 * this does nothing: no row is created and nothing is sent. Delivery is at-least-once; a duplicate is content-free.
 * It is not scheduled anywhere yet; activation needs a reviewed provider and a reviewed trigger (see docs/usage-review-requests.md).
 */
export async function runSupportDelivery(db:Pick<D1Database,'prepare'>,settings:NotificationSettings|null,sender:SupportSender,options:{now?:Date;limit?:number}={}){
 if(!settings)return {enabled:false,queued:0,delivered:0,retried:0,failed:0,cancelled:0};
 const now=options.now??new Date(),iso=now.toISOString(),limit=Math.min(options.limit??10,25),result={enabled:true,queued:0,delivered:0,retried:0,failed:0,cancelled:0};
 // Only unread responses are queued; enabling a provider later never re-notifies readers.
 result.queued=(await db.prepare("INSERT INTO support_deliveries(request_id,user_id,provider,review,created_at,next_attempt_at) SELECT id,user_id,?,?,?,? FROM usage_review_requests r WHERE state='answered' AND customer_read_at IS NULL AND NOT EXISTS(SELECT 1 FROM support_deliveries d WHERE d.request_id=r.id) ORDER BY answered_at,id LIMIT ?").bind(settings.provider,settings.review,iso,iso,limit).run()).meta.changes;
 const due=(await db.prepare("SELECT d.request_id,d.user_id,d.attempts,u.email,u.email_verified_at,r.customer_read_at FROM support_deliveries d JOIN usage_review_requests r ON r.id=d.request_id JOIN users u ON u.id=d.user_id WHERE d.state='queued' AND d.next_attempt_at<=? ORDER BY d.next_attempt_at,d.request_id LIMIT ?").bind(iso,limit).all<{request_id:string;user_id:string;attempts:number;email:string;email_verified_at:number|null;customer_read_at:string|null}>()).results;
 for(const row of due){
  // G-E5: the address is only a lookup key until verified. An unverified account sees the response in the app and is never emailed.
  if(row.customer_read_at||row.email_verified_at===null){if((await db.prepare("UPDATE support_deliveries SET state='cancelled' WHERE request_id=? AND state='queued'").bind(row.request_id).run()).meta.changes)result.cancelled++;continue;}
  const attempts=row.attempts+1,next=new Date(now.getTime()+backoffMinutes(attempts)*60000).toISOString();
  // Claim the attempt (and push the retry time) before sending so a crash cannot hot-loop or double-count.
  if(!(await db.prepare("UPDATE support_deliveries SET attempts=?,next_attempt_at=? WHERE request_id=? AND state='queued' AND attempts=?").bind(attempts,next,row.request_id,row.attempts).run()).meta.changes)continue;
  let outcome:Awaited<ReturnType<SupportSender>>;
  try{outcome=await sender({requestId:row.request_id,accountId:row.user_id,recipient:row.email,template:'response_saved'},settings);}catch{outcome={accepted:false,retryable:true};}
  if(outcome.accepted){await db.prepare("UPDATE support_deliveries SET state='delivered',delivered_at=? WHERE request_id=? AND state='queued'").bind(iso,row.request_id).run();result.delivered++;}
  else if(!outcome.retryable||attempts>=maxSupportDeliveryAttempts){await db.prepare("UPDATE support_deliveries SET state='failed',last_error=? WHERE request_id=? AND state='queued'").bind(outcome.retryable?'exhausted':'rejected',row.request_id).run();result.failed++;}
  else{await db.prepare("UPDATE support_deliveries SET last_error='unavailable' WHERE request_id=? AND state='queued'").bind(row.request_id).run();result.retried++;}
 }
 return result;
}

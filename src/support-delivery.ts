import type {NotificationSettings} from './support';
import {enqueueNotice} from './notification-outbox';
/**
 * Queues the content-free "a response is saved" notice for answered, unread support requests on the shared notification outbox (WH-156). Delivery,
 * caps, the spending ceiling and the unknown-outcome handling are the shared adapter's (src/notification-outbox.ts); this only creates the notice.
 * G-E5 and WH-202 decision 4: the address is only a lookup key until verified, so an unverified account sees the response in the app and is never
 * queued (and the adapter checks `email_verified_at` again immediately before the provider call). Only unread responses are queued; enabling a
 * provider later never re-notifies readers. With no selected, implemented and reviewed provider (`settings` null) nothing is queued.
 * It is not scheduled anywhere yet; activation needs a reviewed provider and a reviewed trigger (see docs/usage-review-requests.md).
 */
export const supportNoticeTemplate='support.response-saved@1';
export async function queueSupportNotices(db:Pick<D1Database,'prepare'|'batch'>,settings:NotificationSettings|null,options:{now?:Date;limit?:number}={}){
 if(!settings)return {enabled:false,queued:0};
 const now=(options.now??new Date()).getTime(),limit=Math.min(options.limit??10,25);
 const rows=(await db.prepare("SELECT r.id,r.user_id FROM usage_review_requests r JOIN users u ON u.id=r.user_id WHERE r.state='answered' AND r.customer_read_at IS NULL AND u.email_verified_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM notification_notices n WHERE n.template=? AND n.event_ref=r.id AND n.recipient_key='account-email:'||r.user_id) ORDER BY r.answered_at,r.id LIMIT ?").bind(supportNoticeTemplate,limit).all<{id:string;user_id:string}>()).results;
 let queued=0;
 for(const r of rows)if((await enqueueNotice(db,{userId:r.user_id,scope:'account-email',template:supportNoticeTemplate,eventRef:r.id,now})).queued)queued++;
 return {enabled:true,queued};
}

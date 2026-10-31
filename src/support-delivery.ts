import {supportConfig,type NotificationSettings,type SupportEnv} from './support';
import {enqueueNotice,newTally,notificationLane} from './notification-outbox';
import {cloudflareEmailSender,type ContactEmailBinding} from './contact-email';
import {contactNotificationConfig,type ContactNotificationEnv,implementedContactNotificationProviders,type ContactNotificationSettings,type ContactSender} from './contact-notifications';
import type {JobType} from './job-dispatcher';
/**
 * Queues the content-free "a response is saved" notice for answered, unread support requests on the shared notification outbox (WH-156). Delivery,
 * caps, the spending ceiling and the unknown-outcome handling are the shared adapter's (src/notification-outbox.ts); this only creates the notice.
 * G-E5 and WH-202 decision 4: the address is only a lookup key until verified, so an unverified account sees the response in the app and is never
 * queued (and the adapter checks `email_verified_at` again immediately before the provider call). Only unread responses are queued; enabling a
 * provider later never re-notifies readers. With no selected, implemented and reviewed provider (`settings` null) nothing is queued.
 * `supportDeliveryLane` runs it on the every-minute trigger (WH-202); it does nothing unless the support variables and the email binding are set (see docs/usage-review-requests.md).
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

/**
 * The support lane's only way to a live sender (WH-202). Null (nothing queued, nothing sent) unless the owner set SUPPORT_NOTIFICATION_PROVIDER and
 * SUPPORT_NOTIFICATION_REVIEW and the platform email binding exists. It shares the contact lane's sender, ledger and $5 ceiling.
 */
export function supportDelivery(env:SupportEnv&{CONTACT_EMAIL?:unknown}):{settings:NotificationSettings;shared:ContactNotificationSettings;sender:ContactSender}|null{
 const {settings}=supportConfig(env),binding=env.CONTACT_EMAIL as {send?:unknown}|undefined;
 const customerCeilingCents=contactNotificationConfig(env as ContactNotificationEnv).settings?.customerCeilingCents;
 if(!settings||!Object.hasOwn(implementedContactNotificationProviders,settings.provider)||!binding||typeof binding.send!=='function')return null;
 return {settings,shared:{...settings,sendCeiling:implementedContactNotificationProviders[settings.provider].sendCeiling,...(customerCeilingCents?{customerCeilingCents}:{})},sender:cloudflareEmailSender(binding as ContactEmailBinding)};
}
/** The support adapter on the every-minute trigger: queues unread answered responses for verified accounts, then drains due attempts. */
export function supportDeliveryLane(db:Pick<D1Database,'prepare'|'batch'>,deps:{settings:NotificationSettings;shared:ContactNotificationSettings;sender:ContactSender;now:()=>number}):JobType{
 return notificationLane(db,{type:'support_delivery',settings:deps.shared,sender:deps.sender,now:deps.now,tally:newTally(),
  queue:async now=>(await queueSupportNotices(db,deps.settings,{now:new Date(now)})).queued});
}

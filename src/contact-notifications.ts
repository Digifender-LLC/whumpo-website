import {ContactError} from './contacts';
import {receiptStatement,reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {notificationCatalog} from './notification-catalog';
import {enqueueNotice,maxNoticeAttempts,noticeSendsInWindow,notificationLane,runNotificationDelivery,applyNoticeEvent,type DeliveryDeps} from './notification-outbox';
import {queueConfiguredNotices} from './notification-configurations';
import type {JobType} from './job-dispatcher';
/**
 * WH-036 contact notifications. The private inbox (`contact_submissions`) is the source of truth; a notice is only a
 * content-free "you have a new message, read it in Whumpo" signal to an owner-reviewed, provider-verified address.
 * The selected provider is Cloudflare Email Service (owner decision, October 4, 2026; adapter in src/contact-email.ts).
 * Nothing is queued or sent unless the provider is selected, reviewed and bound (`settings` null otherwise), mirroring
 * src/support-delivery.ts (WH-035). Activation is an owner step documented in docs/contact-forms.md.
 *
 * Inbound Cloudflare Email Routing is not outbound transactional delivery and is never a provider here
 * (https://developers.cloudflare.com/email-routing/).
 */
/** `sendCeiling` is the most provider calls allowed in any 32 consecutive UTC days (the owner's monthly spending ceiling). */
export type ContactNotificationSettings={provider:string;review:string;sendCeiling:number;
 /** WH-158 monthly spending limit for customer-configured notices, in whole cents; set only by the owner (NOTIFICATION_CUSTOMER_CEILING_CENTS). Unset or 0: configured notices are cancelled at send time. */
 customerCeilingCents?:number};
export type ContactNotificationEnv={CONTACT_NOTIFICATION_PROVIDER?:string;CONTACT_NOTIFICATION_REVIEW?:string;NOTIFICATION_CUSTOMER_CEILING_CENTS?:string};
/**
 * Owner spending ceiling (issue #146, October 4, 2026): up to $5 per month. Cloudflare Email Service lists Email Sending at
 * $0.35 per 1,000 emails after 3,000 included per month on Workers Paid (https://developers.cloudflare.com/email-service/platform/pricing/,
 * read October 4, 2026; beta pricing that requires verification). The included quota is account-wide and not counted, so
 * floor($5 / $0.00035) = 14,285 calls bounds the charge even if the whole quota is used elsewhere. Every provider call counts,
 * including rejected and uncertain ones.
 */
export const contactMonthlyCeilingCents=500;
/**
 * The ceiling comes from the provider facts in the notification catalog (WH-155), which records the same $5 bound;
 * tests/notifications-contract.mjs asserts they agree. Should they ever drift, the lower bound applies (no ceiling: nothing sent).
 */
const catalogCeiling=notificationCatalog.providers['cloudflare-email'].ceiling?.callsPer32Days??0;
export const implementedContactNotificationProviders:Readonly<Record<string,{sendCeiling:number}>>=Object.freeze({'cloudflare-email':Object.freeze({sendCeiling:Math.min(catalogCeiling,Math.floor(contactMonthlyCeilingCents*1000/35))})});
/** Never carries the visitor's name, email or message. `verificationCode` exists only for kind 'verification' (the owner proves the address); `confirmationToken` only for the account email-change confirmation, in memory for the one provider call. */
export type ContactNotice={outboxId:string;idempotencyKey:string;kind:'verification'|'new_message'|'account'|'configured';template:string;projectId:string|null;recipient:string;configured?:{variables:Record<string,string>;fields:Record<string,{options:string[]}>};verificationCode?:string;confirmationToken?:string};
/**
 * `retryable` only when the provider certainly did not take the message. `uncertain` (and any throw or timeout) means it may
 * have been taken: the notice is final and never resent, because the selected provider has no idempotency key.
 * `suppressed` means the provider refused the recipient as suppressed; Whumpo then suppresses the address permanently.
 */
export type ContactProviderOutcome={accepted:true;providerRef?:string}|{accepted:false;retryable:boolean;uncertain?:boolean;suppressed?:boolean};
/**
 * A provider must (1) send only from a sender identity verified at the provider, (2) never be retried after an uncertain
 * outcome unless it deduplicates on `idempotencyKey`, (3) report suppressed recipients so they reach Whumpo's suppression list.
 */
export type ContactSender=(notice:ContactNotice,settings:ContactNotificationSettings)=>Promise<ContactProviderOutcome>;
export const maxContactDeliveryAttempts=maxNoticeAttempts;
export const contactSendTimeoutMs=10000;
export const verificationValidityMs=3600000;
const cleaned=(value:unknown,max:number)=>typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
export function contactNotificationConfig(env:ContactNotificationEnv,implemented:Readonly<Record<string,{sendCeiling:number}>>=implementedContactNotificationProviders){
 const provider=cleaned(env.CONTACT_NOTIFICATION_PROVIDER,60),review=cleaned(env.CONTACT_NOTIFICATION_REVIEW,200);
 const cents=/^[1-9][0-9]{0,5}$/.test(env.NOTIFICATION_CUSTOMER_CEILING_CENTS??'')?Number(env.NOTIFICATION_CUSTOMER_CEILING_CENTS):undefined;
 const settings:ContactNotificationSettings|null=provider&&review&&Object.hasOwn(implemented,provider)?{provider,review,sendCeiling:implemented[provider].sendCeiling,...(cents?{customerCeilingCents:cents}:{})}:null;
 return {settings};
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const alphabet='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(8)),b=>alphabet[b%alphabet.length]).join('');
/** Deliberately strict: one plain mailbox, no display name, comma, angle bracket, quote or control character. */
export function normalizeDestination(value:unknown){
 if(typeof value!=='string')throw new ContactError(400,'Enter one email address.');
 const address=value.trim().toLowerCase();
 if(address.length<3||address.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(address))throw new ContactError(400,'Enter one email address.');
 return address;
}
type Destination={id:string;address:string;state:'unverified'|'verified'|'suppressed';verification_expires_at:string|null;created_at:string;verified_at:string|null};
const view=(row:Destination|null)=>row?{id:row.id,address:row.address,state:row.state,verificationPending:row.state==='unverified'&&!!row.verification_expires_at,createdAt:row.created_at,verifiedAt:row.verified_at}:null;
async function owned(db:Pick<D1Database,'prepare'>,userId:string,projectId:string){
 if(!uuid.test(projectId))throw new ContactError(404,'Project not found.');
 const project=await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,userId).first();
 if(!project)throw new ContactError(404,'Project not found.');
}
const readDestination=(db:Pick<D1Database,'prepare'>,projectId:string)=>db.prepare('SELECT id,address,state,verification_expires_at,created_at,verified_at FROM contact_notification_destinations WHERE project_id=?').bind(projectId).first<Destination>();
/** Owner-facing status. Never exposes another tenant's destination; nothing about the provider's address or credentials. */
export async function contactNotificationStatus(db:Pick<D1Database,'prepare'>,userId:string,projectId:string){
 await owned(db,userId,projectId);
 const destination=await readDestination(db,projectId);
 const counts=destination?(await db.prepare("SELECT state,count(*) n FROM notification_notices WHERE destination_id=? AND template='contact.new-message@1' GROUP BY state").bind(destination.id).all<{state:string;n:number}>()).results:[];
 return {destination:view(destination),notices:Object.fromEntries(counts.map(c=>[c.state,c.n]))};
}
/**
 * The owner names the address that may receive notices. It starts unverified and stays unverified until a code delivered through
 * the same selected provider is confirmed, so without a provider it never becomes verified. A suppressed address is refused permanently.
 */
export async function proposeContactDestination(db:Pick<D1Database,'prepare'>,userId:string,projectId:string,value:unknown,now=new Date()){
 await owned(db,userId,projectId);
 const address=normalizeDestination(value),existing=await readDestination(db,projectId);
 if(existing?.address===address&&existing.state!=='suppressed')return view(existing);
 if(await db.prepare('SELECT 1 FROM contact_notification_suppressions WHERE user_id=? AND address=?').bind(userId,address).first())throw new ContactError(409,'That address cannot receive notices from Whumpo.');
 if(existing){if(existing.state==='suppressed')throw new ContactError(409,'That address cannot receive notices from Whumpo.');await held(db.prepare('DELETE FROM contact_notification_destinations WHERE id=? AND user_id=?').bind(existing.id,userId).run());}
 try{await db.prepare('INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),userId,projectId,address,now.toISOString()).run();}
 catch(cause){if(String(cause).includes('contact_destination_suppressed'))throw new ContactError(409,'That address cannot receive notices from Whumpo.');throw cause;}
 return view(await readDestination(db,projectId));
}
/** A safety preservation hold refuses replacing or removing the address (owner question on removal during a hold remains open). */
async function held<T>(work:Promise<T>){try{return await work;}catch(cause){if(String(cause).includes('notification_notice_retained'))throw new ContactError(409,'A notice to this address is being delivered. Try again in a few minutes.');if(String(cause).includes('safety_preservation_hold'))throw new ContactError(423,'This notification address cannot be changed or removed right now. Contact Whumpo support if you need help.');throw cause;}}
/** Removing a destination cancels nothing already accepted by a provider; queued notices are removed with it. Refused inside a safety preservation hold. */
export async function removeContactDestination(db:Pick<D1Database,'prepare'>,userId:string,projectId:string){
 await owned(db,userId,projectId);
 await held(db.prepare('DELETE FROM contact_notification_destinations WHERE project_id=? AND user_id=?').bind(projectId,userId).run());
}
/**
 * Queues one verification notice through the selected provider. Returns `provider_not_configured` (nothing stored, nothing queued)
 * when no reviewed provider is configured. The code is short-lived, limited to 5 wrong attempts, and cleared on success or suppression.
 */
export async function requestContactVerification(db:Pick<D1Database,'prepare'|'batch'>,settings:ContactNotificationSettings|null,userId:string,projectId:string,now=new Date()){
 await owned(db,userId,projectId);
 const destination=await readDestination(db,projectId);
 if(!destination)throw new ContactError(404,'Add a notification address first.');
 if(destination.state!=='unverified')throw new ContactError(409,destination.state==='verified'?'This address is already verified.':'That address cannot receive notices from Whumpo.');
 if(!settings)return {status:'provider_not_configured' as const};
 const code=newCode(),expires=new Date(now.getTime()+verificationValidityMs).toISOString();
 // Atomic: the code and the notice that carries it exist together or not at all. The guarded insert holds the verification rate (3 a day per address, 10 an account).
 const queued=await enqueueNotice(db,{userId,scope:'owner-destination',projectId,destinationId:destination.id,template:'owner.destination-verification@1',eventRef:'verify:'+destination.id+':'+code,now:now.getTime(),
  caps:{hour:10,day:50,templateDay:3,userTemplateDay:10},
  after:id=>[db.prepare("UPDATE contact_notification_destinations SET verification_code=?,verification_expires_at=?,verification_failures=0 WHERE id=? AND state='unverified' AND EXISTS(SELECT 1 FROM notification_notices WHERE id=?)").bind(code,expires,destination.id,id)]});
 if(!queued.queued)throw new ContactError(429,'Too many verification messages. Try again tomorrow.');
 return {status:'queued' as const};
}
/** Verifies only a code whose notice the provider accepted, so verification cannot happen without the delivery path. */
export async function confirmContactDestination(db:Pick<D1Database,'prepare'>,userId:string,projectId:string,code:unknown,now=new Date()){
 await owned(db,userId,projectId);
 const given=typeof code==='string'?code.trim().toUpperCase():'',destination=await readDestination(db,projectId);
 if(!destination||destination.state!=='unverified')throw new ContactError(409,'This address cannot be verified.');
 const iso=now.toISOString();
 const changed=/^[A-Z0-9]{8}$/.test(given)?(await db.prepare("UPDATE contact_notification_destinations SET state='verified',verified_at=?,verification_code=NULL,verification_expires_at=NULL WHERE id=? AND user_id=? AND state='unverified' AND verification_code=? AND verification_expires_at>? AND verification_failures<5 AND EXISTS(SELECT 1 FROM notification_notices o WHERE o.destination_id=contact_notification_destinations.id AND o.template='owner.destination-verification@1' AND o.state IN ('accepted','delivered') AND o.event_ref='verify:'||contact_notification_destinations.id||':'||?)").bind(iso,destination.id,userId,given,iso,given).run()).meta.changes:0;
 if(!changed){await db.prepare("UPDATE contact_notification_destinations SET verification_failures=verification_failures+1 WHERE id=? AND state='unverified' AND verification_failures<5").bind(destination.id).run();throw new ContactError(400,'That code is not valid. Request a new one if it expired or was used too often.');}
 return view(await readDestination(db,projectId));
}
export type ContactDeliveryEvent='bounce'|'complaint'|'unsubscribe';
/**
 * Applies a provider event after the (provider-specific, not yet implemented) signature check, which is the caller's. Idempotent: replays change nothing.
 * A hard bounce, complaint or unsubscribe permanently suppresses the address; a transient bounce is not an event here. The shared intake is applyNoticeEvent.
 */
export async function applyContactDeliveryEvent(db:Pick<D1Database,'prepare'|'batch'>,event:{outboxId:string;type:ContactDeliveryEvent},now=new Date()){
 return applyNoticeEvent(db,{noticeId:event.outboxId,type:event.type,authenticated:true},now.getTime());
}
/** Provider calls recorded in the 32 UTC days ending `now` (the spending-ceiling window), across every notice kind. */
export async function contactSendsInWindow(db:Pick<D1Database,'prepare'>,now=new Date()){return noticeSendsInWindow(db,'cloudflare-email',now.getTime());}
/**
 * Queues notices for new inbox messages. Only messages received after the destination was verified and within the last 24 hours are queued, so activation
 * never backfills. Per destination at most 10 notices an hour and 50 a day (the guarded insert and the schema trigger); messages beyond that remain in the
 * inbox only. Contained projects (WH-050) queue nothing. Past the spending ceiling nothing is queued.
 */
export async function queueContactNotices(db:Pick<D1Database,'prepare'|'batch'>,settings:ContactNotificationSettings,nowMs:number,limit=10){
 const ceiling=Math.max(0,Math.min(100000,Math.floor(settings.sendCeiling)));
 if(await noticeSendsInWindow(db,'cloudflare-email',nowMs)>=ceiling)return 0;
 const iso=new Date(nowMs).toISOString(),hour=nowMs-3600000,dayAgo=nowMs-86400000,dayIso=new Date(dayAgo).toISOString();
 const candidates=(await db.prepare("SELECT s.id AS submission_id,d.id AS destination_id,d.user_id,d.project_id FROM contact_submissions s JOIN contact_notification_destinations d ON d.project_id=s.project_id WHERE d.state='verified' AND s.created_at>=d.verified_at AND s.created_at>? AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM notification_notices o WHERE o.template='contact.new-message@1' AND o.event_ref='message:'||s.id AND o.recipient_key='owner-destination:'||d.id) AND NOT EXISTS(SELECT 1 FROM operator_contained_projects c WHERE c.project_id=s.project_id AND c.scope='contact') AND (SELECT count(*) FROM notification_notices o WHERE o.recipient_key='owner-destination:'||d.id AND o.created_at>?)<10 AND (SELECT count(*) FROM notification_notices o WHERE o.recipient_key='owner-destination:'||d.id AND o.created_at>?)<50 ORDER BY s.created_at,s.id LIMIT ?").bind(dayIso,iso,hour,dayAgo,limit).all<{submission_id:string;destination_id:string;user_id:string;project_id:string}>()).results;
 let queued=0;
 // One batch per row so the caps see rows queued earlier in this run.
 for(const c of candidates)if((await enqueueNotice(db,{userId:c.user_id,scope:'owner-destination',projectId:c.project_id,destinationId:c.destination_id,template:'contact.new-message@1',eventRef:'message:'+c.submission_id,now:nowMs})).queued)queued++;
 return queued;
}
/** The contact adapter on journalLane (the every-minute registry entry): queues contact notices, then drains due attempts. Same caps, ceiling, suppression and at-most-one provider call per attempt as WH-036. */
export function contactDeliveryLane(db:Pick<D1Database,'prepare'|'batch'>,deps:Omit<DeliveryDeps,'tally'>&{tally?:DeliveryDeps['tally']}):JobType{
 return notificationLane(db,{type:'contact_delivery',...deps,tally:deps.tally??{enabled:false,queued:0,accepted:0,retried:0,failed:0,cancelled:0,refused:0},queue:async now=>await queueContactNotices(db,deps.settings,now)+await queueConfiguredNotices(db,deps.settings,now)});
}
/** One dispatcher pass for tests and one-shot callers; the scheduled handler registers `contactDeliveryLane`. */
export async function runContactDelivery(db:Pick<D1Database,'prepare'|'batch'>,settings:ContactNotificationSettings|null,sender:ContactSender,options:{now?:Date;timeoutMs?:number}={}){
 return runNotificationDelivery(db,settings,sender,{...options,queue:async now=>await queueContactNotices(db,settings!,now)+await queueConfiguredNotices(db,settings,now)});
}
export const destinationReviewMs=600000;
/**
 * Exact Chat review of the notification address (owner decision, October 4, 2026). `/contact-notify PROJECT ADDRESS` prepares a
 * ten-minute review pinned to that exact normalized address; only the separate confirmation control (`/confirm-contact-notify REVIEW`)
 * applies it, atomically in the chat-turn transaction (contact_destination_review_apply). Applying never verifies the address:
 * the owner still enters the code the provider delivered, in Dashboard → Contact inbox.
 */
export async function contactNotificationCommand(db:D1Database,userId:string,turnId:string,command:string){
 const [verb,id,...extra]=command.trim().split(/\s+/);
 if(!['/contact-notify','/confirm-contact-notify'].includes(verb))return;
 const result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(verb==='/confirm-contact-notify'){
  if(extra.length||!id||!uuid.test(id))return result('Choose the contact notification review to confirm.');
  if(!await reviewedReply(db,userId,'contactNotification',id))return result(reviewChangedMessage);
  const r=await db.prepare('SELECT r.status,r.expires_at,r.address FROM contact_destination_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<{status:string;expires_at:string;address:string}>();
  if(!r)return result('Contact notification review not found.');
  if(r.status==='applied')return result('That contact notification review was already applied. Open Dashboard → Contact inbox for its current status.');
  if(r.expires_at<=new Date().toISOString())return result('That review expired. Request a fresh contact notification review.');
  return result('Notification address saved for this project. It is not verified yet: open Dashboard → Contact inbox, send a verification code and enter it there. Notices are sent only after verification and only while Whumpo email delivery is active.',[
   db.prepare("UPDATE contact_destination_reviews SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending'").bind(turnId,id,userId)
  ]);
 }
 if(!id||!uuid.test(id)||extra.length!==1)return result('Choose a project and give exactly one email address to receive contact notices.');
 let address:string;try{address=normalizeDestination(extra[0]);}catch{return result('Give exactly one plain email address, without a name or other text.');}
 const p=await db.prepare('SELECT p.name,d.address,d.state FROM projects p LEFT JOIN contact_notification_destinations d ON d.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(id,userId).first<{name:string;address:string|null;state:string|null}>();
 if(!p)return result('Project not found. Ask to list your projects.');
 if(p.state==='suppressed'||await db.prepare('SELECT 1 FROM contact_notification_suppressions WHERE user_id=? AND address=?').bind(userId,address).first())return result('That address cannot receive notices from Whumpo. A bounced, complained or unsubscribed address stays blocked unless Whumpo support reviews a reset.');
 if(p.address===address)return result(`${address} is already the notification address for “${p.name}” (${p.state==='verified'?'verified':'not verified yet'}). Open Dashboard → Contact inbox to manage it.`);
 const reply=`Send contact-form notices for “${p.name}” to ${address}?\n\n${p.address?'This replaces the current address; its unsent notices are discarded. ':''}The address must be verified with a code sent from notify@whumpo.com before any notice is sent. Each notice only says a new message arrived and links to your private inbox; it never contains the visitor's name, email or message. At most 10 notices an hour and 50 a day are sent; further messages stay in the inbox only. Remove the address at any time in Dashboard → Contact inbox.\n\nNothing changes until you use the confirmation button for review ${turnId} within 10 minutes.`;
 return result(reply,[
  db.prepare('INSERT INTO contact_destination_reviews(id,user_id,project_id,address,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,userId,id,address,new Date(Date.now()+destinationReviewMs).toISOString(),turnId,userId),
  await receiptStatement(db,userId,turnId,'contactNotification',turnId,reply)
 ]);
}

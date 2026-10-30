/** WH-202 account notices on the shared outbox (docs/email-change-and-compromise.md decision 4, docs/notifications.md). Every notice is an
 * `account-email` row from `enqueueNotice`, so the 10/hour and 50/day caps per recipient, the shared $5 ceiling, suppression and the unknown-outcome
 * hold are the outbox's. This file only decides WHO may be queued and with which event id; src/notification-outbox.ts decides again at send time.
 * A recipient other than the account's own address is stored as an address hash (`recipient_ref`), never an address. No token is created here. */
import {enqueueNotice,newTally,notificationLane} from '../notification-outbox';
import type {DeliveryDeps} from '../notification-outbox';
import {contactDelivery} from '../contact-email';
import type {ContactEmailEnv} from '../contact-email';
import type {JobType} from '../job-dispatcher';
import {addressKey} from './change';
import type {NoticeDraft} from './change';
import type {MessageKind} from './policy';

type Db=Pick<D1Database,'prepare'|'batch'>;
export const accountTemplates:Readonly<Record<MessageKind,string>>=Object.freeze({
 'confirm-new-address':'account.email-confirm@1','change-requested':'account.email-change-requested@1','change-completed':'account.email-change-completed@1',
 'change-undone':'account.email-change-undone@1','security-review-completed':'account.security-review-completed@1'});
type ChangeFacts={new_address:string|null;previous_verified_at:number|null;receipt_verified_at:number|null};

/** Queue the drafts one step produced. `eventRef` is the change id (email change) or the review id (security review). Best effort: a notice never blocks or
 * reverses the step that already committed (a lost confirmation just means the change expires and can be requested again). */
export async function queueAccountNotices(db:Db,drafts:readonly NoticeDraft[],{accountId,eventRef,now}:{accountId:string;eventRef:string;now:number}){
 let queued=0;
 try{
  const verified=!!(await db.prepare('SELECT 1 FROM users WHERE id=? AND email_verified_at IS NOT NULL').bind(accountId).first());
  const change=drafts[0]?.changeId?await db.prepare('SELECT new_address,previous_verified_at,receipt_verified_at FROM owner_email_changes WHERE change_id=? AND account_id=?').bind(eventRef,accountId).first<ChangeFacts>():null;
  for(const draft of drafts){
   // Decision 4: only the confirmation may go to an unverified address. Old-address notices need that address to have been verified.
   const eligible=draft.kind==='confirm-new-address'?true
    :draft.kind==='change-completed'?change?.previous_verified_at!=null
    :draft.kind==='change-undone'?(draft.to===change?.new_address?change?.receipt_verified_at!=null:change?.previous_verified_at!=null)
    :verified;
   if(!eligible)continue;
   const toOther=draft.kind==='confirm-new-address'||draft.kind==='change-completed'||draft.kind==='change-undone';
   const result=await enqueueNotice(db,{userId:accountId,scope:'account-email',template:accountTemplates[draft.kind],eventRef,now,...(toOther?{recipientRef:await addressKey(draft.to)}:{})});
   if(result.queued)queued++;
  }
 }catch{/* recorded only */}
 return queued;
}

const securityEvents=`SELECT r.id,r.account_id,CASE r.kind WHEN 'passkey_remove' THEN 'account.passkey-removed@1' WHEN 'recovery_start' THEN 'account.recovery-started@1'
  WHEN 'recovery_complete' THEN 'account.recovery-secured@1' ELSE 'account.kit-rotated@1' END AS template,r.created_at*1000 AS at
  FROM identity_effect_receipts r WHERE r.kind IN ('passkey_remove','recovery_start','recovery_complete','kit_rotate')
 UNION ALL SELECT c.id,c.account_id,'account.passkey-added@1',c.created_at*1000 FROM identity_ceremony_receipts c WHERE c.kind='add'`;
export const securityNoticeWindowMs=3600000;
/** Security events (passkey added or removed, recovery started or secured, kit rotated) become notices from the identity engine's own receipts, so a
 * crash after the commit loses nothing. Only an account with a verified address is queued; every other account is skipped silently. Only the last hour
 * is considered, so turning delivery on never backfills history. One enqueue per row so the caps see rows queued earlier in the run. */
export async function queueSecurityNotices(db:Db,nowMs:number,limit=10){
 const rows=(await db.prepare(`SELECT e.id,e.account_id,e.template FROM (${securityEvents}) e JOIN users u ON u.id=e.account_id
  WHERE u.email_verified_at IS NOT NULL AND e.at>? AND NOT EXISTS(SELECT 1 FROM notification_notices n WHERE n.template=e.template AND n.event_ref=e.id AND n.recipient_key='account-email:'||e.account_id)
  ORDER BY e.at,e.id LIMIT ?`).bind(nowMs-securityNoticeWindowMs,limit).all<{id:string;account_id:string;template:string}>()).results;
 let queued=0;
 for(const r of rows)if((await enqueueNotice(db,{userId:r.account_id,scope:'account-email',template:r.template,eventRef:r.id,now:nowMs})).queued)queued++;
 return queued;
}

/** The delivery seam of the address-change and review routes: null (nothing is queued, a change request answers `delivery_unavailable`) unless the platform
 * provider is selected and reviewed and the email binding exists. */
export function accountNoticeDelivery(env:ContactEmailEnv&{DB?:Db}){
 if(!env.DB||!contactDelivery(env))return null;
 const db=env.DB;
 return {async queue(drafts:NoticeDraft[],changeId:string|null,context?:{accountId:string;eventRef?:string}){
  if(context)await queueAccountNotices(db,drafts,{accountId:context.accountId,eventRef:context.eventRef??changeId??'',now:Date.now()});
 }};
}
/** The account lane on the every-minute trigger: queues security-event notices, then drains due attempts like the contact lane. */
export function accountDeliveryLane(db:Db,deps:Omit<DeliveryDeps,'tally'>&{tally?:DeliveryDeps['tally']}):JobType{
 return notificationLane(db,{type:'account_delivery',...deps,tally:deps.tally??newTally(),queue:now=>queueSecurityNotices(db,now)});
}

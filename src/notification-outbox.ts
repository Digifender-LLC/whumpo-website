import {beginStatement,canonicalEnvelopeJson,cancelStatement,envelopeDigest,markUncertain,settleStatement,type JobLease,type JobRow} from './job-journal';
import {dispatchJobs,journalLane,type JobContext,type JobType} from './job-dispatcher';
import {notificationCatalog,notificationDigest,type RecipientScope} from './notification-catalog';
import {hashToken} from './security';
import {isConfiguredTemplate,resolveConfiguredNotice,type ConfiguredSend} from './notification-configurations';
import type {ContactNotice,ContactNotificationSettings,ContactProviderOutcome,ContactSender} from './contact-notifications';
/**
 * WH-156 shared notification outbox (schema/platform.sql `notification_notices`, `notification_send_ledger`; docs/notifications.md).
 * One receipt row per (template, event, recipient) for every notice kind. Each provider attempt is ONE `platform-email` job-journal envelope
 * with maxAttempts 1 (decision 5), so the journal supplies the lease, the fence and the `uncertain` handling and a notice that is refused
 * for certain gets a NEW envelope for its next attempt. The state machine, the caps, the spending ledger and retention are triggers; this
 * module only issues guarded statements and never reads then branches across a commit. Nothing here sends mail by itself: a sender is injected.
 */
type Db=Pick<D1Database,'prepare'|'batch'>;
export const noticeProvider='cloudflare-email';
export const noticeTtlMs=86400000;
export const noticeReconcileMs=72*3600000;
export const maxNoticeAttempts=6;
export const noticeSendTimeoutMs=10000;
/** Interim retention (pending an owner decision): finished notices 30 days after their outcome; unresolved evidence 90 days. */
export const noticeRetentionMs=30*86400000;
export const unresolvedRetentionMs=90*86400000;
const backoffMs=(attempts:number)=>Math.min(360,5*2**(attempts-1))*60000;
export class NoticeError extends Error{constructor(readonly code:'INVALID_NOTICE'|'EVENT_NOT_AUTHENTICATED'){super(code);}}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const withTimeout=<T>(promise:Promise<T>,ms:number)=>new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});

export type NoticeSpec={
 userId:string;scope:RecipientScope;projectId?:string;destinationId?:string;recipientRef?:string;template:string;eventRef:string;now:number;
 /** Guarded insert caps per recipient_key (the triggers hold the same 10/hour and 50/day behind it). `templateDay` and `userTemplateDay` bound one template per recipient and per account. */
 caps?:{hour:number;day:number;templateDay?:number;userTemplateDay?:number};
 /** Statements that must commit with the notice and only when it was newly queued (guard them with EXISTS on the notice id). */
 after?:(noticeId:string)=>D1PreparedStatement[];
};
const recipientKey=(s:NoticeSpec)=>`${s.scope}:${s.destinationId??s.recipientRef??s.userId}`;
/** The journal envelope of one attempt. The notice id is the stable operation; the revision is the attempt it carries. */
async function attemptEnvelope(jobId:string,s:{userId:string;projectId?:string|null;template:string},noticeId:string,attempt:number,created:number,notBefore:number,expiresAt:number){
 const entry=notificationCatalog.templates[s.template],input=await notificationDigest({noticeId,template:s.template,attempt});
 return {contractVersion:1,jobId,ownerAccountId:s.userId,projectId:s.projectId??null,purpose:'platform-email',adapter:{name:'platform-email',version:1,digest:await notificationDigest(entry.template)},
  actor:{kind:'platform-obligation',obligationId:noticeId,policyRevision:1},resource:null,
  intent:{operationId:noticeId,receiptId:noticeId,receiptDigest:input,revision:attempt,inputReferenceId:noticeId,inputDigest:input},eligibility:null,
  schedule:{createdAt:created,notBefore,expiresAt},limits:{maxAttempts:1,deadlineMs:20000}};
}
/** The guarded admission of an attempt's envelope; it inserts nothing unless `guard` (a SQL condition over the notice, bound to ?9) holds. */
async function admitAttempt(db:Db,envelope:Record<string,any>,noticeId:string,guard:string){
 const e=envelope,json=canonicalEnvelopeJson(envelope),digest=await envelopeDigest(envelope),{createdAt,notBefore,expiresAt}=e.schedule;
 return db.prepare(`INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at)
  SELECT ?1,?2,'platform-email',?3,?4,?5,?6,1,?7,?7,'enqueued',?5 WHERE EXISTS(SELECT 1 FROM notification_notices WHERE id=?8 AND ${guard})`).bind(e.jobId,e.ownerAccountId,json,digest,createdAt,expiresAt,notBefore,noticeId);
}
/**
 * The statements that queue one notice and its first attempt's envelope, for a caller that commits them inside a bigger batch (the form admission, WH-158).
 * `safe` adds the checks of the scope trigger to the guarded insert, so a recipient or project that is not valid inserts zero rows instead of aborting
 * the caller's batch; the rate guard is already at or below the trigger's caps. Nothing here can raise, so a notice can never fail the batch it rides in.
 */
export async function noticeStatements(db:Db,spec:NoticeSpec&{safe?:boolean}){
 const entry=notificationCatalog.templates[spec.template];
 if(!entry||entry.state!=='available'||!(entry.template.audiences as string[]).includes(spec.scope)||!spec.eventRef||spec.eventRef.length>128||!Number.isSafeInteger(spec.now))throw new NoticeError('INVALID_NOTICE');
 const id=crypto.randomUUID(),jobId=crypto.randomUUID(),key=recipientKey(spec),expires=spec.now+noticeTtlMs,caps=spec.caps??{hour:10,day:50};
 const envelope=await attemptEnvelope(jobId,spec,id,1,spec.now,spec.now,expires);
 const valid=spec.safe?` AND (?3!='owner-destination' OR EXISTS(SELECT 1 FROM contact_notification_destinations d WHERE d.id=?5 AND d.user_id=?2 AND d.project_id=?4 AND d.state IN ('unverified','verified')))
    AND (?3 NOT IN ('project-staff','submitter') OR EXISTS(SELECT 1 FROM projects WHERE id=?4 AND owner_user_id=?2))`:'';
 const statements=[
  db.prepare(`INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_ref,recipient_key,template,event_ref,created_at,expires_at)
   SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11 WHERE (SELECT count(*) FROM notification_notices WHERE recipient_key=?7 AND (template GLOB 'appointment.*')=(?8 GLOB 'appointment.*') AND created_at>?10-3600000)<?12
    AND (SELECT count(*) FROM notification_notices WHERE recipient_key=?7 AND (template GLOB 'appointment.*')=(?8 GLOB 'appointment.*') AND created_at>?10-86400000)<?13
    AND (?14 IS NULL OR (SELECT count(*) FROM notification_notices WHERE recipient_key=?7 AND template=?8 AND created_at>?10-86400000)<?14)
    AND (?15 IS NULL OR (SELECT count(*) FROM notification_notices WHERE user_id=?2 AND template=?8 AND created_at>?10-86400000)<?15)${valid}
   ON CONFLICT(template,event_ref,recipient_key) DO NOTHING RETURNING id`)
   .bind(id,spec.userId,spec.scope,spec.projectId??null,spec.destinationId??null,spec.recipientRef??null,key,spec.template,spec.eventRef,spec.now,expires,caps.hour,caps.day,caps.templateDay??null,caps.userTemplateDay??null),
  await admitAttempt(db,envelope,id,"job_id IS NULL AND state='queued'"),
  db.prepare("UPDATE notification_notices SET job_id=?1 WHERE id=?2 AND job_id IS NULL AND state='queued' AND EXISTS(SELECT 1 FROM job_journal WHERE id=?1)").bind(jobId,id),
  ...(spec.after?.(id)??[])];
 return {id,jobId,key,statements};
}
/**
 * Queue one notice and the envelope of its first attempt in one batch. The insert is a guarded INSERT ... SELECT, so a duplicate (same template, event
 * and recipient) or a recipient over its caps queues nothing and returns `queued:false`; the caller can tell the two apart by `duplicate`.
 * The template is checked against the source catalog here, not by a CHECK list in the schema.
 */
export async function enqueueNotice(db:Db,spec:NoticeSpec){
 const {id,jobId,key,statements}=await noticeStatements(db,spec);
 const [insert]=await db.batch(statements);
 if(insert.results.length)return {queued:true as const,id,jobId};
 const duplicate=!!await db.prepare('SELECT 1 FROM notification_notices WHERE template=? AND event_ref=? AND recipient_key=?').bind(spec.template,spec.eventRef,key).first();
 return {queued:false as const,duplicate};
}

export type DeliveryTally={enabled:boolean;queued:number;accepted:number;retried:number;failed:number;cancelled:number;refused:number};
export const newTally=():DeliveryTally=>({enabled:false,queued:0,accepted:0,retried:0,failed:0,cancelled:0,refused:0});
type Due={id:string;user_id:string;scope:string;project_id:string|null;destination_id:string|null;recipient_ref:string|null;template:string;event_ref:string;state:string;attempts:number;expires_at:number;
 d_state:string|null;d_address:string|null;code:string|null;code_expires_at:string|null;email:string;email_verified_at:number|null;contained:number;submission_exists:number;suppressed:number;support_unread:number;
 c_state:string|null;c_new:string|null;c_prev:string|null;c_prev_verified:number|null;c_receipt:number|null;c_deliverable:number|null;c_expires:number|null;c_revision:number|null};
// The same values as addressKey (src/email-change/change.ts) and mintConfirmationToken (token.ts), copied because only the main Worker's route table may import
// that folder (tests/email-change-contract.mjs); tests/email-change-delivery.mjs checks they agree.
const addressKey=(address:string)=>hashToken(`email-change-address:${address}`);
const mintConfirmationToken=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
/** Notices this adapter can render: contact notices, the email-change confirmation (its token is minted in the claimed attempt) and any template without variables. */
const sendable=(template:string)=>{const t=notificationCatalog.templates[template]?.template;return !!t&&(template==='owner.destination-verification@1'||template===confirmTemplate||isConfiguredTemplate(template)||Object.keys(t.variables).length===0);};
const confirmTemplate='account.email-confirm@1';
/**
 * The address an account-scope notice goes to, decided from the change row at the moment of sending (docs/email-change-and-compromise.md decision 4).
 * Only the new-address confirmation may go to an unverified address. Notices to the previous address need that address to have been verified; every other
 * account notice goes to the account's own address only while `email_verified_at` is set. `recipient_ref` is the address hash, never an address.
 */
async function accountRecipient(n:Due,now:number):Promise<{address:string;confirm:boolean}|'recipient-revoked'|'record-removed'>{
 const own=n.recipient_ref===null&&n.email_verified_at!==null?{address:n.email.toLowerCase(),confirm:false}:'recipient-revoked' as const;
 const byKey=async(list:Array<[string|null,boolean]>)=>{
  if(n.recipient_ref===null)return null;
  for(const [address,eligible] of list)if(address&&n.recipient_ref===await addressKey(address))return eligible?{address,confirm:false}:'recipient-revoked' as const;
  return null;
 };
 switch(n.template){
  case confirmTemplate:{
   if(n.c_state!=='pending'||n.c_deliverable!==1||n.c_expires===null||now>=n.c_expires||n.c_revision===null||!n.c_new||n.recipient_ref!==await addressKey(n.c_new))return 'record-removed';
   return {address:n.c_new,confirm:true};
  }
  case 'account.email-change-requested@1':return n.c_state==='pending'?own:'record-removed';
  case 'account.email-change-completed@1':
   return n.c_state==='confirmed'||n.c_state==='undone'?await byKey([[n.c_prev,n.c_prev_verified!==null]])??'record-removed':'record-removed';
  case 'account.email-change-undone@1':
   return n.c_state==='undone'?await byKey([[n.c_new,n.c_receipt!==null],[n.c_prev,n.c_prev_verified!==null]])??'record-removed':'record-removed';
  default:return own;
 }
}
const kindOf=(template:string):ContactNotice['kind']=>template==='owner.destination-verification@1'?'verification':template==='contact.new-message@1'?'new_message':isConfiguredTemplate(template)?'configured':'account';

/** Provider calls recorded in the 32 UTC days ending `now` (the spending-ceiling window), across every notice kind. */
export async function noticeSendsInWindow(db:Pick<D1Database,'prepare'>,provider:string,now:number){
 const day=new Date(now).toISOString().slice(0,10);
 return (await db.prepare("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger WHERE provider=?1 AND day>date(?2,'-32 days') AND day<=?2").bind(provider,day).first<{n:number}>())?.n??0;
}

export type DeliveryDeps={settings:ContactNotificationSettings;sender:ContactSender;now:()=>number;timeoutMs?:number;tally:DeliveryTally};
/** One leased attempt. At most one provider call; every outcome is one atomic batch, and a call whose outcome cannot be recorded stays `awaiting` and becomes uncertain. */
async function attempt(db:Db,deps:DeliveryDeps,job:JobRow,lease:JobLease,ctx:JobContext){
 const {settings,sender,tally}=deps,now=deps.now(),owner=job.owner_user_id;
 const n=await db.prepare(`SELECT n.id,n.user_id,n.scope,n.project_id,n.destination_id,n.recipient_ref,n.template,n.event_ref,n.state,n.attempts,n.expires_at,d.state AS d_state,d.address AS d_address,d.verification_code AS code,d.verification_expires_at AS code_expires_at,
   u.email,u.email_verified_at,EXISTS(SELECT 1 FROM operator_contained_projects c WHERE c.project_id=n.project_id AND c.scope='contact') AS contained,
   EXISTS(SELECT 1 FROM contact_submissions s WHERE s.id=substr(n.event_ref,9) AND s.project_id=n.project_id) AS submission_exists,
   EXISTS(SELECT 1 FROM contact_notification_suppressions s WHERE s.user_id=n.user_id AND s.address=coalesce(d.address,lower(u.email))) AS suppressed,
   EXISTS(SELECT 1 FROM usage_review_requests q WHERE q.id=n.event_ref AND q.user_id=n.user_id AND q.state='answered' AND q.customer_read_at IS NULL) AS support_unread
   ,c.state AS c_state,c.new_address AS c_new,c.previous_address AS c_prev,c.previous_verified_at AS c_prev_verified,c.receipt_verified_at AS c_receipt,c.deliverable AS c_deliverable,c.expires_at AS c_expires,c.revision AS c_revision
  FROM notification_notices n JOIN users u ON u.id=n.user_id LEFT JOIN contact_notification_destinations d ON d.id=n.destination_id LEFT JOIN owner_email_changes c ON c.change_id=n.event_ref AND c.account_id=n.user_id AND n.scope='account-email' WHERE n.job_id=?`).bind(job.id).first<Due>();
 // A job whose notice is gone, finished or not waiting for this attempt carries no work: stop it, send nothing.
 if(!n||(n.state!=='queued'&&n.state!=='deferred')){await cancelStatement(db,owner,job.id,now).first();return;}
 const deny=async(reason:'rejected'|'expired'|'suppressed'|'contained'|'ceiling'|'recipient-revoked'|'record-removed'|'template-withdrawn'|'ceiling-unset'|'configuration-changed')=>{
  const [moved]=await db.batch([
   db.prepare("UPDATE notification_notices SET state='cancelled',reason=?1,outcome_at=?2 WHERE id=?3 AND state IN ('queued','deferred') AND job_id=?4 RETURNING id").bind(reason,now,n.id,job.id),
   cancelStatement(db,owner,job.id,now)]);
  if(moved.results.length){if(reason==='ceiling')tally.refused++;else tally.cancelled++;}
 };
 if(n.expires_at<=now)return deny('expired');
 if(!sendable(n.template)||notificationCatalog.templates[n.template]?.state!=='available')return deny('template-withdrawn');
 // WH-158 customer-configured notices (D3, D8): nothing is queued while the owner's monthly spending limit is unset, and this is the second line of defence: a notice that was queued while a limit was set, or by another lane,
 // is cancelled here before any recipient is read or attempt claimed. `!(x>0)` so NaN cannot pass.
 const spendingLimit=Math.max(0,Math.floor(settings.customerCeilingCents??0));
 let recipient:string,code:string|undefined,confirm=false,configured:ConfiguredSend|undefined;
 if(isConfiguredTemplate(n.template)){
  if(!(spendingLimit>0))return deny('ceiling-unset');
  const r=await resolveConfiguredNotice(db,n);
  if(typeof r==='string')return deny(r);
  configured=r;
 }
 if(n.scope==='owner-destination'){
  if(n.d_state==='suppressed'||n.suppressed)return deny('suppressed');
  if(n.contained)return deny('contained');
  recipient=n.d_address!;
  if(n.template==='owner.destination-verification@1'){
   const iso=new Date(now).toISOString();
   if(n.d_state!=='unverified'||!n.code||!n.code_expires_at||n.code_expires_at<=iso||!n.event_ref.endsWith(':'+n.code))return deny('expired');
   code=n.code;
  }else if(n.d_state!=='verified')return deny('recipient-revoked');
  else if(n.template==='contact.new-message@1'&&!n.submission_exists)return deny('record-removed');
 }else if(n.scope==='account-email'){
  // G-E5 and decision 4: the address is only a lookup key until verified; see accountRecipient for the one exception and the previous-address rule.
  const to=await accountRecipient(n,now);
  if(typeof to==='string')return deny(to);
  if(await db.prepare('SELECT 1 FROM contact_notification_suppressions WHERE user_id=? AND address=?').bind(n.user_id,to.address).first())return deny('suppressed');
  // A support notice is only for a response the customer has not read yet.
  if(n.template==='support.response-saved@1'&&!n.support_unread)return deny('record-removed');
  recipient=to.address;confirm=to.confirm;
 }else if(configured?.recipient)recipient=configured.recipient; // project-staff and submitter: resolved from current records just now (WH-158)
 else return deny('recipient-revoked');
 const ceiling=Math.max(0,Math.min(100000,Math.floor(settings.sendCeiling)));
 // The owner's limit for configured notices is a dollar figure; the catalog price turns it into calls. The ledger above keeps the platform ceiling, so a low limit never throttles contact notices.
 const limitCalls=configured?Math.min(Math.floor(ceiling*0.8),Math.floor(spendingLimit*10000/notificationCatalog.providers[noticeProvider].price!.microsPerCall)):ceiling; // D10: configured notices never use the last fifth, kept for security and contact notices
 if(await noticeSendsInWindow(db,noticeProvider,now)>=limitCalls)return deny('ceiling');
 const day=new Date(now).toISOString().slice(0,10);
 // Claim the attempt and count it against the ceiling in one transaction BEFORE the call. The ledger row keeps the lowest ceiling any run applied;
 // the notice trigger counts the send; the ledger trigger refuses the whole claim (journal intent included) past the 32-day ceiling.
 // The new-address confirmation token is minted only here, after the checks and before the one provider call. Only its SHA-256 verifier is committed, in the same
 // batch that moves the notice to `dispatching`; the dispatch step requires that verifier to be on the change, so a lost revision race sends nothing.
 const token=confirm?mintConfirmationToken():undefined,verifier=token?await hashToken(token):null;
 let begun,dispatched;
 try{
  const claimed=await db.batch([
   db.prepare('INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES(?1,?2,0,?3) ON CONFLICT(provider,day) DO UPDATE SET ceiling=min(ceiling,excluded.ceiling)').bind(noticeProvider,day,ceiling),
   beginStatement(db,lease,now),
   ...(verifier?[db.prepare("UPDATE owner_email_changes SET token_verifier=?1,revision=revision+1 WHERE change_id=?2 AND account_id=?3 AND state='pending' AND revision=?4").bind(verifier,n.event_ref,n.user_id,n.c_revision)]:[]),
   db.prepare(`UPDATE notification_notices SET state='dispatching',attempts=attempts+1,dispatched_at=?1,outcome_at=NULL,reason=NULL,sent_to=?7
    WHERE id=?2 AND state IN ('queued','deferred') AND job_id=?3 AND EXISTS(SELECT 1 FROM job_journal WHERE id=?3 AND state='awaiting' AND fence=?4)
     AND (?5 IS NULL OR EXISTS(SELECT 1 FROM owner_email_changes WHERE change_id=?6 AND token_verifier=?5)) RETURNING attempts`).bind(now,n.id,job.id,lease.fence,verifier,n.event_ref,recipient)]);
  begun=claimed[1];dispatched=claimed[claimed.length-1];
 }catch(cause){
  if(String(cause).includes('notification_send_ceiling'))return deny('ceiling');
  if(String(cause).includes('email_change_claim'))return deny('expired');
  throw cause;
 }
 const intent=(begun.results[0] as {attempt_id?:string}|undefined)?.attempt_id,attempts=dispatched.results[0] as {attempts:number}|undefined;
 if(!attempts||!intent){
  // Another actor stopped the notice between the check and the claim. If the journal recorded an intent, nothing was sent: close it without a call.
  if(intent)await settleStatement(db,owner,job.id,intent,'not-sent',now).first();
  return;
 }
 let outcome:ContactProviderOutcome;
 try{
  outcome=await ctx.provider(()=>withTimeout(sender({outboxId:n.id,idempotencyKey:`${n.template}:${n.event_ref}${n.recipient_ref?':'+n.recipient_ref.slice(0,8):''}`.slice(0,120),kind:kindOf(n.template),template:n.template,projectId:n.project_id,recipient,...(configured?{configured:{variables:configured.variables,fields:configured.fields}}:{}),...(code?{verificationCode:code}:{}),...(token?{confirmationToken:token}:{})},settings),deps.timeoutMs??noticeSendTimeoutMs));
 }catch{outcome={accepted:false,retryable:false,uncertain:true};}
 const at=deps.now();
 // A definite non-delivery of the confirmation clears the verifier (a retry mints a new token); a permanent one closes the change as undeliverable.
 const mine="change_id=? AND account_id=? AND state='pending' AND token_verifier=?";
 const release=verifier?[db.prepare(`UPDATE owner_email_changes SET token_verifier=NULL,revision=revision+1 WHERE ${mine}`).bind(n.event_ref,n.user_id,verifier)]:[];
 const undeliverable=verifier?[db.prepare(`UPDATE owner_email_changes SET state='undeliverable',token_verifier=NULL,revision=revision+1,history=json_insert(history,'$[#]','undeliverable:'||?) WHERE ${mine}`).bind(outcome.accepted?'':outcome.suppressed?'suppressed':'rejected',n.event_ref,n.user_id,verifier)]:[];
 const settle=settleStatement(db,owner,job.id,intent,outcome.accepted?'accepted':'refused',at),finish=(state:string,reason:string|null,from="state='dispatching'")=>db.prepare(`UPDATE notification_notices SET state=?1,reason=?2,outcome_at=?3 WHERE id=?4 AND ${from} AND job_id=?5`).bind(state,reason,at,n.id,job.id);
 if(outcome.accepted){
  const ref=typeof outcome.providerRef==='string'&&outcome.providerRef.length>=1&&outcome.providerRef.length<=100?outcome.providerRef:null;
  await db.batch([settle,db.prepare("UPDATE notification_notices SET state='accepted',reason=NULL,outcome_at=?1,provider_ref=?2 WHERE id=?3 AND state IN ('dispatching','unknown-outcome') AND job_id=?4").bind(at,ref,n.id,job.id)]);
  tally.accepted++;return;
 }
 if(outcome.uncertain){
  // The reply was lost: the attempt may have happened. The journal moves the job to uncertain and its trigger moves the notice to unknown-outcome. Never resent.
  await markUncertain(db,lease,at).catch(()=>undefined);tally.failed++;return;
 }
 if(outcome.suppressed){
  await db.batch([db.prepare("INSERT OR IGNORE INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'provider',?)").bind(n.user_id,recipient,new Date(at).toISOString()),
   settle,finish('failed','rejected'),...undeliverable]);tally.failed++;return;
 }
 if(!outcome.retryable||attempts.attempts>=maxNoticeAttempts){
  await db.batch([settle,finish('failed',outcome.retryable?'exhausted':'rejected'),...undeliverable]);tally.failed++;return;
 }
 // Definitely not taken: wait out the backoff in `deferred`, with a NEW envelope for the next attempt (maxAttempts 1 per envelope).
 const next=at+backoffMs(attempts.attempts);
 if(next>=n.expires_at){await db.batch([settle,finish('cancelled','expired'),...release]);tally.cancelled++;return;}
 const nextId=crypto.randomUUID(),env=await attemptEnvelope(nextId,{userId:n.user_id,projectId:n.project_id,template:n.template},n.id,attempts.attempts+1,at,next,n.expires_at);
 await db.batch([settle,...release,await admitAttempt(db,env,n.id,`state='dispatching' AND job_id='${job.id}'`),
  db.prepare("UPDATE notification_notices SET state='deferred',reason='unavailable',outcome_at=?1,job_id=?2 WHERE id=?3 AND state='dispatching' AND job_id=?4 AND EXISTS(SELECT 1 FROM job_journal WHERE id=?2)").bind(at,nextId,n.id,job.id)]);
 tally.retried++;
}

/** The every-minute lane: queues new notices (`queue`, for example the contact candidates), then drains due attempts through journalLane. */
export function notificationLane(db:Db,deps:DeliveryDeps&{type?:string;queue?:(now:number)=>Promise<number>}):JobType{
 const lane=journalLane(db,{type:deps.type??'notification_delivery',purpose:'platform-email',now:deps.now,scan:25,handle:(job,lease,ctx)=>attempt(db,deps,job,lease,ctx)});
 return {type:lane.type,async run(ctx){deps.tally.enabled=true;if(deps.queue)deps.tally.queued+=await deps.queue(deps.now());await lane.run(ctx);}};
}
/** One dispatcher pass over the lane (tests and one-shot callers); the scheduled handler registers `notificationLane` in its own registry. */
export async function runNotificationDelivery(db:Db,settings:ContactNotificationSettings|null,sender:ContactSender,options:{now?:Date;timeoutMs?:number;queue?:(now:number)=>Promise<number>}={}){
 const tally=newTally();
 if(!settings)return tally;
 const now=()=>options.now?.getTime()??Date.now();
 await dispatchJobs([notificationLane(db,{settings,sender,now,timeoutMs:options.timeoutMs,tally,queue:options.queue})],{now});
 return tally;
}

export type NoticeEvent={noticeId?:string;providerRef?:string;type:'accepted'|'delivered'|'bounce'|'complaint'|'unsubscribe';authenticated:boolean};
const evidence:Record<string,{state:string;from:string}>={
 accepted:{state:'accepted',from:"'unknown-outcome'"},delivered:{state:'delivered',from:"'accepted','unknown-outcome'"},
 bounce:{state:'bounced',from:"'accepted','unknown-outcome'"},complaint:{state:'complained',from:"'accepted','delivered','unknown-outcome'"}};
/**
 * Provider event intake, as a function only (no route, queue or webhook exists). The CALLER authenticates the event with the provider's own check
 * (signature, queue binding or credential) and says so; an unauthenticated event is refused. Replays and out-of-order events change nothing:
 * each move is one guarded UPDATE from the allowed states. Bounce, complaint and unsubscribe add the permanent per-account suppression.
 */
export async function applyNoticeEvent(db:Db,event:NoticeEvent,now:number=Date.now()){
 if(event.authenticated!==true)throw new NoticeError('EVENT_NOT_AUTHENTICATED');
 if(!(event.noticeId&&uuid.test(event.noticeId))&&!(typeof event.providerRef==='string'&&event.providerRef.length>=1&&event.providerRef.length<=100))throw new NoticeError('INVALID_NOTICE');
 const row=await db.prepare(`SELECT n.id,n.user_id,n.sent_to AS address FROM notification_notices n
  WHERE (?1 IS NOT NULL AND n.id=?1) OR (?1 IS NULL AND n.provider_ref=?2)`).bind(event.noticeId??null,event.providerRef??null)
  .first<{id:string;user_id:string;address:string|null}>();
 if(!row)return {applied:false};
 const move=evidence[event.type];
 if(move)await db.prepare(`UPDATE notification_notices SET state=?1,reason=NULL,outcome_at=coalesce(outcome_at,?2),provider_ref=coalesce(provider_ref,?3) WHERE id=?4 AND state IN (${move.from})`)
  .bind(move.state,now,event.providerRef??null,row.id).run();
 // Suppress only the exact address this notice was sent to (recorded at the claim); if it is not known, suppress nothing, and never fall back to the owner's login email.
 if(row.address&&(event.type==='bounce'||event.type==='complaint'||event.type==='unsubscribe'))await db.prepare('INSERT OR IGNORE INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,?,?)').bind(row.user_id,row.address,event.type,new Date(now).toISOString()).run();
 return {applied:true};
}
/** A read-only reconciliation lookup was made without evidence: count it (at most three). The hourly pass moves a notice at three lookups to unresolved. */
export async function recordNoticeLookup(db:Pick<D1Database,'prepare'>,id:string){
 return (await db.prepare("UPDATE notification_notices SET lookups=lookups+1 WHERE id=? AND state='unknown-outcome' AND lookups<3 RETURNING lookups").bind(id).first<{lookups:number}>())?.lookups??null;
}
/**
 * Hourly pass. A queued or deferred notice past its 24-hour expiry is cancelled (its envelope may already be expired and never claimed);
 * an unknown-outcome notice at its third lookup or past `reconcile_until` becomes `unresolved` (retained, not discarded). Neither calls the provider.
 */
export async function maintainNotices(db:Pick<D1Database,'prepare'>,now:number=Date.now()){
 const expired=await db.prepare("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=?1 WHERE state IN ('queued','deferred') AND expires_at<=?1 RETURNING id").bind(now).all();
 const unresolved=await db.prepare("UPDATE notification_notices SET state='unresolved',reason='unreconciled',outcome_at=?1 WHERE state='unknown-outcome' AND (reconcile_until<=?1 OR lookups>=3) RETURNING id").bind(now).all();
 // WH-086: expired push events (an event never outlives seven days; the readback already treats an expired one as unavailable).
 await db.prepare('DELETE FROM push_events WHERE id IN (SELECT id FROM push_events WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)').run();
 return {expired:expired.results.length,unresolved:unresolved.results.length};
}
/** Daily retention: finished notices 30 days after their outcome, unresolved ones 90 days (held projects are skipped; the schema refuses open ones). */
export async function pruneNotices(db:Pick<D1Database,'prepare'>,now:number=Date.now()){
 return (await db.prepare(`DELETE FROM notification_notices WHERE (project_id IS NULL OR project_id NOT IN (SELECT project_id FROM safety_held_projects))
  AND ((state IN ('accepted','delivered','bounced','complained','failed','cancelled') AND coalesce(outcome_at,created_at)<=?1-?2) OR (state='unresolved' AND outcome_at<=?1-?3)) RETURNING id`).bind(now,noticeRetentionMs,unresolvedRetentionMs).all()).results.length;
}

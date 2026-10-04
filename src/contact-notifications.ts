import {ContactError} from './contacts';
/**
 * WH-036 provider-neutral contact notifications. The private inbox (`contact_submissions`) is the source of truth;
 * a notice is only a content-free "you have a new message, read it in Whumpo" signal to an owner-reviewed, provider-verified
 * address. No provider is implemented, selected or enabled in this repository: with no selected, implemented and reviewed
 * provider (`settings` null) nothing is queued and nothing is sent, mirroring src/support-delivery.ts (WH-035).
 *
 * Inbound Cloudflare Email Routing is not outbound transactional delivery and is never a provider here
 * (https://developers.cloudflare.com/email-routing/). See docs/contact-forms.md for provider research and the activation gate.
 */
export type ContactNotificationSettings={provider:string;review:string};
export type ContactNotificationEnv={CONTACT_NOTIFICATION_PROVIDER?:string;CONTACT_NOTIFICATION_REVIEW?:string};
/** Providers implemented in this repository. None is selected or implemented yet; tests pass a fake explicitly. */
export const implementedContactNotificationProviders:readonly string[]=[];
/** Never carries the visitor's name, email or message. `verificationCode` exists only for kind 'verification' (the owner proves the address). */
export type ContactNotice={outboxId:string;idempotencyKey:string;kind:'verification'|'new_message';projectId:string;recipient:string;verificationCode?:string};
export type ContactProviderOutcome={accepted:true;providerRef?:string}|{accepted:false;retryable:boolean};
/**
 * A provider must (1) deduplicate on `idempotencyKey` so a timeout retry or replay cannot send twice, (2) send only from a
 * sender identity verified at the provider, (3) report hard bounces, complaints and unsubscribes so they reach `applyContactDeliveryEvent`.
 */
export type ContactSender=(notice:ContactNotice,settings:ContactNotificationSettings)=>Promise<ContactProviderOutcome>;
export const maxContactDeliveryAttempts=6;
export const contactSendTimeoutMs=10000;
export const verificationValidityMs=3600000;
const cleaned=(value:unknown,max:number)=>typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
export function contactNotificationConfig(env:ContactNotificationEnv,implemented:readonly string[]=implementedContactNotificationProviders){
 const provider=cleaned(env.CONTACT_NOTIFICATION_PROVIDER,60),review=cleaned(env.CONTACT_NOTIFICATION_REVIEW,200);
 const settings:ContactNotificationSettings|null=provider&&review&&implemented.includes(provider)?{provider,review}:null;
 return {settings};
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const backoffMinutes=(attempts:number)=>Math.min(360,5*2**(attempts-1));
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
 const counts=destination?(await db.prepare("SELECT state,count(*) n FROM contact_notification_outbox WHERE destination_id=? AND kind='new_message' GROUP BY state").bind(destination.id).all<{state:string;n:number}>()).results:[];
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
 if(existing){if(existing.state==='suppressed')throw new ContactError(409,'That address cannot receive notices from Whumpo.');await db.prepare('DELETE FROM contact_notification_destinations WHERE id=? AND user_id=?').bind(existing.id,userId).run();}
 try{await db.prepare('INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),userId,projectId,address,now.toISOString()).run();}
 catch(cause){if(String(cause).includes('contact_destination_suppressed'))throw new ContactError(409,'That address cannot receive notices from Whumpo.');throw cause;}
 return view(await readDestination(db,projectId));
}
/** Removing a destination cancels nothing already accepted by a provider; queued notices are removed with it. Refused inside a safety preservation hold. */
export async function removeContactDestination(db:Pick<D1Database,'prepare'>,userId:string,projectId:string){
 await owned(db,userId,projectId);
 await db.prepare('DELETE FROM contact_notification_destinations WHERE project_id=? AND user_id=?').bind(projectId,userId).run();
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
 const code=newCode(),iso=now.toISOString(),expires=new Date(now.getTime()+verificationValidityMs).toISOString();
 // Atomic: the code and the notice that carries it exist together or not at all.
 try{
  await db.batch([
   db.prepare("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) VALUES(?,?,?,?,'verification',?,?,?,?,?,?)").bind(crypto.randomUUID(),userId,projectId,destination.id,'verify:'+destination.id+':'+code,settings.provider,settings.review,iso,iso,new Date(now.getTime()+30*86400000).toISOString()),
   db.prepare("UPDATE contact_notification_destinations SET verification_code=?,verification_expires_at=?,verification_failures=0 WHERE id=? AND state='unverified'").bind(code,expires,destination.id)
  ]);
 }catch(cause){if(String(cause).includes('contact_outbox_rate'))throw new ContactError(429,'Too many verification messages. Try again tomorrow.');throw cause;}
 return {status:'queued' as const};
}
/** Verifies only a code whose notice the provider accepted, so verification cannot happen without the delivery path. */
export async function confirmContactDestination(db:Pick<D1Database,'prepare'>,userId:string,projectId:string,code:unknown,now=new Date()){
 await owned(db,userId,projectId);
 const given=typeof code==='string'?code.trim().toUpperCase():'',destination=await readDestination(db,projectId);
 if(!destination||destination.state!=='unverified')throw new ContactError(409,'This address cannot be verified.');
 const iso=now.toISOString();
 const changed=/^[A-Z0-9]{8}$/.test(given)?(await db.prepare("UPDATE contact_notification_destinations SET state='verified',verified_at=?,verification_code=NULL,verification_expires_at=NULL WHERE id=? AND user_id=? AND state='unverified' AND verification_code=? AND verification_expires_at>? AND verification_failures<5 AND EXISTS(SELECT 1 FROM contact_notification_outbox o WHERE o.destination_id=contact_notification_destinations.id AND o.kind='verification' AND o.state='accepted' AND o.idempotency_key='verify:'||contact_notification_destinations.id||':'||?)").bind(iso,destination.id,userId,given,iso,given).run()).meta.changes:0;
 if(!changed){await db.prepare("UPDATE contact_notification_destinations SET verification_failures=verification_failures+1 WHERE id=? AND state='unverified' AND verification_failures<5").bind(destination.id).run();throw new ContactError(400,'That code is not valid. Request a new one if it expired or was used too often.');}
 return view(await readDestination(db,projectId));
}
export type ContactDeliveryEvent='bounce'|'complaint'|'unsubscribe';
/**
 * Applies a provider event after the (provider-specific, not yet implemented) signature check. Idempotent: replays change nothing.
 * A hard bounce, complaint or unsubscribe permanently suppresses the address; a transient bounce is not an event here.
 */
export async function applyContactDeliveryEvent(db:Pick<D1Database,'prepare'>,event:{outboxId:string;type:ContactDeliveryEvent},now=new Date()){
 const row=await db.prepare('SELECT o.id,o.user_id,d.address FROM contact_notification_outbox o JOIN contact_notification_destinations d ON d.id=o.destination_id WHERE o.id=?').bind(event.outboxId).first<{id:string;user_id:string;address:string}>();
 if(!row)return {applied:false};
 const iso=now.toISOString(),terminal=event.type==='bounce'?'bounced':event.type==='complaint'?'complained':null;
 if(terminal)await db.prepare("UPDATE contact_notification_outbox SET state=?,accepted_at=coalesce(accepted_at,?) WHERE id=? AND state IN ('queued','accepted')").bind(terminal,iso,row.id).run();
 await db.prepare('INSERT OR IGNORE INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,?,?)').bind(row.user_id,row.address,event.type,iso).run();
 return {applied:true};
}
const withTimeout=<T>(promise:Promise<T>,ms:number)=>new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('timeout')),ms);promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
type Due={id:string;user_id:string;project_id:string;kind:'verification'|'new_message';submission_id:string|null;idempotency_key:string;attempts:number;expires_at:string;dstate:string;address:string;code:string|null;code_expires_at:string|null;submission_exists:number|null;contained:number};
/**
 * Queues notices for new inbox messages and drains due notices. At-least-once toward the provider with a stable idempotency key, so a
 * timeout or replay is deduplicated by the provider and never creates a second outbox row. Only messages received after the destination was
 * verified and within the last 24 hours are queued, so enabling a provider later never backfills. Per destination at most 10 notices an hour and
 * 50 a day; messages beyond that remain in the inbox only. Contained projects (WH-050) queue and send nothing.
 * It is not scheduled anywhere; activation needs a reviewed provider and a reviewed trigger (docs/contact-forms.md).
 */
export async function runContactDelivery(db:Pick<D1Database,'prepare'>,settings:ContactNotificationSettings|null,sender:ContactSender,options:{now?:Date;limit?:number;timeoutMs?:number}={}){
 const result={enabled:false,queued:0,accepted:0,retried:0,failed:0,cancelled:0};
 if(!settings)return result;
 result.enabled=true;
 const now=options.now??new Date(),iso=now.toISOString(),limit=Math.min(options.limit??10,25),timeout=options.timeoutMs??contactSendTimeoutMs;
 const hour=new Date(now.getTime()-3600000).toISOString(),day=new Date(now.getTime()-86400000).toISOString(),expires=new Date(now.getTime()+30*86400000).toISOString();
 const candidates=(await db.prepare("SELECT s.id AS submission_id,d.id AS destination_id,d.user_id,d.project_id FROM contact_submissions s JOIN contact_notification_destinations d ON d.project_id=s.project_id WHERE d.state='verified' AND s.created_at>=d.verified_at AND s.created_at>? AND s.expires_at>? AND NOT EXISTS(SELECT 1 FROM contact_notification_outbox o WHERE o.idempotency_key='message:'||s.id||':'||d.id) AND NOT EXISTS(SELECT 1 FROM operator_contained_projects c WHERE c.project_id=s.project_id AND c.scope='contact') ORDER BY s.created_at,s.id LIMIT ?").bind(day,iso,limit).all<{submission_id:string;destination_id:string;user_id:string;project_id:string}>()).results;
 for(const c of candidates){
  // One statement per row so the caps see rows queued earlier in this run; the trigger is the backstop.
  const insert=await db.prepare("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,submission_id,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) SELECT ?,?,?,?,'new_message',?,?,?,?,?,?,? WHERE (SELECT count(*) FROM contact_notification_outbox WHERE destination_id=? AND kind='new_message' AND created_at>?)<10 AND (SELECT count(*) FROM contact_notification_outbox WHERE destination_id=? AND kind='new_message' AND created_at>?)<50 ON CONFLICT(idempotency_key) DO NOTHING").bind(crypto.randomUUID(),c.user_id,c.project_id,c.destination_id,c.submission_id,'message:'+c.submission_id+':'+c.destination_id,settings.provider,settings.review,iso,iso,expires,c.destination_id,hour,c.destination_id,day).run();
  result.queued+=insert.meta.changes;
 }
 const due=(await db.prepare("SELECT o.id,o.user_id,o.project_id,o.kind,o.submission_id,o.idempotency_key,o.attempts,o.expires_at,d.state AS dstate,d.address,d.verification_code AS code,d.verification_expires_at AS code_expires_at,(SELECT 1 FROM contact_submissions s WHERE s.id=o.submission_id) AS submission_exists,EXISTS(SELECT 1 FROM operator_contained_projects c WHERE c.project_id=o.project_id AND c.scope='contact') AS contained FROM contact_notification_outbox o JOIN contact_notification_destinations d ON d.id=o.destination_id WHERE o.state='queued' AND o.next_attempt_at<=? ORDER BY o.next_attempt_at,o.id LIMIT ?").bind(iso,limit).all<Due>()).results;
 const cancel=async(row:Due,error:string|null)=>{if((await db.prepare("UPDATE contact_notification_outbox SET state='cancelled',last_error=? WHERE id=? AND state='queued'").bind(error,row.id).run()).meta.changes)result.cancelled++;};
 for(const row of due){
  if(row.dstate==='suppressed'){await cancel(row,'suppressed');continue;}
  if(row.expires_at<=iso){await cancel(row,'expired');continue;}
  if(row.contained){await cancel(row,'contained');continue;}
  if(row.kind==='new_message'&&(row.dstate!=='verified'||!row.submission_exists)){await cancel(row,null);continue;}
  if(row.kind==='verification'&&(row.dstate!=='unverified'||!row.code||!row.code_expires_at||row.code_expires_at<=iso||!row.idempotency_key.endsWith(':'+row.code))){await cancel(row,'expired');continue;}
  const attempts=row.attempts+1,next=new Date(now.getTime()+backoffMinutes(attempts)*60000).toISOString();
  // Claim the attempt (and push the retry time) before sending so a crash cannot hot-loop or double-count.
  if(!(await db.prepare("UPDATE contact_notification_outbox SET attempts=?,next_attempt_at=? WHERE id=? AND state='queued' AND attempts=?").bind(attempts,next,row.id,row.attempts).run()).meta.changes)continue;
  let outcome:ContactProviderOutcome;
  try{outcome=await withTimeout(sender({outboxId:row.id,idempotencyKey:row.idempotency_key,kind:row.kind,projectId:row.project_id,recipient:row.address,...(row.kind==='verification'?{verificationCode:row.code!}:{})},settings),timeout);}catch{outcome={accepted:false,retryable:true};}
  if(outcome.accepted){
   const ref=typeof outcome.providerRef==='string'&&outcome.providerRef.length>=1&&outcome.providerRef.length<=100?outcome.providerRef:null;
   await db.prepare("UPDATE contact_notification_outbox SET state='accepted',accepted_at=?,provider_ref=? WHERE id=? AND state='queued'").bind(iso,ref,row.id).run();result.accepted++;
  }
  else if(!outcome.retryable||attempts>=maxContactDeliveryAttempts){await db.prepare("UPDATE contact_notification_outbox SET state='failed',last_error=? WHERE id=? AND state='queued'").bind(outcome.retryable?'exhausted':'rejected',row.id).run();result.failed++;}
  else{await db.prepare("UPDATE contact_notification_outbox SET last_error='unavailable' WHERE id=? AND state='queued'").bind(row.id).run();result.retried++;}
 }
 return result;
}

import {ContactError} from './contacts';
import {normalizeDestination} from './contact-notifications';
import {enqueueNotice,visitorVerifyTemplate} from './notification-outbox';
import {hashToken} from './security';
/**
 * WH-157 recipient scopes (docs/notifications.md#recipient-scopes, gap G-N7). Recipients are only what the `notification_recipients`
 * view derives from current records (the owner's verified destination, opted-in verified staff, the consenting verified submitter),
 * minus the owner's shared suppression list; no caller, configuration or visitor input can add an address. Nothing is sent: the sender is
 * blocked on WH-036/WH-202, so starting a verification returns `delivery_unavailable` and stores no code (the WH-036 pattern, where an
 * unconfigured provider stores nothing). The visitor-origin routes that call these functions arrive with the sender; the caller must
 * pass the authenticated visitor and project from the session, never from the request body. WH-214 mounts them on the visitor gateway (app-notifications.ts).
 */
type Db=Pick<D1Database,'prepare'>;
export type RecipientScope='owner'|'staff'|'submitter';
export type Recipient={projectId:string;scope:RecipientScope;ref:string;address:string};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const refused='That address cannot receive notices from Whumpo.';
/** Recipients for one project, optionally one scope. Read at enqueue and again before every provider call. */
export async function notificationRecipients(db:Db,projectId:string,scope?:RecipientScope){
 if(!uuid.test(projectId))return [];
 return (await db.prepare('SELECT project_id projectId,scope,ref,address FROM notification_recipients WHERE project_id=? AND (?2 IS NULL OR scope=?2)').bind(projectId,scope??null).all<Recipient>()).results;
}
async function visitorIn(db:Db,projectId:string,visitorId:string){
 if(!uuid.test(projectId)||!uuid.test(visitorId)||!await db.prepare('SELECT 1 FROM app_visitors WHERE id=? AND project_id=? AND revoked=0').bind(visitorId,projectId).first())throw new ContactError(404,'Not found.');
}
const suppressed=(cause:unknown)=>String(cause).includes('notification_address_suppressed');
/** Sets the visitor's notification address; it starts unverified, and a changed address drops its verification and any staff opt-in. */
export async function setVisitorAddress(db:Db,projectId:string,visitorId:string,value:unknown){
 await visitorIn(db,projectId,visitorId);
 const address=normalizeDestination(value);
 // The owner's own mailboxes (account address, any notification destination) are not a visitor's to use: a complaint about a code sent there would suppress the owner's own destination.
 if(await db.prepare('SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=?1 AND (lower(u.email)=?2 OR EXISTS(SELECT 1 FROM contact_notification_destinations d WHERE d.user_id=p.owner_user_id AND d.address=?2))').bind(projectId,address).first())throw new ContactError(409,refused);
 const existing=await db.prepare('SELECT address FROM visitor_notification_addresses WHERE visitor_id=?').bind(visitorId).first<{address:string}>();
 try{
  if(!existing)await db.prepare('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)').bind(visitorId,address).run();
  else if(existing.address!==address)await db.prepare('UPDATE visitor_notification_addresses SET address=?,code_hash=NULL,code_expires_at=NULL,code_failures=0,verified_at=NULL WHERE visitor_id=?').bind(address,visitorId).run();
 }catch(cause){if(suppressed(cause))throw new ContactError(409,refused);throw cause;}
 return {address,verified:!!(await db.prepare('SELECT 1 FROM visitor_notification_addresses WHERE visitor_id=? AND verified_at IS NOT NULL').bind(visitorId).first())};
}
/** Removing the address also removes the staff opt-in (trigger). */
export async function removeVisitorAddress(db:Db,projectId:string,visitorId:string){
 await visitorIn(db,projectId,visitorId);
 await db.prepare('DELETE FROM visitor_notification_addresses WHERE visitor_id=?').bind(visitorId).run();
}
/**
 * Starts address verification. Without the owner's spending limit (`ceilingCents`) delivery is unavailable: it answers `delivery_unavailable`, stores
 * no code and queues nothing, so no address can become verified. With it, one notice is queued through the shared outbox; the code is minted in the
 * claimed attempt and only its hash is stored (notification-outbox.ts); a notice that never sends stores nothing, and a send that is refused after the claim leaves a hash nobody holds.
 * One open request at a time; per visitor 3 an hour and 10 a day, per owner 50 a day, and per target address 3 a day across every owner. The address cap is keyed by a hash of the address (pseudonymous, kept with the notice for its retention) in
 * the notice's event reference, which survives the erasure of `sent_to`, so removing the address after a send does not reset it.
 */
export async function startVisitorVerification(db:Pick<D1Database,'prepare'|'batch'>,projectId:string,visitorId:string,options:{ceilingCents?:number;now?:number}={}){
 await visitorIn(db,projectId,visitorId);
 const row=await db.prepare('SELECT address,verified_at FROM visitor_notification_addresses WHERE visitor_id=?').bind(visitorId).first<{address:string;verified_at:number|null}>();
 if(!row)throw new ContactError(404,'Add a notification address first.');
 if(row.verified_at)throw new ContactError(409,'This address is already verified.');
 if(!((options.ceilingCents??0)>0))return {status:'delivery_unavailable' as const};
 const now=options.now??Date.now();
 if(await db.prepare("SELECT 1 FROM notification_notices WHERE recipient_key=? AND template=? AND state IN ('queued','deferred','dispatching') AND expires_at>?").bind('submitter:'+visitorId,visitorVerifyTemplate,now).first())return {status:'pending' as const};
 const owner=await db.prepare('SELECT owner_user_id id FROM projects WHERE id=?').bind(projectId).first<{id:string}>();
 if(!owner)throw new ContactError(404,'Not found.');
 if(await db.prepare('SELECT 1 FROM contact_notification_suppressions s JOIN visitor_notification_addresses a ON a.address=s.address WHERE s.user_id=? AND a.visitor_id=?').bind(owner.id,visitorId).first())throw new ContactError(409,refused);
 const prefix='verify:'+(await hashToken('visitor-verify|'+row.address)).slice(0,32)+':';
 const queued=await enqueueNotice(db,{userId:owner.id,scope:'submitter',projectId,recipientRef:visitorId,template:visitorVerifyTemplate,eventRef:prefix+crypto.randomUUID(),now,caps:{hour:3,day:10,templateDay:5,userTemplateDay:50,eventPrefixDay:{prefix,max:3}}});
 if(!queued.queued)throw new ContactError(429,'Too many verification messages. Try again tomorrow.');
 return {status:'queued' as const};
}
/** A hint for the visitor's own screen, never the address: first letter of each part and the last label. */
export const maskAddress=(address:string)=>{const [local,domain]=address.split('@'),dot=domain.lastIndexOf('.');return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`;};
/** What the visitor's own screen needs: a masked address, whether it is verified, a pending code, the staff role and opt-in. */
export async function visitorNotificationState(db:Db,projectId:string,visitorId:string,now=Math.floor(Date.now()/1000)){
 await visitorIn(db,projectId,visitorId);
 const a=await db.prepare('SELECT address,verified_at,code_hash IS NOT NULL AND code_expires_at>? AS pending FROM visitor_notification_addresses WHERE visitor_id=?').bind(now,visitorId).first<{address:string;verified_at:number|null;pending:number}>();
 const staff=await db.prepare("SELECT EXISTS(SELECT 1 FROM module_access_roles r JOIN app_visitors v ON v.id=r.visitor_id AND v.access_id=r.instance_id WHERE r.visitor_id=?1 AND r.role='staff' AND r.state='granted') AS role,EXISTS(SELECT 1 FROM staff_notification_optins WHERE visitor_id=?1) AS opted").bind(visitorId).first<{role:number;opted:number}>();
 return {address:a?maskAddress(a.address):null,verified:!!a?.verified_at,codePending:!!a?.pending,staffRole:!!staff?.role,staffOptIn:!!staff?.opted};
}
const hash=async(code:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),b=>b.toString(16).padStart(2,'0')).join('');
/** Completes verification with the delivered code: hash match, unexpired, fewer than 5 wrong tries; clears the code on success. */
export async function completeVisitorVerification(db:Db,projectId:string,visitorId:string,code:unknown,now=Math.floor(Date.now()/1000)){
 await visitorIn(db,projectId,visitorId);
 const given=typeof code==='string'?code.trim().toUpperCase():'';
 const changed=/^[A-Z0-9]{8}$/.test(given)?(await db.prepare('UPDATE visitor_notification_addresses SET verified_at=?,code_hash=NULL,code_expires_at=NULL,code_failures=0 WHERE visitor_id=? AND verified_at IS NULL AND code_hash=? AND code_expires_at>? AND code_failures<5').bind(now,visitorId,await hash(given),now).run()).meta.changes:0;
 if(!changed){await db.prepare('UPDATE visitor_notification_addresses SET code_failures=code_failures+1 WHERE visitor_id=? AND verified_at IS NULL AND code_hash IS NOT NULL AND code_failures<5').bind(visitorId).run();throw new ContactError(400,'That code is not valid. Request a new one if it expired or was used too often.');}
 return {verified:true};
}
/** Staff opt-in: only a current staff holder with a verified, unsuppressed address (`staff_notification_optin_admit`). */
export async function optInStaff(db:Db,projectId:string,instanceId:string,visitorId:string,now=Math.floor(Date.now()/1000)){
 await visitorIn(db,projectId,visitorId);
 if(!uuid.test(instanceId))throw new ContactError(404,'Not found.');
 try{await db.prepare('INSERT OR IGNORE INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,?)').bind(instanceId,visitorId,now).run();}
 catch(cause){
  if(suppressed(cause))throw new ContactError(409,refused);
  if(String(cause).includes('notification_optin_forbidden'))throw new ContactError(403,'Verify your notification address and hold the staff role first.');
  throw cause;
 }
}
export async function optOutStaff(db:Db,projectId:string,instanceId:string,visitorId:string){
 await visitorIn(db,projectId,visitorId);
 await db.prepare('DELETE FROM staff_notification_optins WHERE instance_id=? AND visitor_id=?').bind(instanceId,visitorId).run();
}

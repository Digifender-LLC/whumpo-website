import {requireServiceClientActivation} from './project-specification/service-clients/activation';
import {hashToken} from './security';
import {reviewedReplyGuard} from './chat-review-receipts';
import {requireRebuiltReply} from './reviewed-rebuild';
import {pruneNotices} from './notification-outbox';
/** The reply a contact form review shows, rebuilt from the saved review row (no stored digest). */
const reviewReply=(name:string,enabled:boolean,review:string)=>`${enabled?'Enable':'Disable'} the contact form for “${name}”?\n\n${enabled?'A Contact link will appear on this live version. Visitors submit a name, email and message to your private Whumpo inbox. Messages are retained for 30 days, with a maximum of 100 submissions per project per 30 days and 20 per hour. Message content is never emailed or sent to AI; optional owner email notices, once set up and verified, only say a new message arrived. Publishing or restoring a version disables the form until reviewed again. The source ZIP remains a static export without the hosted form.':'New submissions will stop. Existing messages remain private until their 30-day expiry.'}\n\nNothing changes until you use the confirmation button for review ${review} within 10 minutes.`;
export class ContactError extends Error {constructor(public status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function contactCommand(db:D1Database,userId:string,turnId:string,command:string){
 const [verb,id,...extra]=command.split(/\s+/);
 if(!['/contact-on','/contact-off','/confirm-contact'].includes(verb))return;
 const result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(extra.length||!id||!uuid.test(id))return result("Choose a project and ask to review enabling or disabling its contact form.");
 if(verb==='/confirm-contact'){
  const r=await db.prepare('SELECT r.*,p.name FROM contact_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<{status:string;enabled:number;expires_at:string;name:string}>();
  if(!r)return result('Contact form review not found.');
  if(r.status==='applied')return result("That contact form review was already applied. Open Dashboard → Contact inbox for current status.");
  if(r.expires_at<=new Date().toISOString())return result('That review expired. Request a fresh contact form review.');
  const reviewed=await requireServiceClientActivation(db,userId,'contact',id),g=reviewedReplyGuard(userId,reviewed),shown=reviewedReplyGuard(userId,reviewed?undefined:await requireRebuiltReply(db,userId,id,reviewReply(r.name,!!r.enabled,id)));// activation-prepared reviews carry a link digest instead
  return result(r.enabled?"Contact form enabled for this published version. Visitors can use the Contact link on your live site. Open Dashboard → Contact inbox to read messages privately. Publishing or restoring another version will disable the form until you review it again.":'Contact form disabled. Existing messages remain private and expire after 30 days.',[
   db.prepare("UPDATE contact_reviews SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending'"+g.sql+shown.sql).bind(turnId,id,userId,...g.params,...shown.params)
  ]);
 }
 const p=await db.prepare('SELECT p.name,s.version_id,s.revision AS publication_revision,COALESCE(c.revision,0) AS revision FROM projects p LEFT JOIN publications s ON s.project_id=p.id LEFT JOIN contact_settings c ON c.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(id,userId).first<{name:string;version_id:string|null;publication_revision:number|null;revision:number}>();
 if(!p)return result("Project not found. Ask to list your projects.");
 const enabled=verb==='/contact-on'?1:0;
 if(enabled&&!p.version_id)return result('Publish a website version before enabling its contact form.');
 return result(reviewReply(p.name,!!enabled,turnId),[
  db.prepare('INSERT OR IGNORE INTO contact_settings(project_id) SELECT ? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(id,turnId,userId),
  db.prepare('INSERT INTO contact_reviews(id,user_id,project_id,enabled,expected_revision,publication_revision,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,userId,id,enabled,p.revision,p.publication_revision??-1,new Date(Date.now()+600000).toISOString(),turnId,userId)
 ]);
}
export async function activeContact(db:D1Database,projectId:string){
 return db.prepare('SELECT p.name,c.revision FROM contact_settings c JOIN publications s ON s.project_id=c.project_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=? AND c.enabled=1 AND s.version_id IS NOT NULL AND s.revision=c.publication_revision AND NOT EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=c.project_id)').bind(projectId).first<{name:string;revision:number}>();
}
/** Call only after Origin, bounded body, rate limit and server-side bot verification. */
export async function saveContact(db:D1Database,projectId:string,revision:number,data:Record<string,unknown>){
 const {id,name,email,message}=data;
 if(typeof id!=='string'||!uuid.test(id)||typeof name!=='string'||!name.trim()||name.length>100||typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof message!=='string'||!message.trim()||message.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(name+email+message))throw new ContactError(400,'Use a name, valid email, and message of up to 2,000 characters.');
 const values=[projectId,revision,name.trim(),email.trim(),message.trim()];
 const hash=await hashToken(JSON.stringify(values)),now=new Date();
 const existing=await db.prepare('SELECT request_hash,expires_at FROM contact_receipts WHERE id=? AND project_id=?').bind(id,projectId).first<{request_hash:string;expires_at:string}>();
 if(existing){if(existing.request_hash!==hash||existing.expires_at<=now.toISOString())throw new ContactError(409,'This form was already used. Reload it to send another message.');return;}
 let inserted:D1Result;
 try{inserted=await db.prepare('INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,projectId,revision,hash,name.trim(),email.trim(),message.trim(),now.toISOString(),new Date(now.getTime()+30*86400000).toISOString()).run();}
 catch(cause){if(String(cause).includes('contact_received')){const retry=await db.prepare('SELECT request_hash FROM contact_receipts WHERE id=? AND project_id=?').bind(id,projectId).first<{request_hash:string}>();if(retry?.request_hash===hash)return;throw new ContactError(409,'This form was already used. Reload it.');}if(/contact_(capacity|rate)/.test(String(cause)))throw new ContactError(429,'This inbox is temporarily full. Please try again later.');if(String(cause).includes('contact_unavailable'))throw new ContactError(409,'This form changed or is no longer available. Please reload the website.');throw cause;}
 // The insert wrote the row, and its trigger wrote the receipt with this hash: nothing to verify. Zero changes means a concurrent duplicate or lost acknowledgement, which must never be reported as a different payload's success.
 if(inserted.meta.changes>0)return;
 const saved=await db.prepare('SELECT request_hash FROM contact_receipts WHERE id=? AND project_id=?').bind(id,projectId).first<{request_hash:string}>();
 if(saved?.request_hash!==hash)throw new ContactError(409,'This form was already used. Reload it to send another message.');
}
export async function contactInbox(db:D1Database,userId:string,projectId:string){
 const project=await db.prepare('SELECT p.name,c.enabled,c.publication_revision,s.revision,s.version_id FROM projects p LEFT JOIN contact_settings c ON c.project_id=p.id LEFT JOIN publications s ON s.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(projectId,userId).first<{name:string;enabled:number|null;publication_revision:number|null;revision:number|null;version_id:string|null}>();
 if(!project)throw new ContactError(404,'Project not found.');
 const {results}=await db.prepare('SELECT m.id,m.name,m.email,m.message,m.created_at,m.expires_at FROM contact_submissions m JOIN projects p ON p.id=m.project_id WHERE p.id=? AND p.owner_user_id=? AND m.expires_at>? ORDER BY m.created_at DESC,m.id DESC LIMIT 100').bind(projectId,userId,new Date().toISOString()).all();
 return {project:{id:projectId,name:project.name},enabled:!!await activeContact(db,projectId),messages:results};
}
export async function deleteContact(db:D1Database,userId:string,id:string){
 await db.prepare('DELETE FROM contact_submissions WHERE id=? AND project_id IN(SELECT id FROM projects WHERE owner_user_id=?)').bind(id,userId).run();
}
/** Expiry skips projects inside an active safety preservation hold's scope (WH-015); the hold release resumes ordinary expiry.
 * The inbox already hides expired messages, so retained held messages are not visible to the owner. */
export async function cleanupContacts(db:D1Database){await db.prepare("DELETE FROM contact_submissions WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND project_id NOT IN (SELECT project_id FROM safety_held_projects)").run();await pruneNotices(db);await db.prepare("DELETE FROM contact_receipts WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();await db.prepare("DELETE FROM notification_send_ledger WHERE day<date('now','-40 days')").run();}

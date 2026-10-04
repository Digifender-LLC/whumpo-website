import {featurePredicate} from '../feature-admission';
import {featureRequest,resolveFeatureInclusion} from '../feature-inclusion';
import {assertWorkspace,assertMaintenanceDatabase} from '../workspace-identity/admission';
import {requireSpecificationAvailable} from '../specification-safety';
import {GuestPreviewError,guestPreviewFeature,guestPreviewOperation,guestPreviewLimits as limits,newGuestToken,guestTokenHash,sha256Hex,guestLinkState} from './policy';

/** WH-092 owner handlers. Callers pass the current admitted workspace database, so every
 * statement shares its transaction with the current-identity assertion. Issuance additionally
 * composes current feature inclusion into the insert. Listing, revocation, resolution and
 * deletion are owner history/security controls and need only current identity and ownership. */
type LinkRow={id:string;project_id:string;version_id:string|null;label:string;feedback_enabled:number;created_at:number;expires_at:number;revoked_at:number|null;request_hash:string;feedback:number;open_feedback:number};
type FeedbackRow={id:string;link_id:string;display_name:string;body:string;created_at:number;resolved_at:number|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const linkColumns=`l.id,l.project_id,l.version_id,l.label,l.feedback_enabled,l.created_at,l.expires_at,l.revoked_at,l.request_hash,
 (SELECT count(*) FROM guest_preview_feedback f WHERE f.link_id=l.id) AS feedback,
 (SELECT count(*) FROM guest_preview_feedback f WHERE f.link_id=l.id AND f.resolved_at IS NULL) AS open_feedback`;
const id=(value:unknown,label:string)=>{if(typeof value!=='string'||!uuid.test(value))throw new GuestPreviewError(400,`Choose an exact ${label}.`);return value;};
/** Owner-facing link description. Never includes the token, its hash or request hash. */
function describe(row:LinkRow){
 return {id:row.id,projectId:row.project_id,versionId:row.version_id,label:row.label,feedbackEnabled:row.feedback_enabled===1,
  createdAt:row.created_at,expiresAt:row.expires_at,revokedAt:row.revoked_at,state:guestLinkState(row),
  feedbackCount:row.feedback,openFeedbackCount:row.open_feedback};
}
function describeFeedback(row:FeedbackRow){
 return {id:row.id,linkId:row.link_id,displayName:row.display_name,displayNameVerified:false as const,text:row.body,createdAt:row.created_at,resolvedAt:row.resolved_at};
}
export async function ownedProject(db:D1Database,userId:string,projectId:string){
 if(!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(id(projectId,'project'),userId).first())throw new GuestPreviewError(404,'Project not found.');
}
async function ownedLink(db:D1Database,userId:string,linkId:string){
 const row=await db.prepare(`SELECT ${linkColumns} FROM guest_preview_links l WHERE l.id=? AND l.owner_user_id=?`).bind(id(linkId,'preview link'),userId).first<LinkRow>();
 if(!row)throw new GuestPreviewError(404,'Preview link not found.');
 return row;
}
export function issuance(value:unknown){
 const v=value as Record<string,unknown>|null,allowed=['id','versionId','expiresInHours','feedback','label'];
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k))||!['id','versionId','expiresInHours','feedback'].every(k=>Object.hasOwn(v,k)))
  throw new GuestPreviewError(400,'Provide a request ID, saved version, expiry in hours and whether guests may comment.');
 const hours=v.expiresInHours,label=v.label??'';
 if(typeof hours!=='number'||!Number.isSafeInteger(hours)||hours<limits.minHours||hours>limits.maxHours)throw new GuestPreviewError(400,`Choose an expiry between ${limits.minHours} and ${limits.maxHours} hours.`);
 if(typeof v.feedback!=='boolean')throw new GuestPreviewError(400,'Choose whether guests may comment.');
 if(typeof label!=='string'||label.length>limits.labelLength||/[\u0000-\u001f\u007f]/.test(label))throw new GuestPreviewError(400,`Use a single-line label of at most ${limits.labelLength} characters.`);
 return {id:id(v.id,'request ID'),versionId:id(v.versionId,'saved version'),hours,feedback:v.feedback,label:label.trim()};
}
const failure=(error:unknown)=>{
 const text=String(error);
 if(text.includes('guest_preview_capacity'))return new GuestPreviewError(409,`This project has reached its guest link limit (${limits.activeLinksPerProject} active, ${limits.linksPerProject} retained). Revoke or delete older links first.`);
 if(text.includes('guest_preview_scope'))return new GuestPreviewError(409,'That saved version is no longer available to share. Choose a current saved version.');
 if(text.includes('safety_preservation_hold'))return new GuestPreviewError(409,'This feedback cannot be deleted right now. Contact support if you need help.');
 return null;
};

export async function createGuestPreview(db:D1Database,userId:string,projectId:string,value:unknown,shareBase:string){
 const input=issuance(value);await ownedProject(db,userId,projectId);
 const requestHash=await sha256Hex(JSON.stringify(['guest-preview-link@1',projectId,input.versionId,input.hours,input.feedback,input.label]));
 const replay=async()=>{
  const row=await db.prepare(`SELECT ${linkColumns} FROM guest_preview_links l WHERE l.id=? AND l.owner_user_id=?`).bind(input.id,userId).first<LinkRow>();
  if(!row)return null;
  if(row.request_hash!==requestHash||row.project_id!==projectId)throw new GuestPreviewError(409,'This request ID was already used for a different preview link.');
  // Only the hash was stored: a lost response cannot recover the token. Revoke and issue a new link.
  return {version:1 as const,link:describe(row),token:null,url:null,replayed:true};
 };
 const existing=await replay();if(existing)return existing;
 const version=await db.prepare('SELECT id,digest FROM site_versions WHERE id=? AND project_id=?').bind(input.versionId,projectId).first<{id:string;digest:string}>();
 if(!version)throw new GuestPreviewError(404,'Saved version not found.');
 await requireSpecificationAvailable(db,version.id);
 const request=featureRequest({userId,projectId,featureId:guestPreviewFeature,operation:guestPreviewOperation});
 await assertWorkspace(db,userId);
 if(!(await resolveFeatureInclusion(db,request)).included)throw new GuestPreviewError(403,'Guest preview links require Creator or a higher plan, or an explicit scoped test grant. Existing links, feedback and revocation remain available.');
 const token=newGuestToken(),tokenHash=await guestTokenHash(token),gate=featurePredicate(db,request);
 let changes=0;
 try{
  changes=(await db.prepare(`INSERT INTO guest_preview_links(id,owner_user_id,project_id,version_id,version_digest,token_hash,request_hash,label,feedback_enabled,created_at,expires_at)
   SELECT ?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch()+? WHERE ${gate.sql}`)
   .bind(input.id,userId,projectId,version.id,version.digest,tokenHash,requestHash,input.label,input.feedback?1:0,input.hours*3600,...gate.params).run()).meta.changes;
 }catch(error){
  const mapped=failure(error);if(mapped)throw mapped;
  const again=await replay();if(again)return again;
  if(String(error).includes('UNIQUE')||String(error).includes('PRIMARY KEY'))throw new GuestPreviewError(409,'This request ID was already used for a different preview link.');
  throw error;
 }
 if(changes!==1){const again=await replay();if(again)return again;throw new GuestPreviewError(403,'Feature eligibility or project ownership changed. Refresh the current plan and try again.');}
 const row=await db.prepare(`SELECT ${linkColumns} FROM guest_preview_links l WHERE l.id=? AND l.owner_user_id=?`).bind(input.id,userId).first<LinkRow>();
 if(!row)throw new GuestPreviewError(409,'The preview link could not be confirmed. Check your links before trying again.');
 return {version:1 as const,link:describe(row),token,url:shareBase+'#'+token,replayed:false};
}
export async function listGuestPreviews(db:D1Database,userId:string,projectId:string){
 await ownedProject(db,userId,projectId);
 const {results}=await db.prepare(`SELECT ${linkColumns} FROM guest_preview_links l WHERE l.project_id=? AND l.owner_user_id=? ORDER BY l.created_at DESC,l.id LIMIT ${limits.linksPerProject}`).bind(projectId,userId).all<LinkRow>();
 return {version:1 as const,links:results.map(describe)};
}
/** Immediate and idempotent: the next guest statement (including an in-flight view's final
 * check) no longer matches. Available regardless of current plan. */
export async function revokeGuestPreview(db:D1Database,userId:string,linkId:string){
 await db.prepare('UPDATE guest_preview_links SET revoked_at=unixepoch() WHERE id=? AND owner_user_id=? AND revoked_at IS NULL').bind(id(linkId,'preview link'),userId).run();
 return {version:1 as const,link:describe(await ownedLink(db,userId,linkId))};
}
export async function deleteGuestPreview(db:D1Database,userId:string,linkId:string){
 await ownedLink(db,userId,linkId);
 try{await db.prepare('DELETE FROM guest_preview_links WHERE id=? AND owner_user_id=?').bind(linkId,userId).run();}
 catch(error){throw failure(error)??error;}
 return {version:1 as const,deleted:true};
}
export async function listGuestFeedback(db:D1Database,userId:string,linkId:string){
 const link=await ownedLink(db,userId,linkId);
 const {results}=await db.prepare(`SELECT f.id,f.link_id,f.display_name,f.body,f.created_at,f.resolved_at FROM guest_preview_feedback f JOIN guest_preview_links l ON l.id=f.link_id
  WHERE f.link_id=? AND l.owner_user_id=? ORDER BY f.created_at,f.id LIMIT ${limits.feedbackPerLink}`).bind(linkId,userId).all<FeedbackRow>();
 return {version:1 as const,link:describe(link),feedback:results.map(describeFeedback)};
}
export async function resolveGuestFeedback(db:D1Database,userId:string,linkId:string,feedbackId:string,value:unknown){
 const v=value as Record<string,unknown>|null;
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).join()!=='resolved'||typeof v.resolved!=='boolean')throw new GuestPreviewError(400,'Choose whether this comment is resolved.');
 const changed=(await db.prepare(`UPDATE guest_preview_feedback SET resolved_at=CASE WHEN ? THEN coalesce(resolved_at,max(unixepoch(),created_at)) ELSE NULL END
  WHERE id=? AND link_id=? AND EXISTS(SELECT 1 FROM guest_preview_links WHERE id=? AND owner_user_id=?)`).bind(v.resolved?1:0,id(feedbackId,'comment'),id(linkId,'preview link'),linkId,userId).run()).meta.changes;
 if(changed!==1)throw new GuestPreviewError(404,'Comment not found.');
 const row=await db.prepare('SELECT f.id,f.link_id,f.display_name,f.body,f.created_at,f.resolved_at FROM guest_preview_feedback f JOIN guest_preview_links l ON l.id=f.link_id WHERE f.id=? AND l.owner_user_id=?').bind(feedbackId,userId).first<FeedbackRow>();
 if(!row)throw new GuestPreviewError(404,'Comment not found.');
 return {version:1 as const,feedback:describeFeedback(row)};
}
export async function deleteGuestFeedback(db:D1Database,userId:string,linkId:string,feedbackId:string){
 let changed=0;
 try{changed=(await db.prepare('DELETE FROM guest_preview_feedback WHERE id=? AND link_id=? AND EXISTS(SELECT 1 FROM guest_preview_links WHERE id=? AND owner_user_id=?)').bind(id(feedbackId,'comment'),id(linkId,'preview link'),linkId,userId).run()).meta.changes;}
 catch(error){throw failure(error)??error;}
 if(changed!==1)throw new GuestPreviewError(404,'Comment not found.');
 return {version:1 as const,deleted:true};
}
/** Bounded daily maintenance (platform authority, never a workspace scope): remove link
 * metadata that ended over 30 days ago and never received feedback. Feedback is owner data
 * and stays until the owner deletes it or the project/account is deleted. */
export async function cleanupGuestPreviews(db:D1Database){
 assertMaintenanceDatabase(db);
 return (await db.prepare(`DELETE FROM guest_preview_links WHERE id IN (SELECT id FROM guest_preview_links l
  WHERE coalesce(l.revoked_at,l.expires_at)<unixepoch()-? AND NOT EXISTS(SELECT 1 FROM guest_preview_feedback f WHERE f.link_id=l.id) LIMIT 500)`)
  .bind(limits.endedLinkRetentionDays*86400).run()).meta.changes;
}

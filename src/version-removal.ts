/** Exact owner-scoped reviews. Confirmation is available only to explicit user commands. */
export async function versionRemovalCommand(db:D1Database,userId:string,turnId:string,command:string){
 const [verb,id,...extra]=command.split(/\s+/);
 if(!['/delete-version','/confirm-version-delete'].includes(verb))return;
 const result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(extra.length||!id||!/^[0-9a-f-]{36}$/.test(id))return result("Choose an unused saved version to review its permanent removal.");
 if(verb==='/confirm-version-delete'){
  const r=await db.prepare('SELECT r.*,EXISTS(SELECT 1 FROM site_versions WHERE id=r.version_id) AS present FROM version_removals r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<{status:string;present:number;expires_at:string;version_id:string}>();
  if(!r)return result("Version removal review not found. Ask to list your saved versions.");
  if(r.status==='applied'||!r.present)return result('That saved version has already been removed. Its photos remain in your project unless separately removed.');
  if(r.expires_at<=new Date().toISOString())return result("That version removal review expired. Ask for a fresh review.");
  return result(`Removed saved version ${r.version_id}. Its preview, download and restore links no longer work. Other saved versions, the live site and original photos are unchanged. This cannot be undone and used no AI units.`,[
   db.prepare("UPDATE version_removals SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind(turnId,id,userId,turnId,userId)
  ]);
 }
 const v=await db.prepare("SELECT v.*,p.name,EXISTS(SELECT 1 FROM publications WHERE version_id=v.id) AS live,EXISTS(SELECT 1 FROM publication_actions WHERE version_id=v.id AND status='pending' AND expires_at>?) AS publication_review,EXISTS(SELECT 1 FROM github_backups WHERE version_id=v.id) AS backup,(SELECT COUNT(*) FROM version_photos WHERE version_id=v.id) AS photos FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?").bind(new Date().toISOString(),id,userId).first<{id:string;project_id:string;name:string;digest:string;component_id:string;created_at:string;live:number;publication_review:number;backup:number;photos:number}>();
 if(!v)return result("Saved version not found. Ask to list your saved versions.");
 const retained=await db.prepare("SELECT 1 WHERE EXISTS(SELECT 1 FROM project_spec_heads WHERE version_id=?) OR EXISTS(SELECT 1 FROM project_spec_proposals q WHERE (q.base_version_id=? OR q.target_version_id=?) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_spec_applies WHERE proposal_id=q.id))").bind(v.id,v.id,v.id).first();
 const serviceRetained=await db.prepare("SELECT 1 WHERE EXISTS(SELECT 1 FROM service_client_heads h JOIN service_client_versions v ON v.id=h.version_id WHERE v.website_version_id=?) OR EXISTS(SELECT 1 FROM service_client_proposals q WHERE (q.website_version_id=? OR q.base_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=?) OR q.restore_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=?)) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM service_client_applies WHERE proposal_id=q.id))").bind(v.id,v.id,v.id,v.id).first();
 const activationRetained=await db.prepare("SELECT 1 FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id JOIN service_client_versions v ON v.id=a.version_id WHERE v.website_version_id=? AND s.status='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 1").bind(v.id).first();
 if(serviceRetained||activationRetained)return result('This website version is retained by saved service settings or a pending service review. Save settings against another website version or let the pending review expire before removing it.');
 if(retained)return result('This version is the current saved website configuration or is needed by a pending website review. Save a newer configuration or let the pending review expire before removing it.');
 if(v.live)return result('That version is live and cannot be removed. Publish another saved version or unpublish the site first.');
 if(v.publication_review)return result('That version has an unexpired publication or restore review. Let that review expire before requesting removal.');
 if(v.backup)return result('That version has a GitHub backup review or receipt and is retained to preserve backup recovery and history. Removal of backed-up versions is not supported yet.');
 return result(`Remove this saved version of “${v.name}”?\nVersion: ${v.id}\nSaved: ${v.created_at}\n\nYou will no longer be able to preview, download or restore this version. Other saved versions, your live site and original photos stay available. Copies already downloaded are unaffected.\n\nThis cannot be undone. Nothing changes until you confirm.\nConfirm within 10 minutes using this review’s confirmation button.`,[
  db.prepare('INSERT INTO version_removals(id,user_id,project_id,version_id,digest,component_id,version_created_at,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,userId,v.project_id,v.id,v.digest,v.component_id,v.created_at,new Date(Date.now()+600000).toISOString(),turnId,userId)
 ]);
}

import {requireRebuiltReply,rebuiltGuard} from './reviewed-rebuild';
/** The reply a photo removal review shows, rebuilt from the saved review row (no stored digest). */
const reviewReply=(file:string,project:string)=>`Delete “${file}” from “${project}”? It is not used by any saved website version. This removes your access immediately and queues storage cleanup; it cannot be undone. Nothing changes until you confirm.\n\nConfirm within 10 minutes using this review’s confirmation button.`;
/** Explicit user commands only. Model proposals cannot confirm removal. */
export async function photoRemovalCommand(db:D1Database,userId:string,turnId:string,command:string) {
 const [verb,id,...extra]=command.split(/\s+/);
 if(!['/delete-photo','/confirm-photo-delete'].includes(verb))return;
 const result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(extra.length||!id||!/^[0-9a-f-]{36}$/.test(id))return result("Choose an unused project photo to review its removal.");
 if(verb==='/confirm-photo-delete'){
  const review=await db.prepare('SELECT r.*,p.name AS project_name,EXISTS(SELECT 1 FROM project_files WHERE id=r.file_id) AS present FROM photo_removals r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<{status:string;expires_at:string;name:string;project_name:string;present:number}>();
  if(!review)return result("Photo removal review not found. Ask to list your project’s photos.");
  if(review.status==='applied'||!review.present)return result('That photo has already been removed. Its storage cleanup is handled separately.');
  if(review.expires_at<=new Date().toISOString())return result("That photo removal review expired. Ask for a fresh review.");
  const g=rebuiltGuard(userId,await requireRebuiltReply(db,userId,id,reviewReply(review.name,review.project_name)));
  return result(`Removed “${review.name}” from your project. Storage cleanup is queued and may take until a later daily cleanup. This cannot be undone and used no AI units.`,[
   db.prepare("UPDATE photo_removals SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)"+g.sql).bind(turnId,id,userId,turnId,userId,...g.params)
  ]);
 }
 const file=await db.prepare('SELECT f.id,f.name,f.project_id,p.name AS project_name,(SELECT COUNT(*) FROM version_photos WHERE file_id=f.id) AS versions FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_user_id=?').bind(id,userId).first<{id:string;name:string;project_id:string;project_name:string;versions:number}>();
 if(!file)return result("Photo not found. Ask to list your project’s photos.");
 if(file.versions)return result(`“${file.name}” is retained by ${file.versions} saved website version${file.versions===1?'':'s'} and cannot be deleted. Older drafts, restores and exports need those original bytes. Removing it from a newer draft does not remove earlier versions.`);
 return result(reviewReply(file.name,file.project_name),[
  db.prepare('INSERT INTO photo_removals(id,user_id,project_id,file_id,name,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,userId,file.project_id,file.id,file.name,new Date(Date.now()+600000).toISOString(),turnId,userId)
 ]);
}

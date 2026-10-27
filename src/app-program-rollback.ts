import {reviewedReplyGuard,type ReviewedReply} from './chat-review-receipts';
import {BackendError} from './backend-versions';
import {hashToken} from './security';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
/** Owned rollback review; Chat confirmation separately requires a fresh owner session. */
export async function readProgramRollback(db:D1Database,user:string,id:string){
 if(!uuid.test(id))throw new BackendError(400,'Choose a rollback review');
 const r=await db.prepare(`SELECT r.id,r.project_id,r.point_id,r.from_version,r.status,r.expires_at,json_array_length(r.roster_json) documents,p.version_id,p.created_at point_created_at,project.name,
 old.source current_source,old.digest current_digest,target.source saved_source,target.digest saved_digest,
 r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') unexpired,
 EXISTS(SELECT 1 FROM app_recovery_points backup WHERE backup.id=r.id AND backup.removed=0 AND backup.sealed=1) AND a.enabled=0 AND a.revision=r.base_revision AND a.version_id=r.from_version AND p.removed=0 AND p.sealed=1 AND roster.roster_json=r.roster_json AND NOT EXISTS(SELECT 1 FROM json_each(r.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=r.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor'))) eligible
 FROM app_restore_reviews r JOIN app_recovery_points p ON p.id=r.point_id AND p.user_id=r.user_id AND p.project_id=r.project_id JOIN projects project ON project.id=r.project_id AND project.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN app_recovery_rosters roster ON roster.project_id=r.project_id JOIN backend_versions old ON old.id=r.from_version AND old.project_id=r.project_id JOIN backend_versions target ON target.id=p.version_id AND target.project_id=r.project_id WHERE r.id=? AND r.user_id=? AND r.restore_program=1`).bind(id,user).first<{id:string;project_id:string;point_id:string;from_version:string;status:string;expires_at:string;documents:number;version_id:string;point_created_at:string;name:string;current_source:string;current_digest:string;saved_source:string;saved_digest:string;unexpired:number;eligible:number}>();
 if(!r)throw new BackendError(404,'Rollback review not found');
 if(await hashToken(r.current_source)!==r.current_digest||await hashToken(r.saved_source)!==r.saved_digest)throw new BackendError(409,'Program source integrity check failed');
 return {id:r.id,projectId:r.project_id,projectName:r.name,pointId:r.point_id,beforePointId:r.id,pointCreatedAt:r.point_created_at,documents:r.documents,expiresAt:r.expires_at,state:r.status==='applied'?'applied':!r.unexpired?'expired':r.eligible?'ready':'changed',from:{id:r.from_version,source:r.current_source,digest:r.current_digest},to:{id:r.version_id,source:r.saved_source,digest:r.saved_digest}};
}
export async function prepareProgramRollback(db:D1Database,user:string,project:string,point:string,id:string){
 if(![project,point,id].every(v=>uuid.test(v)))throw new BackendError(400,'Choose an application, recovery point and review ID');
 const prior=await db.prepare('SELECT id FROM app_restore_reviews WHERE id=?').bind(id).first();
 if(!prior){
  const a=await db.prepare('SELECT a.version_id,a.revision,r.roster_json FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_rosters r ON r.project_id=a.project_id WHERE a.project_id=? AND a.owner_user_id=? AND a.enabled=0').bind(project,user).first<{version_id:string;revision:number;roster_json:string}>();
  if(!a)throw new BackendError(409,'Disable the owned application before reviewing a program rollback');
  try{await db.batch([
   db.prepare('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)').bind(id,user,project,a.version_id),
   db.prepare('INSERT INTO app_restore_reviews(id,user_id,project_id,point_id,base_revision,roster_json,restore_program,from_version) VALUES(?,?,?,?,?,?,1,?)').bind(id,user,project,point,a.revision,a.roster_json,a.version_id)
  ]);}catch{/* Only a matching committed review confirms preparation. */}
 }
 let review;try{review=await readProgramRollback(db,user,id);}catch{throw new BackendError(409,'Rollback review unavailable. Choose a retained point for another program containing every active visitor, and check recovery capacity');}
 if(review.projectId!==project||review.pointId!==point)throw new BackendError(409,'Review ID already used');return review;
}
export async function confirmProgramRollback(db:D1Database,user:string,id:string,confirmation:unknown,reviewed?:ReviewedReply){
 if(confirmation!=='ROLLBACK')throw new BackendError(400,'Type ROLLBACK to restore the reviewed program and documents');
 const review=await readProgramRollback(db,user,id);if(review.state==='applied')return review;
 if(review.state!=='ready')throw new BackendError(409,'Rollback review expired or app/visitor data changed');
 try{const g=reviewedReplyGuard(user,reviewed);await db.prepare("UPDATE app_restore_reviews SET status='applied' WHERE id=? AND user_id=? AND restore_program=1 AND status='pending'"+g.sql).bind(id,user,...g.params).run();}
 catch{const saved=await readProgramRollback(db,user,id);if(saved.state==='applied')return saved;throw new BackendError(409,'Rollback not confirmed. Retry this exact review to recover an uncertain response, or prepare a new review if data changed');}
 const saved=await readProgramRollback(db,user,id);if(saved.state!=='applied')throw new BackendError(503,'Rollback result unavailable. Retry the same review');return saved;
}

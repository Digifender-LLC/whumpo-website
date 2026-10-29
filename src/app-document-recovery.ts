import {reviewedReplyGuard,type ReviewedReply} from './chat-review-receipts';
import {BackendError} from './backend-versions';
import {admitWithTurnover,compactedReview} from './review-turnover';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
async function owner(db:D1Database,user:string,project:string){
 if(!uuid.test(project))throw new BackendError(400,'Choose an application');
 const row=await db.prepare('SELECT a.version_id,a.revision FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.owner_user_id=?').bind(project,user).first<{version_id:string;revision:number}>();
 if(!row)throw new BackendError(404,'Application not found');return row;
}
/** Recovery controls return metadata only. Never return documents or visitor rosters to a model. */
export async function createRecoveryPoint(db:D1Database,user:string,project:string,id:string){
 if(!uuid.test(id))throw new BackendError(400,'Provide a recovery request ID');
 const app=await owner(db,user,project);
 const read=()=>db.prepare('SELECT id,user_id,project_id,version_id,created_at,removed FROM app_recovery_points WHERE id=?').bind(id).first<{id:string;user_id:string;project_id:string;version_id:string;created_at:string;removed:number}>();
 let row=await read();if(!row){try{await db.prepare('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)').bind(id,user,project,app.version_id).run();}catch{/* Recover a committed request, never manufacture success. */}row=await read();}
 if(!row)throw new BackendError(409,'Recovery point not confirmed; retry this request or check recovery capacity');
 if(row.user_id!==user||row.project_id!==project)throw new BackendError(409,'Recovery request ID already used');return row;
}
export async function listRecoveryPoints(db:D1Database,user:string,project:string){
 await owner(db,user,project);
 return (await db.prepare('SELECT r.id,r.version_id,r.created_at,(SELECT count(*) FROM app_recovery_documents d WHERE d.point_id=r.id) AS retainedDocuments FROM app_recovery_points r WHERE r.project_id=? AND r.user_id=? AND r.removed=0 ORDER BY r.created_at DESC,r.id LIMIT 10').bind(project,user).all()).results;
}
type Review={id:string;user_id:string;project_id:string;point_id:string;base_revision:number;roster_json:string;status:string;expires_at:string;point_created_at:string;version_id:string;project_name:string};
async function readReview(db:D1Database,user:string,project:string,id:string){
 await owner(db,user,project);
 const row=await db.prepare('SELECT r.*,p.created_at AS point_created_at,p.version_id,project.name AS project_name FROM app_restore_reviews r JOIN app_recovery_points p ON p.id=r.point_id JOIN projects project ON project.id=r.project_id WHERE r.id=? AND r.user_id=? AND r.project_id=? AND r.restore_program=0').bind(id,user,project).first<Review>();
 if(!row)throw await compactedReview(db,'app_restore_reviews',id,user,(s,m)=>new BackendError(s,m))??new BackendError(404,'Restore review not found');return row;
}
const summary=(r:Review)=>({id:r.id,projectId:r.project_id,pointId:r.point_id,status:r.status,documents:JSON.parse(r.roster_json).length as number,expiresAt:r.expires_at,pointCreatedAt:r.point_created_at,versionId:r.version_id,projectName:r.project_name});
export async function prepareAppRestore(db:D1Database,user:string,project:string,point:string,id:string){
 if(!uuid.test(id)||!uuid.test(point))throw new BackendError(400,'Choose a recovery point and review ID');
 await owner(db,user,project);
 const previous=await db.prepare('SELECT id FROM app_restore_reviews WHERE id=?').bind(id).first();
 if(!previous){const gone=await compactedReview(db,'app_restore_reviews',id,user,(s,m)=>new BackendError(s,m));if(gone)throw gone;}
 if(!previous)try{await admitWithTurnover(db,'app_restore_reviews',{user,project},db.prepare('INSERT INTO app_restore_reviews(id,user_id,project_id,point_id,base_revision,roster_json) SELECT ?,?,?,?,a.revision,r.roster_json FROM app_spaces a JOIN app_recovery_rosters r ON r.project_id=a.project_id WHERE a.project_id=? AND a.owner_user_id=?').bind(id,user,project,point,project,user));}catch{/* Exact saved review is the only successful result. */}
 let row:Review;try{row=await readReview(db,user,project,id);}catch{throw new BackendError(409,'Disable the app first and choose a recovery point for the current program containing every active visitor');}
 if(row.point_id!==point)throw new BackendError(409,'Restore request ID already used');return summary(row);
}
export async function confirmAppRestore(db:D1Database,user:string,project:string,id:string,confirmation:unknown,reviewed?:ReviewedReply){
 if(!uuid.test(id)||confirmation!=='RESTORE')throw new BackendError(400,'Type RESTORE to confirm the reviewed replacement');
 let row=await readReview(db,user,project,id);if(row.status==='applied')return summary(row);
 try{const g=reviewedReplyGuard(user,reviewed);if(!(await db.prepare("UPDATE app_restore_reviews SET status='applied' WHERE id=? AND user_id=? AND project_id=? AND status='pending'"+g.sql).bind(id,user,project,...g.params).run()).meta.changes)throw 0;}catch{row=await readReview(db,user,project,id);if(row.status!=='applied')throw new BackendError(409,'Restore review expired or app/visitor data changed. Prepare a new review');}
 row=await readReview(db,user,project,id);if(row.status!=='applied')throw new BackendError(503,'Restore result unavailable; retry the same review');return summary(row);
}

export async function readAppRestore(db:D1Database,user:string,project:string,id:string){return summary(await readReview(db,user,project,id));}
export async function removeRecoveryPoint(db:D1Database,user:string,project:string,id:string,confirmation:unknown){
 if(!uuid.test(id)||confirmation!=='REMOVE')throw new BackendError(400,'Type REMOVE to delete the saved recovery documents');
 await owner(db,user,project);
 const read=()=>db.prepare('SELECT removed FROM app_recovery_points WHERE id=? AND user_id=? AND project_id=?').bind(id,user,project).first<{removed:number}>();
 let row=await read();if(!row)throw new BackendError(404,'Recovery point not found');
 if(!row.removed)try{await db.prepare('UPDATE app_recovery_points SET removed=1 WHERE id=? AND user_id=? AND project_id=? AND removed=0').bind(id,user,project).run();}catch{row=await read();if(!row?.removed)throw new BackendError(409,'Removal is not confirmed. Retry the same recovery point');}
 row=await read();if(!row?.removed)throw new BackendError(503,'Removal result unavailable. Retry the same recovery point');return {id,removed:true};
}

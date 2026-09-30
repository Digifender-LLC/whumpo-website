import {BackendError} from './backend-versions';
import {hashToken} from './security';
import {readMigrationCheck} from './app-migration-checks';
/** Exact private source review; no visitor document or transformed payload is exposed. */
export async function readMigrationReview(db:D1Database,user:string,id:string){
 const progress=await readMigrationCheck(db,user,id);
 const row=await db.prepare(`SELECT p.name,m.base_revision,
 old.source old_source,old.digest old_digest,target.source target_source,target.digest target_digest,transform.source transform_source,transform.digest transform_digest,
 coalesce((SELECT changed_documents FROM app_migration_approvals WHERE id=m.id AND status='applied'),(SELECT count(*) FROM app_migration_documents d JOIN app_recovery_documents b ON b.point_id=d.migration_id AND b.visitor_id=d.visitor_id WHERE d.migration_id=m.id AND d.state='ready' AND d.next_json!=b.state_json)) changed_documents
 FROM app_migration_checks m JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id
 JOIN backend_versions old ON old.id=m.from_version AND old.project_id=m.project_id JOIN backend_versions target ON target.id=m.to_version AND target.project_id=m.project_id JOIN backend_versions transform ON transform.id=m.transform_version AND transform.project_id=m.project_id
 WHERE m.id=? AND m.user_id=?`).bind(id,user).first<{name:string;base_revision:number;old_source:string;old_digest:string;target_source:string;target_digest:string;transform_source:string;transform_digest:string;changed_documents:number}>();
 if(!row)throw new BackendError(404,'Migration review not found');
 for(const [source,digest]of [[row.old_source,row.old_digest],[row.target_source,row.target_digest],[row.transform_source,row.transform_digest]])if(await hashToken(source)!==digest)throw new BackendError(409,'Migration source integrity check failed');
 return {...progress,projectName:row.name,baseRevision:row.base_revision,changedDocuments:row.changed_documents,original:{source:row.old_source,digest:row.old_digest},target:{source:row.target_source,digest:row.target_digest},transform:{source:row.transform_source,digest:row.transform_digest}};
}
/** Applies only after explicit customer confirmation; Chat enforces a fresh session. Never callable by a model. */
export async function confirmMigration(db:D1Database,user:string,id:string,confirmation:unknown){
 if(confirmation!=='UPGRADE')throw new BackendError(400,'Type UPGRADE to confirm the reviewed program and data replacement');
 const review=await readMigrationReview(db,user,id);if(review.state==='applied')return review;
 if(review.state!=='ready')throw new BackendError(409,'Every document must pass its current migration check before approval');
 try{await db.prepare("INSERT INTO app_migration_approvals(id,user_id,changed_documents) SELECT ?,?,count(*) FROM app_migration_documents d JOIN app_recovery_documents b ON b.point_id=d.migration_id AND b.visitor_id=d.visitor_id WHERE d.migration_id=? AND d.state='ready' AND d.next_json!=b.state_json").bind(id,user,id).run();}
 catch{const saved=await readMigrationReview(db,user,id);if(saved.state==='applied')return saved;throw new BackendError(409,'Upgrade was not confirmed. Check whether the app, visitor data or recovery point changed; retry this exact review to recover an uncertain response');}
 const saved=await readMigrationReview(db,user,id);if(saved.state!=='applied')throw new BackendError(503,'Upgrade result unavailable. Retry the same review');return saved;
}

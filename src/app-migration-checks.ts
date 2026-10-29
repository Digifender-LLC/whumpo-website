import {projectRuntime} from './runtime-lane';
import {BackendError,callBackend} from './backend-versions';
import {hashToken} from './security';
import {admitWithTurnover,compactedReview} from './review-turnover';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Check={id:string;user_id:string;project_id:string;from_version:string;to_version:string;transform_version:string;test_id:string;base_revision:number;roster_json:string;expires_at:string};
async function owned(db:D1Database,user:string,id:string){
 if(!uuid.test(id))throw new BackendError(400,'Choose a migration check');
 const m=await db.prepare('SELECT m.* FROM app_migration_checks m JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id WHERE m.id=? AND m.user_id=?').bind(id,user).first<Check>();
 if(!m)throw await compactedReview(db,'app_migration_checks',id,user,(s,m)=>new BackendError(s,m))??new BackendError(404,'Migration check not found');return m;
}
export async function readMigrationCheck(db:D1Database,user:string,id:string){
 const m=await owned(db,user,id);
 const row=await db.prepare("SELECT EXISTS(SELECT 1 FROM app_migration_cancellations WHERE id=?) cancelled,EXISTS(SELECT 1 FROM app_migration_approvals WHERE id=? AND status='applied') applied,EXISTS(SELECT 1 FROM app_migration_current WHERE id=?) current,count(*) retained,coalesce(sum(state='pending'),0) pending,coalesce(sum(state='running'),0) running,coalesce(sum(state='ready'),0) ready,coalesce(sum(state='failed'),0) failed FROM app_migration_documents WHERE migration_id=?").bind(id,id,id,id).first<{cancelled:number;applied:number;current:number;retained:number;pending:number;running:number;ready:number;failed:number}>();
 const expected=JSON.parse(m.roster_json).length as number;
 return {id,projectId:m.project_id,fromVersion:m.from_version,toVersion:m.to_version,transformVersion:m.transform_version,testId:m.test_id,expiresAt:m.expires_at,documents:expected,pending:row!.pending,running:row!.running,ready:row!.ready,failed:row!.failed,state:row!.applied?'applied':row!.cancelled?'cancelled':!row!.current||row!.retained!==expected?'changed':row!.failed?'failed':row!.running?'uncertain':row!.pending?'preparing':'ready'};
}
/** Preparation only; Chat/model actions may prepare checks but cannot apply them. */
export async function beginMigrationCheck(db:D1Database,user:string,project:string,id:string,target:string,transform:string,test:string){
 if(![project,id,target,transform,test].every(v=>uuid.test(v)))throw new BackendError(400,'Provide application, saved versions, test and request IDs');
 const previous=await db.prepare('SELECT * FROM app_migration_checks WHERE id=?').bind(id).first<Check>();
 if(previous){if(previous.user_id!==user||previous.project_id!==project||previous.to_version!==target||previous.transform_version!==transform||previous.test_id!==test)throw new BackendError(409,'Migration request ID already used');return readMigrationCheck(db,user,id);}
 const gone=await compactedReview(db,'app_migration_checks',id,user,(s,m)=>new BackendError(s,m));if(gone)throw gone;
 const a=await db.prepare('SELECT a.version_id,a.revision,r.roster_json FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_rosters r ON r.project_id=a.project_id WHERE a.project_id=? AND a.owner_user_id=? AND a.enabled=0').bind(project,user).first<{version_id:string;revision:number;roster_json:string}>();
 if(!a)throw new BackendError(409,'Disable the owned application before preparing a migration');
 try{await admitWithTurnover(db,'app_migration_checks',{user,project},[
  db.prepare('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)').bind(id,user,project,a.version_id),
  db.prepare('INSERT INTO app_migration_checks(id,user_id,project_id,from_version,to_version,transform_version,test_id,base_revision,roster_json) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,user,project,a.version_id,target,transform,test,a.revision,a.roster_json)
 ]);}catch{
  const saved=await db.prepare('SELECT user_id,project_id,to_version,transform_version,test_id FROM app_migration_checks WHERE id=?').bind(id).first<Check>();
  if(!saved||saved.user_id!==user||saved.project_id!==project||saved.to_version!==target||saved.transform_version!==transform||saved.test_id!==test)throw new BackendError(409,'Migration check not saved. Check the successful target-program test, current app state and storage allowance');
 }
 return readMigrationCheck(db,user,id);
}
/** Claim at most three per-document executions. A running/uncertain claim never executes twice. */
export async function advanceMigrationCheck(db:D1Database,service:Fetcher,user:string,id:string){
 const m=await owned(db,user,id),current=await readMigrationCheck(db,user,id);if(current.state!=='preparing')return current;
 const code=await db.prepare('SELECT source,digest FROM backend_versions WHERE id=? AND project_id=?').bind(m.transform_version,m.project_id).first<{source:string;digest:string}>();
 if(!code||await hashToken(code.source)!==code.digest)throw new BackendError(409,'Migration source integrity check failed');
 const {results:pending}=await db.prepare("SELECT d.visitor_id,b.state_json FROM app_migration_documents d JOIN app_recovery_documents b ON b.point_id=d.migration_id AND b.visitor_id=d.visitor_id WHERE d.migration_id=? AND d.state='pending' ORDER BY d.visitor_id LIMIT 3").bind(id).all<{visitor_id:string;state_json:string}>();
 for(const doc of pending){
  let claimed=false;try{const result=await db.prepare("UPDATE app_migration_documents SET state='running' WHERE migration_id=? AND visitor_id=? AND state='pending'").bind(id,doc.visitor_id).run();claimed=result.meta.changes===1;}catch{return readMigrationCheck(db,user,id); /* Uncertain claim: no execution. */}
  if(!claimed)continue;
  const result=await callBackend(await projectRuntime(service,m.project_id),code.source,{state:JSON.parse(doc.state_json)});
  let encoded:string|null=null;
  if(result.ok&&result.value&&typeof result.value==='object'&&!Array.isArray(result.value)&&Object.keys(result.value).length===1&&Object.hasOwn(result.value,'state')){const value=JSON.stringify((result.value as {state:unknown}).state);if(value!==undefined&&new TextEncoder().encode(value).length<=4096)encoded=value;}
  try{await db.prepare("UPDATE app_migration_documents SET state=?,next_json=?,error=? WHERE migration_id=? AND visitor_id=? AND state='running'").bind(encoded===null?'failed':'ready',encoded,encoded===null?(result.ok?'invalid_output':result.error):null,id,doc.visitor_id).run();}catch{return readMigrationCheck(db,user,id); /* Lost write or changed roster: never rerun. */}
  if(encoded===null)return readMigrationCheck(db,user,id);
 }
 return readMigrationCheck(db,user,id);
}

/** Stop future claims/results and delete staged outputs, retaining the recovery point. */
export async function cancelMigrationCheck(db:D1Database,user:string,id:string,confirmation:unknown){
 if(confirmation!=='CANCEL')throw new BackendError(400,'Type CANCEL to discard this upgrade check');
 const before=await readMigrationCheck(db,user,id);
 if(before.state==='applied')throw new BackendError(409,'This upgrade was already applied. Prepare a separate rollback review instead');
 if(before.state==='cancelled')return before;
 try{await db.prepare('INSERT INTO app_migration_cancellations(id,user_id) VALUES(?,?)').bind(id,user).run();}
 catch{const saved=await readMigrationCheck(db,user,id);if(saved.state==='cancelled')return saved;throw new BackendError(409,'Cancellation was not confirmed. Read this exact check before trying again');}
 return readMigrationCheck(db,user,id);
}

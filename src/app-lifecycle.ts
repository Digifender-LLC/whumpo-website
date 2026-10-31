import {visitorIdentity} from './app-data';
import {BackendError} from './backend-versions';
import {hashToken} from './security';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const nowSQL="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
// A review is issued before the destructive confirmation. It never follows an
// ambient cookie to a different visitor or even a replacement session.
export async function prepareAppDeletion(db:D1Database,token:string,project:string){
 const actor=await visitorIdentity(db,token,project);
 const doc=await db.prepare('SELECT revision,state_json FROM app_documents WHERE visitor_id=?').bind(actor.visitor_id).first<{revision:number;state_json:string}>();
 if(!doc)throw new BackendError(409,'Your information changed. Review your account again');
 const id=crypto.randomUUID();
 const results=await db.batch([
  db.prepare(`DELETE FROM app_deletion_reviews WHERE session_hash=? OR expires_at<=${nowSQL}`).bind(actor.token_hash),
  db.prepare(`INSERT INTO app_deletion_reviews(id,project_id,visitor_id,session_hash,revision)
   SELECT ?,v.project_id,v.id,s.token_hash,d.revision FROM app_visitors v
   JOIN app_documents d ON d.visitor_id=v.id JOIN module_activations ac ON ac.instance_id=v.access_id JOIN module_activation_reviews ar ON ar.id=ac.review_id
   JOIN projects p ON p.id=v.project_id AND p.owner_user_id=ar.user_id
   JOIN app_sessions s ON s.visitor_id=v.id
   WHERE v.id=? AND v.project_id=? AND v.revoked=0 AND ac.state='active' AND d.revision=?
    AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes')`)
   .bind(id,actor.visitor_id,project,doc.revision,actor.token_hash)
 ]);
 if(results[1].meta.changes!==1)throw new BackendError(409,'Your information changed or your sign-in is too old. Sign in again and review the latest information');
 const review=await db.prepare('SELECT expires_at FROM app_deletion_reviews WHERE id=?').bind(id).first<{expires_at:string}>();
 if(!review)throw new BackendError(409,'Your sign-in or review changed. Review your account again');
 return {id,revision:doc.revision,state:JSON.parse(doc.state_json),expiresAt:review.expires_at};
}
function deletionProof(token:string,project:string,id:string,revision:number){
 if(!/^[0-9a-f]{64}$/.test(token))throw new BackendError(401,'Application sign-in required');
 if(!uuid.test(project)||!uuid.test(id)||!Number.isSafeInteger(revision)||revision<0)throw new BackendError(400,'Provide the deletion request and reviewed revision');
 return hashToken(JSON.stringify(['whumpo-app-deletion',token,project,id,revision]));
}
// Absence is unconfirmed, not evidence that an in-flight deletion cannot commit.
// No authentication refresh, cleanup, writes or first dispatch occurs here.
export async function readAppDeletion(db:D1Database,token:string,project:string,id:string,revision:number){
 const proof=await deletionProof(token,project,id,revision);
 const found=await db.prepare(`SELECT id FROM app_deletion_receipts WHERE id=? AND project_id=? AND proof_hash=? AND expires_at>${nowSQL}`).bind(id,project,proof).first();
 return {deleted:!!found,id};
}
export async function deleteAppAccount(db:D1Database,token:string,project:string,id:string,revision:number,confirmation:unknown){
 if(!/^[0-9a-f]{64}$/.test(token))throw new BackendError(401,'Application sign-in required');
 if(confirmation!=='DELETE')throw new BackendError(400,'Review the current information and confirm account deletion');
 const proof=await deletionProof(token,project,id,revision);
 const receipt=()=>db.prepare(`SELECT id FROM app_deletion_receipts WHERE id=? AND project_id=? AND proof_hash=? AND expires_at>${nowSQL}`).bind(id,project,proof).first();
 if(await receipt())return {deleted:true,id};
 if(await db.prepare('SELECT id FROM app_deletion_receipts WHERE id=?').bind(id).first()){if(await receipt())return {deleted:true,id};throw new BackendError(409,'Deletion request ID already used. Review your account again');}
 let actor;try{actor=await visitorIdentity(db,token,project);}catch(error){if(await receipt())return {deleted:true,id};throw error;}
 await db.prepare(`DELETE FROM app_deletion_receipts WHERE expires_at<=${nowSQL}`).run();
 try{
  const results=await db.batch([
   db.prepare(`INSERT INTO app_deletion_receipts(id,project_id,proof_hash) SELECT ?,v.project_id,? FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id JOIN module_activations ac ON ac.instance_id=v.access_id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=v.project_id AND p.owner_user_id=ar.user_id JOIN app_sessions s ON s.visitor_id=v.id JOIN app_deletion_reviews r ON r.visitor_id=v.id AND r.project_id=v.project_id AND r.session_hash=s.token_hash AND r.revision=d.revision WHERE r.id=? AND r.expires_at>${nowSQL} AND v.id=? AND v.project_id=? AND v.revoked=0 AND ac.state='active' AND d.revision=? AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes')`).bind(id,proof,id,actor.visitor_id,project,revision,actor.token_hash),
   db.prepare('DELETE FROM app_visitors WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM app_deletion_receipts WHERE id=? AND project_id=? AND proof_hash=?)').bind(actor.visitor_id,project,id,project,proof)
  ]);
  if(results[0].meta.changes!==1)throw new BackendError(409,'Your account, information or deletion review changed. Sign in again and prepare a new review');
 }catch(error){if(await receipt())return {deleted:true,id};if(error instanceof BackendError)throw error;throw new BackendError(503,'Deletion could not be confirmed. Check the saved deletion result before taking another action');}
 return {deleted:true,id};
}

// Stream bounded batches; never assemble the complete retained history in a
// Worker. Each batch rechecks the same authenticated visitor/project identity.
export async function exportAppAccount(db:D1Database,token:string,project:string){
 const actor=await visitorIdentity(db,token,project);
 const account=await db.prepare('SELECT v.id,v.created_at,d.revision,d.state_json FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id WHERE v.id=?').bind(actor.visitor_id).first<{id:string;created_at:string;revision:number;state_json:string}>();
 if(!account)throw new BackendError(404,'Application account unavailable');
 // WH-214: the visitor's own notification address (full, it is their export), whether it is verified, and the staff opt-in. Never a code or its hash.
 const notices=await db.prepare('SELECT a.address,a.verified_at,(SELECT count(*) FROM staff_notification_optins o WHERE o.visitor_id=a.visitor_id) AS opted FROM visitor_notification_addresses a WHERE a.visitor_id=?').bind(actor.visitor_id).first<{address:string;verified_at:number|null;opted:number}>();
 let cursor='',started=false,hasRows=false,finished=false;
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async pull(controller){
  try{
   if(finished)return;
   const current=await visitorIdentity(db,token,project);if(current.visitor_id!==actor.visitor_id)throw new BackendError(401,'Application account changed');
   if(!started){started=true;controller.enqueue(encoder.encode(JSON.stringify({format:'whumpo-visitor-export-v1',exportedAt:new Date().toISOString(),projectId:project,account:{id:account.id,createdAt:account.created_at},document:{revision:account.revision,value:JSON.parse(account.state_json)},notifications:notices?{address:notices.address,verified:notices.verified_at!==null,staffOptIn:notices.opted>0}:null,historyNote:'History is read in batches and may include activity completed during export. This is not a restore snapshot.'}).slice(0,-1)+',"operations":['));return;}
   const {results}=await db.prepare('SELECT id,version_id,base_revision,program_revision,state,result_json,next_json,day FROM app_runs WHERE visitor_id=? AND project_id=? AND id>? ORDER BY id LIMIT 50').bind(actor.visitor_id,project,cursor).all<{id:string;version_id:string;base_revision:number;program_revision:number;state:string;result_json:string|null;next_json:string|null;day:string}>();
   if(!results.length){finished=true;controller.enqueue(encoder.encode(']}'));controller.close();return;}
   const output=results.map(row=>({id:row.id,versionId:row.version_id,baseRevision:row.base_revision,programRevision:row.program_revision,status:row.state,day:row.day,result:row.result_json?JSON.parse(row.result_json):null,savedState:row.next_json?JSON.parse(row.next_json):null}));
   controller.enqueue(encoder.encode((hasRows?',':'')+output.map(value=>JSON.stringify(value)).join(',')));hasRows=true;cursor=results[results.length-1].id;
  }catch(error){finished=true;controller.error(error);}
 },cancel(){finished=true;}});
 return new Response(stream,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="whumpo-app-${project.slice(0,8)}.json"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin'}});
}

export async function cleanupAppLifecycle(db:D1Database){
 await db.batch([
  db.prepare("DELETE FROM app_migration_documents WHERE NOT EXISTS(SELECT 1 FROM app_migration_current c WHERE c.id=migration_id)"),
  db.prepare(`DELETE FROM app_owner_erasures WHERE expires_at<=${nowSQL}`),
  db.prepare(`DELETE FROM app_deletion_receipts WHERE expires_at<=${nowSQL}`),
  db.prepare(`DELETE FROM app_deletion_reviews WHERE expires_at<=${nowSQL}`),
  db.prepare("DELETE FROM app_daily_usage WHERE day<strftime('%Y-%m-%d','now','-35 days')")
 ]);
}

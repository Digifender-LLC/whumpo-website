import {requireReviewedReply} from './chat-review-receipts';
import {BackendError} from './backend-versions';
import {createRecoveryPoint,listRecoveryPoints,prepareAppRestore,readAppRestore,confirmAppRestore,removeRecoveryPoint} from './app-document-recovery';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Review=Awaited<ReturnType<typeof readAppRestore>>;
export function describeAppRestore(r:Review){return `Application data restore review ${r.id}\nProject: ${r.projectName} (${r.projectId})\nRecovery point: ${r.pointId}\nSaved: ${r.pointCreatedAt}\nProgram: ${r.versionId}\nStatus: ${r.status}\nReplace the saved documents of ${r.documents} currently active visitor(s) with their retained copies from this point. Changes since that point will be lost. Revoked or erased visitors are excluded and cannot be recreated. Credentials, operation history and usage totals stay unchanged. The app stays offline; reopening and publishing require separate reviews. This does not restore code or provider backups.\nExpires: ${r.expiresAt}\n${r.status==='pending'?"Only you can apply this exact review after checking it. Use its restore confirmation control.":'This review was applied. Replaying it will not replace documents again.'}`;}
export function appRecoveryCommand(db:D1Database,user:string,turn:string,content:string){
 const parts=content.trim().split(/\s+/),verb=parts[0].toLowerCase();
 if(!['/app-recovery','/save-app-recovery','/review-app-restore','/app-restore-review','/confirm-app-restore','/remove-app-recovery'].includes(verb))return;
 const length=['/app-recovery','/save-app-recovery'].includes(verb)?2:['/review-app-restore','/app-restore-review'].includes(verb)?3:4;
 if(parts.length!==length||!uuid.test(parts[1])||length>=3&&!uuid.test(parts[2])||verb==='/confirm-app-restore'&&parts[3]!=='RESTORE'||verb==='/remove-app-recovery'&&parts[3]!=='REMOVE')throw new BackendError(400,"Choose the application and saved recovery point. Apply a restore through its exact review control.");
 const [,project,target,confirmation]=parts;
 return async()=>{try{
  if(verb==='/app-recovery'){
   const points=await listRecoveryPoints(db,user,project);
   return `Application recovery points\nProject: ${project}\n`+(points.length?points.map(p=>`${p.id} · ${p.created_at} · ${p.retainedDocuments} retained document(s) · program ${p.version_id}`).join('\n'):'No saved recovery points.')+"\nAsk to save the currently committed documents as a recovery point. To restore one, first review taking the application offline, then ask for a restore review of the selected point. Every active visitor must exist in that point and its program must match.\nPermanent removal of recovery points is operator-managed. Removal cannot be undone; live documents stay unchanged, and minimal request metadata prevents duplicate creation on retry.\nRecovery points are private, contain no credentials and are not whole-app backups. Ten saved points per app are available in testing.";
  }
  if(verb==='/save-app-recovery'){const p=await createRecoveryPoint(db,user,project,turn);return p.removed?'This recovery request was already removed. It will not create another copy.':`Saved private application recovery point ${p.id}\nCreated: ${p.created_at}\nProgram: ${p.version_id}\nOnly currently active visitors’ committed documents were captured. Credentials, usage and operation history were not copied. No app state or publication changed.\nAsk to see this application’s saved recovery points.`;}
  if(verb==='/review-app-restore')return describeAppRestore(await prepareAppRestore(db,user,project,target,turn));
  if(verb==='/app-restore-review')return describeAppRestore(await readAppRestore(db,user,project,target));
  if(verb==='/confirm-app-restore')return describeAppRestore(await confirmAppRestore(db,user,project,target,confirmation,await requireReviewedReply(db,user,'appRestore',target)));
  await removeRecoveryPoint(db,user,project,target,confirmation);return `Recovery point ${target} removed. Its saved documents are gone; current visitor documents and usage are unchanged. Provider backups are outside this operation.`;
 }catch(e){return e instanceof BackendError?e.message:'Recovery result unavailable. Retry the same request; do not assume a new copy or restore succeeded.';}};
}

import {linkMaintenanceReply} from './app-maintenance-chat-actions';
import {BackendError} from './backend-versions';
import {beginMigrationCheck,advanceMigrationCheck,cancelMigrationCheck} from './app-migration-checks';
import {readMigrationReview,confirmMigration} from './app-migration-approval';
import {prepareProgramRollback,readProgramRollback,confirmProgramRollback} from './app-program-rollback';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const exclusions='Only retained visitor documents and saved application code are changed. Credentials, files, provider resources and usage are not restored. Visitors stay signed in to the project’s visitor access module but cannot use the app while it is offline. The app stays offline; reopening and publishing need separate reviews.';
export function describeUpgrade(r:Awaited<ReturnType<typeof readMigrationReview>>){
 return `Application upgrade review ${r.id}\nProject: ${r.projectName} (${r.projectId})\nStatus: ${r.state}\nDocuments: ${r.documents}; ready: ${r.ready}; pending: ${r.pending}; uncertain: ${r.running}; failed: ${r.failed}.\nChanged documents: ${r.changedDocuments} (staged so far until all checks finish).\nOriginal program: ${r.fromVersion}\nSHA-256: ${r.original.digest}\nTarget program: ${r.toVersion}\nSHA-256: ${r.target.digest}\nMigration function: ${r.transformVersion}\nSHA-256: ${r.transform.digest}\nRead the exact saved sources before approving. Test receipt: ${r.testId}.\nRecovery point before upgrade: ${r.id}\nUse this review’s cancellation control to discard an unapplied check. The recovery point is kept.\nExpires: ${r.expiresAt}\nApproval replaces the program and all reviewed visitor documents together. Passing checks do not guarantee future application behavior. ${exclusions}\n`+(r.state==='ready'?"Only you can apply this exact review using its upgrade confirmation control.":r.state==='preparing'?"Ask to check the next group of documents for this saved upgrade review.":r.state==='applied'?'Already applied. Retrying this review will not change data again.':r.state==='cancelled'?'Cancelled. Staged copies were removed; the recovery point and current app are unchanged. This request cannot restart.':r.state==='uncertain'?'An execution outcome is uncertain. Do not retry the transformation; retain the recovery point and prepare a new check after reviewing the issue.':'This check cannot be approved. Prepare a new check after resolving the changed or failed conditions.');
}
export function describeRollback(r:Awaited<ReturnType<typeof readProgramRollback>>){
 return `Application program rollback review ${r.id}\nProject: ${r.projectName} (${r.projectId})\nStatus: ${r.state}\nRestore point: ${r.pointId}, saved ${r.pointCreatedAt}\nDocuments to replace: ${r.documents}\nCurrent program: ${r.from.id}\nSHA-256: ${r.from.digest}\nSaved program: ${r.to.id}\nSHA-256: ${r.to.digest}\nRead the exact saved sources before approving.\nBefore-copy preserved as: ${r.beforePointId}\nExpires: ${r.expiresAt}\nChanges since the selected point will be replaced. Erased or missing visitors are never recreated. ${exclusions}\n`+(r.state==='ready'?"Only you can apply this exact review using its rollback confirmation control.":r.state==='applied'?'Already applied. Retrying this review will not change data again.':'This review is no longer available for approval. Prepare a new review.');
}
export function appUpgradeCommand(db:D1Database,user:string,turn:string,content:string,service?:Fetcher){
 const parts=content.trim().split(/\s+/),verb=parts[0].toLowerCase();
 const lengths:Record<string,number>={'/review-app-upgrade':5,'/check-app-upgrade':2,'/app-upgrade':2,'/confirm-app-upgrade':3,'/cancel-app-upgrade':3,'/review-app-rollback':3,'/app-rollback':2,'/confirm-app-rollback':3};
 if(!Object.hasOwn(lengths,verb))return;
 const confirming=verb.startsWith('/confirm-')||verb==='/cancel-app-upgrade',ids=parts.slice(1,confirming?-1:undefined);
 if(parts.length!==lengths[verb]||!ids.every(v=>uuid.test(v))||confirming&&parts[2]!== (verb==='/cancel-app-upgrade'?'CANCEL':verb==='/confirm-app-upgrade'?'UPGRADE':'ROLLBACK'))throw new BackendError(400,"Choose the exact saved review and use its matching upgrade, rollback or cancellation control.");
 return async()=>{const reply=await(async()=>{try{
  if(verb==='/cancel-app-upgrade'){await cancelMigrationCheck(db,user,parts[1],parts[2]);return describeUpgrade(await readMigrationReview(db,user,parts[1]));}
  if(verb==='/review-app-upgrade'){await beginMigrationCheck(db,user,parts[1],turn,parts[2],parts[3],parts[4]);return describeUpgrade(await readMigrationReview(db,user,turn));}
  if(verb==='/check-app-upgrade'){if(!service)throw new BackendError(503,'Application runtime is unavailable. No migration check was run.');await advanceMigrationCheck(db,service,user,parts[1]);return describeUpgrade(await readMigrationReview(db,user,parts[1]));}
  if(verb==='/app-upgrade')return describeUpgrade(await readMigrationReview(db,user,parts[1]));
  if(verb==='/confirm-app-upgrade')return describeUpgrade(await confirmMigration(db,user,parts[1],parts[2]));
  if(verb==='/review-app-rollback')return describeRollback(await prepareProgramRollback(db,user,parts[1],parts[2],turn));
  if(verb==='/app-rollback')return describeRollback(await readProgramRollback(db,user,parts[1]));
  return describeRollback(await confirmProgramRollback(db,user,parts[1],parts[2]));
 }catch(e){return e instanceof BackendError?e.message:'Application maintenance result unavailable. Retry the same request to recover its receipt; do not assume a change succeeded.';}})();
 const kind=verb.includes('rollback')?'rollback':'upgrade',id=verb.startsWith('/review-')?turn:parts[1];
 await linkMaintenanceReply(db,user,turn,kind,id,reply);return reply;};
}
/** The model can prepare/check/read only. Confirmation is absent from this allowlist. */
export function appUpgradeAction(db:D1Database,user:string,turn:string,action:Record<string,unknown>,service?:Fetcher){
 const specs:Record<string,{verb:string;fields:string[]}>={reviewAppUpgrade:{verb:'review-app-upgrade',fields:['projectId','versionId','transformId','testId']},checkAppUpgrade:{verb:'check-app-upgrade',fields:['reviewId']},appUpgrade:{verb:'app-upgrade',fields:['reviewId']},reviewAppRollback:{verb:'review-app-rollback',fields:['projectId','pointId']},appRollback:{verb:'app-rollback',fields:['reviewId']}};
 const spec=typeof action.operation==='string'&&Object.hasOwn(specs,action.operation)?specs[action.operation]:undefined;if(!spec)return;
 if(Object.keys(action).some(k=>!['kind','operation',...spec.fields].includes(k))||spec.fields.some(k=>typeof action[k]!=='string'||!uuid.test(action[k] as string)))throw new BackendError(400,'Choose saved application maintenance identifiers only');
 return appUpgradeCommand(db,user,turn,'/'+spec.verb+' '+spec.fields.map(k=>action[k]).join(' '),service);
}

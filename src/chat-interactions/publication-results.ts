import {assertFeature,featurePredicate} from '../feature-admission';
import {FeatureInclusionError} from '../feature-inclusion';
import {BackendError} from '../backend-error';
import {compareReview,DiffError} from '../version-diff';
import {interactionGuard} from './store';

type Candidate={reviewId:string;kind:'publish'|'restore'|'unpublish';versionId:string|null;expectedRevision:number;expiresAt:string;status:'pending'|'applied';receiptId:string|null;expired:number};
export type PublicationTaskResult={reviewId:string;kind:Candidate['kind'];versionId:string|null}&(
 {state:'pending';expectedRevision:number;expiresAt:string}|
 {state:'applied';receiptId:string;resultRevision:number}|
 {state:'expired'|'changed'|'held'|'unavailable'});

export async function publicationTaskCandidates(db:D1Database,user:string,taskId:string,projectId:string){
 return (await db.prepare(`SELECT a.id reviewId,a.kind,a.version_id versionId,a.expected_revision expectedRevision,a.expires_at expiresAt,a.status,a.confirmed_by receiptId,
  CASE WHEN a.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END expired
  FROM chat_task_progress step JOIN chat_turns t ON t.id=step.turn_id AND t.user_id=step.user_id AND t.status='completed'
  JOIN publication_chat_links l ON l.turn_id=t.id JOIN publication_actions a ON a.id=l.review_id AND a.user_id=t.user_id
  JOIN projects p ON p.id=a.project_id AND p.owner_user_id=t.user_id
  WHERE step.task_id=? AND step.user_id=? AND p.id=? GROUP BY a.id ORDER BY max(t.revision) DESC,a.id DESC LIMIT 3`)
  .bind(taskId,user,projectId).all<Candidate>()).results;
}

/** Task-owned receipts and current publication facts have different meanings.
 * Neither a stored application receipt nor a saved version proves HTTP availability. */
export async function readPublicationTaskResults(db:D1Database,user:string,taskId:string,projectId:string){
 const gate={userId:user,projectId,featureId:'core.publication' as const,operation:'read' as const};
 const observedAt=new Date().toISOString();
 try{await assertFeature(db,gate);}catch(e){if(e instanceof FeatureInclusionError)return {state:'denied' as const,observedAt,canPrepare:false,current:null,versions:[],items:[]};throw e;}
 let canPrepare=true;
 try{await assertFeature(db,{...gate,operation:'prepare'});}catch(e){if(!(e instanceof FeatureInclusionError))throw e;canPrepare=false;}
 const current=await db.prepare('SELECT s.revision,s.version_id versionId,h.version_id privateVersionId FROM projects p LEFT JOIN publications s ON s.project_id=p.id LEFT JOIN project_spec_heads h ON h.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(projectId,user).first<{revision:number|null;versionId:string|null;privateVersionId:string|null}>();
 const {results:versions}=await db.prepare('SELECT v.id versionId,v.created_at savedAt,s.revision privateRevision FROM site_versions v JOIN projects p ON p.id=v.project_id JOIN project_spec_versions s ON s.version_id=v.id AND s.project_id=p.id WHERE p.id=? AND p.owner_user_id=? ORDER BY s.revision DESC LIMIT 25').bind(projectId,user).all<{versionId:string;savedAt:string;privateRevision:number}>();
 const items:PublicationTaskResult[]=[];
 for(const c of await publicationTaskCandidates(db,user,taskId,projectId)){
  const identity={reviewId:c.reviewId,kind:c.kind,versionId:c.versionId};
  if(c.status==='applied'&&c.receiptId){items.push({...identity,state:'applied',receiptId:c.receiptId,resultRevision:c.expectedRevision+1});continue;}
  if(c.expired){items.push({...identity,state:'expired'});continue;}
  try{
   const diff=await compareReview(db,user,c.reviewId);
   if(diff.project.id!==projectId)throw new DiffError(404,'Review unavailable.');
   items.push({...identity,state:'pending',expectedRevision:c.expectedRevision,expiresAt:c.expiresAt});
  }catch(e){
   if(!(e instanceof DiffError)&&!(e instanceof BackendError))throw e;
   items.push({...identity,state:e.status===423?'held':e.status===409?'changed':'unavailable'});
  }
 }
 await assertFeature(db,gate);
 return {state:'ready' as const,observedAt,canPrepare,current,versions,items};
}

/** Fence facts supplied to inference at dispatch and result commit. Permission
 * loss may not turn already-read private facts into a saved model reply. */
export function publicationTaskGuards(db:D1Database,user:string,projectId:string,data:Awaited<ReturnType<typeof readPublicationTaskResults>>){
 if(data.state!=='ready')return [];
 return (data.canPrepare?['read','prepare'] as const:['read'] as const).map(operation=>{
  const gate=featurePredicate(db,{userId:user,projectId,featureId:'core.publication',operation});
  return interactionGuard(db,gate.sql,gate.params);
 });
}

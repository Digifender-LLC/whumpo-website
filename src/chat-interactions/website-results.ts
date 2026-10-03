import {BackendError} from '../backend-error';
import {readSpecificationProposal} from '../project-specification/store';

type Candidate={reviewId:string;expired:number;
 receiptId:string|null;versionId:string|null;savedRevision:number|null;savedAt:string|null};
export type WebsiteTaskResult={reviewId:string}&(
 {state:'pending';proposalDigest:string;expectedRevision:number;expiresAt:string}|
 {state:'saved';receiptId:string;versionId:string;revision:number;savedAt:string}|
 {state:'expired'|'changed'|'held'|'unavailable'});

/** Task-owned origins and exact review links, never project-wide discovery.
 * Apply receipts outlive disposable proposal bytes and their presentation links. */
export async function websiteTaskCandidates(db:D1Database,user:string,taskId:string,projectId:string){
 const {results}=await db.prepare(`WITH turns AS (
  SELECT step.turn_id,c.revision FROM chat_task_progress step
  JOIN chat_turns c ON c.id=step.turn_id AND c.user_id=step.user_id AND c.status='completed'
  WHERE step.task_id=? AND step.user_id=?
 ), candidates AS (
  SELECT l.proposal_id review_id,t.revision FROM turns t JOIN project_spec_chat_links l ON l.turn_id=t.turn_id
  UNION ALL SELECT a.proposal_id,t.revision FROM turns t JOIN project_spec_applies a ON a.proposal_id=t.turn_id AND a.user_id=?
 ) SELECT x.review_id reviewId,
  CASE WHEN q.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END expired,
  a.id receiptId,a.version_id versionId,a.revision savedRevision,a.created_at savedAt
 FROM candidates x LEFT JOIN project_spec_proposals q ON q.id=x.review_id AND q.user_id=? AND q.project_id=?
 LEFT JOIN project_spec_applies a ON a.proposal_id=x.review_id AND a.user_id=? AND a.project_id=?
 JOIN projects p ON p.id=? AND p.owner_user_id=?
 WHERE q.id IS NOT NULL OR a.id IS NOT NULL
 GROUP BY x.review_id ORDER BY max(x.revision) DESC,x.review_id DESC LIMIT 3`)
 .bind(taskId,user,user,user,projectId,user,projectId,projectId,user).all<Candidate>();
 return results;
}

/** Existing validators decide whether a review can actually be reopened.
 * A saved receipt proves a private save, never current publication or availability. */
export async function readWebsiteTaskResults(db:D1Database,user:string,taskId:string,projectId:string){
 const candidates=await websiteTaskCandidates(db,user,taskId,projectId),items:WebsiteTaskResult[]=[];
 for(const c of candidates){
  if(c.receiptId&&c.versionId&&c.savedRevision!==null&&c.savedAt){
   items.push({reviewId:c.reviewId,state:'saved',receiptId:c.receiptId,versionId:c.versionId,revision:c.savedRevision,savedAt:c.savedAt});continue;
  }
  if(c.expired){items.push({reviewId:c.reviewId,state:'expired'});continue;}
  try{
   const q=await readSpecificationProposal(db,user,c.reviewId);
   if(q.project_id!==projectId)throw new BackendError(404,'Review unavailable.');
   items.push({reviewId:q.id,state:'pending',proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision,expiresAt:q.expires_at});
  }catch(error){
   if(!(error instanceof BackendError))throw error;
   items.push({reviewId:c.reviewId,state:error.status===409?'changed':error.status===423?'held':'unavailable'});
  }
 }
 return {observedAt:new Date().toISOString(),items};
}

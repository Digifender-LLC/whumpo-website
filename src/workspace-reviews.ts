import {assertFeature} from './feature-admission';
import {FeatureInclusionError} from './feature-inclusion';
import {specificationReviewDetails} from './project-specification/store';
import type {WorkspaceReviewQueue} from './workspace-view-data';
export type {WorkspaceReviewQueue} from './workspace-view-data';

/** Bounded discovery only. Every candidate uses the existing exact comparison
 * validator; the queue cannot turn a saved proposal into approval authority. */
export async function readWorkspaceReviews(db:D1Database,user:string,projectId:string|null):Promise<WorkspaceReviewQueue>{
 const candidates=await db.prepare(`SELECT q.id FROM project_spec_proposals q
  JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  JOIN chat_turns t ON t.id=q.id AND t.user_id=q.user_id
  WHERE q.user_id=? AND (? IS NULL OR q.project_id=?) AND q.operation IN ('change','restore')
  AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND NOT EXISTS(SELECT 1 FROM project_spec_applies a WHERE a.proposal_id=q.id)
  ORDER BY t.revision DESC,q.id DESC LIMIT 5`).bind(user,projectId,projectId).all<{id:string}>();
 const result:WorkspaceReviewQueue={items:[],denied:0,unavailable:0};
 for(const candidate of candidates.results){
  try{
   const detail=await specificationReviewDetails(db,user,candidate.id);
   if(projectId!==null&&detail.project.id!==projectId)throw Error('Review scope changed');
   result.items.push({review:detail.review,project:detail.project,operation:detail.operation,expiresAt:detail.expiresAt});
  }catch(error){if(error instanceof FeatureInclusionError)result.denied++;else result.unavailable++;}
 }
 return result;
}
/** Recheck each project after the enclosing page/interaction check as well. */
export async function filterWorkspaceReviewAccess(db:D1Database,user:string,queue:WorkspaceReviewQueue){
 const result:WorkspaceReviewQueue={items:[],denied:queue.denied,unavailable:queue.unavailable};
 for(const item of queue.items){
  try{
   await assertFeature(db,{userId:user,projectId:item.project.id,featureId:'core.editing',operation:'read'});
   if(item.expiresAt<=new Date().toISOString()){result.unavailable++;continue;}
   result.items.push(item);
  }catch(error){if(error instanceof FeatureInclusionError)result.denied++;else result.unavailable++;}
 }
 return result;
}

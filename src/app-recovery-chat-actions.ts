import {readChatReviewReceipts} from './chat-review-receipts';
import {describeAppRestore} from './app-recovery-chat';
import type {AppRestorePresentation} from './app-restore-review-shape';
type Turn=Record<string,unknown>;
type Row={id:string;project_id:string;point_id:string;status:string;expires_at:string;point_created_at:string;version_id:string;project_name:string;documents:number;unexpired:number;eligible:number};
/** Never derive restore authority from model prose or a historical transcript alone. */
export async function appRecoveryChatActions(db:D1Database,user:string,turns:Turn[],receipts?:Awaited<ReturnType<typeof readChatReviewReceipts>>){
 receipts??=await readChatReviewReceipts(db,user,turns);
 for(const turn of turns)delete turn.app_restore_review;
 const candidates=turns.slice(0,100).filter(t=>t.status==='completed'&&typeof t.assistant_text==='string'&&t.assistant_text.startsWith('Application data restore review ')).map(turn=>{
  const saved=receipts!.get(String(turn.id)),linked=saved?.kind==='appRestore'?saved.review_id:undefined;
  return {turn,id:linked};
 }).filter((c):c is {turn:Turn;id:string}=>typeof c.id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(c.id));
 const ids=[...new Set(candidates.map(c=>c.id))];
 for(let offset=0;offset<ids.length;offset+=50){
  const batch=ids.slice(offset,offset+50);
  const {results}=await db.prepare(`SELECT r.id,r.project_id,r.point_id,r.status,r.expires_at,p.created_at point_created_at,p.version_id,project.name project_name,json_array_length(r.roster_json) documents,r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') unexpired,
  a.enabled=0 AND a.revision=r.base_revision AND a.version_id=p.version_id AND p.removed=0 AND p.sealed=1 AND roster.roster_json=r.roster_json AND NOT EXISTS(SELECT 1 FROM json_each(r.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=r.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor'))) eligible
  FROM app_restore_reviews r JOIN app_recovery_points p ON p.id=r.point_id AND p.user_id=r.user_id AND p.project_id=r.project_id JOIN projects project ON project.id=r.project_id AND project.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN app_recovery_rosters roster ON roster.project_id=r.project_id
  WHERE r.user_id=? AND r.restore_program=0 AND r.id IN (${batch.map(()=>'?').join(',')})`).bind(user,...batch).all<Row>();
  for(const r of results){
   const review={id:r.id,projectId:r.project_id,pointId:r.point_id,status:r.status,documents:r.documents,expiresAt:r.expires_at,pointCreatedAt:r.point_created_at,versionId:r.version_id,projectName:r.project_name};
   const description=describeAppRestore(review),historical=r.status==='applied'?describeAppRestore({...review,status:'pending'}):undefined;
   const state:AppRestorePresentation['state']=r.status==='applied'?'applied':!r.unexpired?'expired':!r.eligible?'changed':'ready';
   for(const c of candidates)if(c.id===r.id&&(c.turn.assistant_text===description||historical!==undefined&&c.turn.assistant_text===historical)){
    const {status,...metadata}=review;c.turn.app_restore_review={...metadata,state} satisfies AppRestorePresentation;
   }
  }
 }
}

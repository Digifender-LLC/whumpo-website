import {assertFeature,featurePredicate} from '../feature-admission';
import {FeatureInclusionError} from '../feature-inclusion';
import {photoSafetySQL} from '../photo-safety';
import {interactionGuard} from './store';

type PhotoResult={id:string;name:string;width:number;height:number;status:'pending'|'ready';safetyStatus:'pending'|'approved'|'blocked'};
/** Only files explicitly linked to an uploader issued by this task. Direct
 * uploads and other tasks' files are not implicitly selected for inference. */
const taskFiles=`FROM project_files f JOIN projects p ON p.id=f.project_id AND p.owner_user_id=?
 WHERE f.project_id=? AND EXISTS(
  SELECT 1 FROM chat_interactions i JOIN chat_turns t ON t.id=i.origin_turn_id AND t.user_id=i.user_id AND t.status='completed'
  JOIN chat_task_progress step ON step.turn_id=t.id AND step.user_id=t.user_id
  WHERE i.id=json_extract(f.handoff_json,'$.interactionId') AND i.definition_digest=json_extract(f.handoff_json,'$.definitionDigest')
   AND i.user_id=p.owner_user_id AND i.project_id=f.project_id AND step.task_id=?)`;

export async function readPhotoTaskResults(db:D1Database,user:string,taskId:string,projectId:string){
 const gate={userId:user,projectId,featureId:'core.editing' as const,operation:'read' as const},observedAt=new Date().toISOString();
 try{await assertFeature(db,gate);}catch(e){if(e instanceof FeatureInclusionError)return {state:'denied' as const,observedAt,items:[] as PhotoResult[]};throw e;}
 const {results:items}=await db.prepare(`SELECT f.id,f.name,f.width,f.height,f.status,${photoSafetySQL} safetyStatus ${taskFiles} ORDER BY f.created_at DESC,f.id DESC LIMIT 20`).bind(user,projectId,taskId).all<PhotoResult>();
 await assertFeature(db,gate);
 return {state:'ready' as const,observedAt,items};
}

/** File removal or clearance changes during inference invalidate its result.
 * These metadata observations never authorize displaying bytes or using a file. */
export function photoTaskGuards(db:D1Database,user:string,taskId:string,projectId:string,data:Awaited<ReturnType<typeof readPhotoTaskResults>>){
 if(data.state!=='ready')return [];
 const gate=featurePredicate(db,{userId:user,projectId,featureId:'core.editing',operation:'read'});
 return [interactionGuard(db,gate.sql,gate.params),...data.items.map(photo=>interactionGuard(db,`EXISTS(SELECT 1 ${taskFiles} AND f.id=? AND f.status=? AND (${photoSafetySQL})=?)`,[user,projectId,taskId,photo.id,photo.status,photo.safetyStatus]))];
}

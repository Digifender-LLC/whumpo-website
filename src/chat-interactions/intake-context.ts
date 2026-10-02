import {assertWorkspace} from '../workspace-identity/admission';
import {assertFeature} from '../feature-admission';
import {isProjectIntakeTemplate,projectIntakeTemplates,type ProjectIntakeTemplate} from './maintained';
import {validateAnswers} from './protocol';
import {readInteraction,InteractionStoreError} from './store';

/** Bounded locators only. Values require an explicit submitted-answer inspection. */
export async function intakeReferences(db:D1Database,user:string){
 await assertWorkspace(db,user);
 const {results}=await db.prepare(`SELECT i.id interactionId,i.task_id taskId,s.id submissionId,json_extract(i.envelope_json,'$.definition.template') template
  FROM chat_interactions i JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
  WHERE i.user_id=? AND i.project_id IS NULL AND i.state='submitted' AND i.removed_at IS NULL
   AND json_extract(i.envelope_json,'$.definition.template') IN (${projectIntakeTemplates.map(()=>'?').join(',')})
   AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id)
  ORDER BY s.created_at DESC,s.id DESC LIMIT 5`).bind(user,...projectIntakeTemplates).all<{interactionId:string;taskId:string;submissionId:string;template:ProjectIntakeTemplate}>();
 await assertWorkspace(db,user);return results;
}
/** Called only by the bounded owner-maintenance loop, after the user submitted
 * answers for planning. Never reads drafts/defaults or another task's snapshot. */
export async function readSubmittedIntake(db:D1Database,user:string,turnId:string,input:{interactionId:string;taskId:string;submissionId:string}){
 const gate={userId:user,projectId:null,featureId:'core.editing' as const,operation:'prepare' as const};
 await assertFeature(db,gate);
 const f=await readInteraction(db,user,input.interactionId),e=f.envelope,s=f.submission;
 if(e.scope.taskId!==input.taskId||!s||s.id!==input.submissionId||f.state!=='submitted'||f.replacementInteractionId||e.scope.projectId!==null||!isProjectIntakeTemplate(e.definition.template)||s.continuation!==null)throw new InteractionStoreError(409,'adapter_unavailable');
 const a=validateAnswers(e.definition,s.answers);
 const selected=e.definition.template==='project-select@1'?await db.prepare('SELECT id,name FROM projects WHERE id=? AND owner_user_id=?').bind(a.project,user).first<{id:string;name:string}>():null;
 if(e.definition.template==='project-select@1'&&!selected)throw new InteractionStoreError(404,'not_found');
 await assertFeature(db,gate);
 if(!await db.prepare("SELECT id FROM chat_turns WHERE id=? AND user_id=? AND mode='ai' AND status='pending'").bind(turnId,user).first())throw new InteractionStoreError(409,'interaction_changed');
 return {interactionId:e.id,taskId:e.scope.taskId,submissionId:s.id,template:e.definition.template,
  ...(e.definition.template==='project-brief@1'?{answers:{name:a.name,purpose:a.purpose}}:e.definition.template==='choice@1'?{answers:{tone:a.tone}}:{selectedProject:{id:selected!.id,name:selected!.name}})};
}

import {assertWorkspace} from '../workspace-identity/admission';
import {assertFeature} from '../feature-admission';
import {copyJSON} from '../project-specification/v2/json';
import {isProjectIntakeTemplate,projectIntakeTemplates} from './maintained';
import {isInformationDefinition} from './composition';
import {InteractionError,validateAnswers} from './protocol';
import {readInteraction,InteractionStoreError} from './store';

/** Bounded locators only. Values require an explicit submitted-answer inspection. */
export async function submittedReferences(db:D1Database,user:string){
 await assertWorkspace(db,user);
 const {results}=await db.prepare(`SELECT i.id FROM chat_interactions i
  JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
  WHERE i.user_id=? AND i.state='submitted' AND i.removed_at IS NULL
   AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id))
   AND json_extract(i.envelope_json,'$.definition.template') IN (${[...projectIntakeTemplates,'custom@1'].map(()=>'?').join(',')})
   AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id)
  ORDER BY s.created_at DESC,s.id DESC LIMIT 5`).bind(user,...projectIntakeTemplates,'custom@1').all<{id:string}>();
 const references=[];
 for(const r of results){
  let f;try{f=await readInteraction(db,user,r.id);}catch(error){if(error instanceof InteractionStoreError&&[404,409,410].includes(error.status))continue;throw error;}
  const e=f.envelope;
  if(f.state!=='submitted'||!f.submission||f.replacementInteractionId||(f.submission.continuation!==null&&e.definition.continuationBinding!=='agent.task-continue@1')||!(isProjectIntakeTemplate(e.definition.template)&&e.scope.projectId===null||isInformationDefinition(e.definition)&&e.scope.projectId!==null))continue;
  references.push({interactionId:e.id,taskId:e.scope.taskId,projectId:e.scope.projectId,submissionId:f.submission.id,template:e.definition.template,...(e.definition.purpose?{purpose:e.definition.purpose}:{}),fields:e.definition.fields.map(field=>({id:field.id,...(field.questionId?{questionId:field.questionId}:{})}))});
 }
 await assertWorkspace(db,user);return references;
}
export type SubmittedAnswerRequest={interactionId:string;taskId:string;projectId:string|null;submissionId:string;fieldIds:string[]};
/** One current reader for maintained and composed information forms. Explicit
 * selected fields only; never drafts/defaults, HTML, or approval instructions. */
export async function readSubmittedAnswers(db:D1Database,user:string,turnId:string,input:SubmittedAnswerRequest){
 await assertWorkspace(db,user);const request=copyJSON(input,4096);
 if(!request||Object.keys(request).sort().join(',')!=='fieldIds,interactionId,projectId,submissionId,taskId'||!Array.isArray(request.fieldIds)||!request.fieldIds.length||request.fieldIds.length>12||new Set(request.fieldIds).size!==request.fieldIds.length||request.fieldIds.some(v=>typeof v!=='string'))throw new InteractionError('SHAPE');
 const f=await readInteraction(db,user,request.interactionId),e=f.envelope,s=f.submission;
 if(e.scope.taskId!==request.taskId||e.scope.projectId!==request.projectId||!s||s.id!==request.submissionId||f.state!=='submitted'||f.replacementInteractionId||(s.continuation!==null&&e.definition.continuationBinding!=='agent.task-continue@1')||!(isProjectIntakeTemplate(e.definition.template)&&e.scope.projectId===null||isInformationDefinition(e.definition)&&e.scope.projectId!==null))throw new InteractionStoreError(409,'adapter_unavailable');
 const gate={userId:user,projectId:e.scope.projectId,featureId:'core.editing' as const,operation:'prepare' as const};
 await assertFeature(db,gate);
 const a=validateAnswers(e.definition,s.answers);
 if(request.fieldIds.some(id=>!e.definition.fields.some(f=>f.id===id)||!Object.hasOwn(a,id)))throw new InteractionError('FIELD_UNAVAILABLE');
 const selected=e.definition.template==='project-select@1'?await db.prepare('SELECT id,name FROM projects WHERE id=? AND owner_user_id=?').bind(a.project,user).first<{id:string;name:string}>():null;
 if(e.definition.template==='project-select@1'&&!selected)throw new InteractionStoreError(404,'not_found');
 const final=await readInteraction(db,user,e.id);
 if(final.state!=='submitted'||final.replacementInteractionId||final.answerRevision!==f.answerRevision||final.submission?.id!==s.id)throw new InteractionStoreError(409,'interaction_changed');
 if(selected&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=? AND name=?').bind(selected.id,user,selected.name).first())throw new InteractionStoreError(404,'not_found');
 await assertFeature(db,gate);
 if(!await db.prepare("SELECT id FROM chat_turns WHERE id=? AND user_id=? AND mode='ai' AND status='pending'").bind(turnId,user).first())throw new InteractionStoreError(409,'interaction_changed');
 return {interactionId:e.id,taskId:e.scope.taskId,projectId:e.scope.projectId,submissionId:s.id,template:e.definition.template,...(e.definition.purpose?{purpose:e.definition.purpose}:{}),
  ...(selected?{selectedProject:{id:selected.id,name:selected.name}}:{answers:Object.fromEntries(request.fieldIds.map(id=>[id,a[id]]))})};
}

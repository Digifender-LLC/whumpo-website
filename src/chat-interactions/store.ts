import {assertWorkspace} from '../workspace-identity/admission';
import {featurePredicate,assertFeature} from '../feature-admission';
import {canonicalJSON,jsonDigest,copyJSON} from '../project-specification/v2/json';
import {readSpecification} from '../project-specification/store';
import type {ProjectSpecification} from '../project-specification/v2/types';
import {InteractionError,contentFieldLimit,sealDefinition,verifyEnvelope,validateMutation,mutationHeader,validateAnswers} from './protocol';
import type {Answers,Continuation,Definition,Field,InteractionRead,InteractionReceipt} from './types';
import {draftRetentionDue} from './retention';

export class InteractionStoreError extends Error {
 constructor(readonly status:number,readonly code:string){super(code==='not_found'?'Chat form not found.':code==='draft_removed'?'This unsubmitted form was discarded or reached its draft retention limit. Ask for a new form.':code==='request_conflict'?'This request ID already describes another answer.':'This Chat form changed. Read its current state before continuing.');}
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const identifier=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const changed=()=>new InteractionStoreError(409,'interaction_changed');
const unavailable=()=>new InteractionStoreError(404,'not_found');
const feature=(userId:string,projectId:string|null)=>({userId,projectId,featureId:'core.editing' as const,operation:'prepare' as const});
type Row={id:string;user_id:string;project_id:string|null;previous_interaction_id:string|null;envelope_json:string|null;definition_digest:string;issue_hash:string;created_at:string;expires_at:string;state:'open'|'submitted'|'canceled'|'superseded';answer_revision:number;draft_json:string;draft_saved_at:string|null;removed_at:string|null;removal_reason:string|null;draft_due:number};
type Receipt={request_id:string;interaction_id:string;request_hash:string;operation:'save-draft'|'submit'|'cancel';answer_revision:number;created_at:string};
const ownership="(i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id))";
export function interactionGuard(db:D1Database,sql:string,params:unknown[]=[]){
 return db.prepare(`INSERT INTO chat_interaction_checks(denied) SELECT 1 WHERE NOT (${sql})`).bind(...params);
}
async function row(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!identifier(id))throw new InteractionError('ID');
 const r=await db.prepare(`SELECT i.*,(${draftRetentionDue}) draft_due FROM chat_interactions i WHERE i.id=? AND i.user_id=? AND ${ownership}`).bind(id,user).first<Row>();
 if(!r)throw unavailable();return r;
}
function retainedEnvelope(r:Row){if(r.removed_at||r.draft_due||!r.envelope_json)throw new InteractionStoreError(410,'draft_removed');return verifyEnvelope(JSON.parse(r.envelope_json));}
async function receipt(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!identifier(id))throw new InteractionError('ID');
 return db.prepare(`SELECT r.request_id,r.interaction_id,r.request_hash,r.operation,r.answer_revision,r.created_at FROM chat_interaction_requests r JOIN chat_interactions i ON i.id=r.interaction_id AND i.user_id=r.user_id WHERE r.user_id=? AND r.request_id=? AND ${ownership}`).bind(user,id).first<Receipt>();
}
export async function readInteraction(db:D1Database,user:string,id:string):Promise<InteractionRead>{
 const r=await row(db,user,id),envelope=await retainedEnvelope(r);
 const submission=await db.prepare('SELECT s.id,s.answers_json,s.answers_digest,s.answer_revision,s.created_at,c.state continuation_state,c.result_turn_id,c.reason FROM chat_interaction_submissions s JOIN chat_interaction_continuations c ON c.id=s.id WHERE s.interaction_id=? AND s.user_id=?').bind(id,user).first<{id:string;answers_json:string;answers_digest:string;answer_revision:number;created_at:string;continuation_state:Continuation['state'];result_turn_id:string|null;reason:string|null}>();
 if(r.state==='submitted'&&!submission)throw new InteractionStoreError(503,'receipt_unavailable');
 if(submission&&await jsonDigest(JSON.parse(submission.answers_json),16384)!==submission.answers_digest)throw new InteractionStoreError(503,'receipt_unavailable');
 const clock=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now").first<{now:string}>();
 // Recheck authority/ownership and the revision after the bounded multi-query read.
 const replacement=await db.prepare('SELECT id FROM chat_interactions WHERE previous_interaction_id=? AND user_id=?').bind(id,user).first<{id:string}>();
 const current=await row(db,user,id);await retainedEnvelope(current);if(current.answer_revision!==r.answer_revision)throw changed();
 return {version:1 as const,envelope,previousInteractionId:r.previous_interaction_id,replacementInteractionId:replacement?.id??null,state:r.state==='open'&&r.expires_at<=clock!.now?'expired' as const:r.state,answerRevision:r.answer_revision,draft:JSON.parse(r.draft_json) as Answers,
  observedAt:clock!.now,draftRetainUntil:r.state==='submitted'?null:new Date(Date.parse(r.draft_saved_at??r.created_at)+7*24*60*60*1000).toISOString(),
  submission:submission?{id:submission.id,answers:JSON.parse(submission.answers_json) as Answers,answersDigest:submission.answers_digest,answerRevision:submission.answer_revision,createdAt:submission.created_at,
   continuation:{id:submission.id,state:submission.continuation_state,resultTurnId:submission.result_turn_id,reason:submission.reason}}:null};
}
export async function readInteractionReceipt(db:D1Database,user:string,requestId:string):Promise<InteractionReceipt>{
 const r=await receipt(db,user,requestId);if(!r)throw unavailable();
 return {version:1 as const,requestId:r.request_id,requestDigest:r.request_hash,interactionId:r.interaction_id,operation:r.operation,answerRevision:r.answer_revision,createdAt:r.created_at};
}

type InteractionListRequest={version:1;projectId:string|null;limit:number;before:{createdAt:string;interactionId:string}|null};
/** A bounded resume index, not a cached form or dispatch instruction. Each chosen
 * interaction still requires a current scoped read and client-capability check. */
export async function listInteractions(db:D1Database,user:string,input:unknown){
 await assertWorkspace(db,user);const request=copyJSON(input,4096) as InteractionListRequest;
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).sort().join(',')!=='before,limit,projectId,version')throw new InteractionError('SHAPE');
 if(request.version!==1)throw new InteractionError('VERSION');
 if((request.projectId!==null&&!identifier(request.projectId))||!Number.isSafeInteger(request.limit)||request.limit<1||request.limit>20)throw new InteractionError('SHAPE');
 const before=request.before;
 if(before!==null&&(!before||typeof before!=='object'||Array.isArray(before)||Object.keys(before).sort().join(',')!=='createdAt,interactionId'||!identifier(before.interactionId)||typeof before.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before.createdAt)||!Number.isFinite(Date.parse(before.createdAt))||new Date(before.createdAt).toISOString()!==before.createdAt))throw new InteractionError('SHAPE');
 if(request.projectId&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(request.projectId,user).first())throw unavailable();
 const {results}=await db.prepare(`SELECT i.id,i.project_id,i.task_id,t.revision task_revision,i.origin_turn_id,i.created_at,i.expires_at,i.state,i.answer_revision,i.draft_saved_at,s.id submission_id,c.state continuation_state,c.reason
  FROM chat_interactions i JOIN chat_interaction_tasks t ON t.id=i.task_id AND t.user_id=i.user_id
  LEFT JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
  LEFT JOIN chat_interaction_continuations c ON c.id=s.id
  WHERE i.user_id=? AND ${ownership} AND i.removed_at IS NULL AND NOT (${draftRetentionDue}) AND (? IS NULL OR i.project_id=?)
   AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id)
   AND ((i.state='open' AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    OR c.state IN ('pending','unknown') OR (i.state='submitted' AND c.state='not-started' AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
   AND (? IS NULL OR i.created_at<? OR (i.created_at=? AND i.id<?))
  ORDER BY i.created_at DESC,i.id DESC LIMIT ?`).bind(user,request.projectId,request.projectId,before?.createdAt??null,before?.createdAt??null,before?.createdAt??null,before?.interactionId??null,request.limit+1).all<{id:string;project_id:string|null;task_id:string;task_revision:number;origin_turn_id:string;created_at:string;expires_at:string;state:string;answer_revision:number;draft_saved_at:string|null;submission_id:string|null;continuation_state:string|null;reason:string|null}>();
 const page=results.slice(0,request.limit),last=page.at(-1);
 await assertWorkspace(db,user);
 return {version:1 as const,items:page.map(r=>({interactionId:r.id,projectId:r.project_id,task:{id:r.task_id,revision:r.task_revision},originTurnId:r.origin_turn_id,createdAt:r.created_at,expiresAt:r.expires_at,state:r.state,answerRevision:r.answer_revision,hasDraft:r.draft_saved_at!==null,
  continuation:r.submission_id?{id:r.submission_id,state:r.continuation_state,reason:r.reason}:null})),nextBefore:results.length>request.limit&&last?{createdAt:last.created_at,interactionId:last.id}:null};
}

type ContentBriefRequest={originTurnId:string;projectId:string;contentIds:string[]};
type ReplacementRequest={originTurnId:string;previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;contentIds:string[]};
type BriefPlan={interactionId:string;originTurnId:string;issueHash:string;statements:D1PreparedStatement[]};
function contentIds(value:unknown):asserts value is string[]{
 if(!Array.isArray(value)||value.length<1||value.length>contentFieldLimit||new Set(value).size!==value.length||value.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(x)))throw new InteractionError('SHAPE');
}
/** Server-maintained fields only. Model-authored questions/defaults are not an issuance API. */
export async function issueContentBrief(db:D1Database,user:string,input:ContentBriefRequest){
 return persistBrief(db,user,await prepareContentBrief(db,user,input));
}
/** Compose these guarded writes with the pending Chat result, never before it. */
export async function prepareContentBrief(db:D1Database,user:string,input:ContentBriefRequest):Promise<BriefPlan>{
 await assertWorkspace(db,user);const request=copyJSON(input,4096);
 if(!request||Object.keys(request).sort().join(',')!=='contentIds,originTurnId,projectId'||!identifier(request.originTurnId)||!identifier(request.projectId))throw new InteractionError('SHAPE');
 contentIds(request.contentIds);return prepareBrief(db,user,request,null);
}
/** The trusted Chat adapter supplies its current origin turn, never an arbitrary
 * form definition. A correction stays on the original owned project and task. */
export async function replaceContentBrief(db:D1Database,user:string,input:ReplacementRequest){
 return persistBrief(db,user,await prepareReplacementContentBrief(db,user,input));
}
export async function prepareReplacementContentBrief(db:D1Database,user:string,input:ReplacementRequest):Promise<BriefPlan>{
 await assertWorkspace(db,user);const request=copyJSON(input,4096);
 if(!request||Object.keys(request).sort().join(',')!=='contentIds,definitionDigest,expectedAnswerRevision,originTurnId,previousInteractionId'||!identifier(request.originTurnId)||!identifier(request.previousInteractionId)||typeof request.definitionDigest!=='string'||!/^[a-f0-9]{64}$/.test(request.definitionDigest)||!Number.isSafeInteger(request.expectedAnswerRevision)||request.expectedAnswerRevision<0)throw new InteractionError('SHAPE');
 contentIds(request.contentIds);
 // The predecessor's payload may have expired after this correction committed.
 // Its retained ownership and exact issue hash still support successor readback.
 const metadata=await row(db,user,request.previousInteractionId),prior=await db.prepare('SELECT id,issue_hash FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(request.originTurnId,user).first<{id:string;issue_hash:string}>();
 if(prior){
  const hash=await jsonDigest({originTurnId:request.originTurnId,projectId:metadata.project_id,contentIds:request.contentIds,replacement:request});
  if(prior.issue_hash!==hash)throw new InteractionStoreError(409,'request_conflict');await readInteraction(db,user,prior.id);
  return {interactionId:prior.id,originTurnId:request.originTurnId,issueHash:hash,statements:[]};
 }
 const previous=await readInteraction(db,user,request.previousInteractionId);
 if(!previous.envelope.scope.projectId||previous.envelope.definition.template!=='content-change@1')throw new InteractionStoreError(409,'adapter_unavailable');
 return prepareBrief(db,user,{originTurnId:request.originTurnId,projectId:previous.envelope.scope.projectId,contentIds:request.contentIds},{request,previous});
}
async function prepareBrief(db:D1Database,user:string,request:ContentBriefRequest,replacement:{request:ReplacementRequest;previous:InteractionRead}|null):Promise<BriefPlan>{
 const previous=replacement?.previous??null,issueHash=await jsonDigest(replacement?{...request,replacement:replacement.request}:request);
 const prior=await db.prepare('SELECT id,issue_hash FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(request.originTurnId,user).first<{id:string;issue_hash:string}>();
 if(prior){if(prior.issue_hash!==issueHash)throw new InteractionStoreError(409,'request_conflict');await readInteraction(db,user,prior.id);return {interactionId:prior.id,originTurnId:request.originTurnId,issueHash,statements:[]};}
 if(replacement&&(previous!.envelope.definitionDigest!==replacement.request.definitionDigest||previous!.answerRevision!==replacement.request.expectedAnswerRevision||previous!.replacementInteractionId||['pending','unknown'].includes(previous!.submission?.continuation.state??'')))throw changed();
 await assertFeature(db,feature(user,request.projectId));
 const current=await readSpecification(db,user,request.projectId);
 if(!current.specification||!current.versionId||current.otherDraftChanges)throw changed();
 const spec=current.specification as ProjectSpecification,targets=new Map<string,{label:string;max:number}>();
 function target(id:string,label:string,max:number){const before=targets.get(id);targets.set(id,{label:before?.label??label,max:Math.min(before?.max??max,max)});}
 for(const page of spec.pages){
  target(page.headline,'Headline',160);target(page.description,'Introduction',1000);target(page.aboutTitle,'About heading',100);target(page.aboutText,'About text',1000);
  page.sections.forEach((section,n)=>{target(section.heading,`Section ${n+1} heading`,100);target(section.text,`Section ${n+1} text`,800);});
 }
 const values=previous?validateAnswers(previous.envelope.definition,previous.submission?.answers??previous.draft,{partial:!previous.submission}):null;
 const fields:Field[]=request.contentIds.map((contentId,n)=>{
  const t=targets.get(contentId),content=spec.content.find(c=>c.id===contentId);if(!t||!content)throw new InteractionError('REFERENCE');
  const old=previous?.envelope.definition.fields.find(f=>f.source?.contentId===contentId),retained=!!old&&!!values&&Object.hasOwn(values,old.id);
  const value=retained?values![old!.id]:content.text;
  return {id:`field-${n+1}`,type:t.max<=200?'text':'long-text',label:t.label,help:'',required:true,binding:'answer.value@1',constraints:{maxLength:t.max},source:{binding:'site.content@1',contentId,revision:current.revision},...(typeof value==='string'&&value.trim()?{default:{value,provenance:retained?'user' as const:'saved' as const}}:{})};
 });
 const definition:Definition={version:1,kind:'form',template:'content-change@1',title:'Update your website text',summary:'Review the text, then prepare a private preview. Saving and publishing each require a separate review.',presentation:'inline',fields,cards:[],submitBinding:'interaction.answers@1',continuationBinding:'site.content-prepare@1'};
 const conversation=await db.prepare('SELECT id FROM chat_conversations WHERE user_id=?').bind(user).first<{id:string}>();
 const conversationId=previous?.envelope.scope.conversationId??conversation?.id??crypto.randomUUID(),taskId=previous?.envelope.scope.taskId??crypto.randomUUID(),id=crypto.randomUUID();
 const task=previous?await db.prepare('SELECT revision FROM chat_interaction_tasks WHERE id=? AND user_id=?').bind(taskId,user).first<{revision:number}>():null;
 if(previous&&!task)throw unavailable();
 const clock=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now,strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days') expiry").first<{now:string;expiry:string}>();
 const envelope=await sealDefinition({version:1,id,scope:{accountId:user,actorId:user,conversationId,projectId:request.projectId,taskId,originTurnId:request.originTurnId},createdAt:clock!.now,expiresAt:clock!.expiry,definition});
 const gate=featurePredicate(db,feature(user,request.projectId));
 const statements=[
  interactionGuard(db,gate.sql,gate.params),
  interactionGuard(db,"EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND step='ready') AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status IN ('pending','completed'))",[user,request.originTurnId,user]),
  interactionGuard(db,'EXISTS(SELECT 1 FROM project_spec_heads h JOIN projects p ON p.id=h.project_id WHERE h.project_id=? AND h.version_id=? AND h.revision=? AND h.draft_revision=p.site_draft_revision)',[request.projectId,current.versionId,current.revision]),
  interactionGuard(db,"(SELECT count(*) FROM chat_interactions WHERE user_id=? AND state='open' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND id IS NOT ?)<20 AND (SELECT count(*) FROM chat_interactions WHERE conversation_id=? AND state='open' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND id IS NOT ?)<5",[user,previous?.envelope.id??null,conversationId,previous?.envelope.id??null])
 ];
 if(previous){
  statements.push(
   interactionGuard(db,`EXISTS(SELECT 1 FROM chat_interactions i JOIN chat_interaction_tasks t ON t.id=i.task_id WHERE i.id=? AND i.user_id=? AND i.definition_digest=? AND i.answer_revision=? AND t.revision=?)
    AND NOT EXISTS(SELECT 1 FROM chat_interactions WHERE previous_interaction_id=?)
    AND NOT EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interaction_continuations c ON c.id=s.id WHERE s.interaction_id=? AND c.state IN ('pending','unknown'))`,[previous.envelope.id,user,replacement!.request.definitionDigest,replacement!.request.expectedAnswerRevision,task!.revision,previous.envelope.id,previous.envelope.id]),
   db.prepare("UPDATE chat_interactions SET state='superseded',answer_revision=answer_revision+1 WHERE id=? AND user_id=? AND state='open'").bind(previous.envelope.id,user),
   db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason='stopped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE state='not-started' AND id IN (SELECT id FROM chat_interaction_submissions WHERE interaction_id=? AND user_id=?)").bind(previous.envelope.id,user),
   db.prepare('UPDATE chat_interaction_tasks SET revision=revision+1 WHERE id=? AND user_id=? AND revision=?').bind(taskId,user,task!.revision));
 }else statements.push(
  db.prepare('INSERT OR IGNORE INTO chat_conversations(id,user_id) VALUES(?,?)').bind(conversationId,user),
  db.prepare('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)').bind(taskId,user,conversationId,request.projectId,request.originTurnId));
 statements.push(db.prepare('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,previous_interaction_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,user,conversationId,taskId,request.projectId,request.originTurnId,previous?.envelope.id??null,canonicalJSON(envelope),envelope.definitionDigest,issueHash,clock!.now,clock!.expiry));
 return {interactionId:id,originTurnId:request.originTurnId,issueHash,statements};
}
async function persistBrief(db:D1Database,user:string,plan:BriefPlan){
 try{if(plan.statements.length)await db.batch(plan.statements);}catch(error){
  const saved=await db.prepare('SELECT id,issue_hash FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(plan.originTurnId,user).first<{id:string;issue_hash:string}>();
  if(saved){if(saved.issue_hash!==plan.issueHash)throw new InteractionStoreError(409,'request_conflict');return readInteraction(db,user,saved.id);}
  if(String(error).includes('chat_interaction_changed')||String(error).includes('UNIQUE constraint failed: chat_interaction_tasks')||String(error).includes('UNIQUE constraint failed: chat_interactions'))throw changed();throw error;
 }
 return readInteraction(db,user,plan.interactionId);
}

/** Saves only information. No AI, compiler, domain action or continuation dispatch. */
export async function mutateInteraction(db:D1Database,user:string,input:unknown){
 await assertWorkspace(db,user);
 const raw=mutationHeader(input);
 const saved=await row(db,user,raw.interactionId),requestHash=await jsonDigest(raw,32768),existing=await db.prepare('SELECT request_hash FROM chat_interaction_requests WHERE user_id=? AND request_id=?').bind(user,raw.requestId).first<{request_hash:string}>();
 if(existing){if(existing.request_hash!==requestHash)throw new InteractionStoreError(409,'request_conflict');return readInteractionReceipt(db,user,raw.requestId);}
 const envelope=await retainedEnvelope(saved),{request}=await validateMutation(raw,envelope);
 // Only server-issued content briefs are currently activated. Future maintained
 // adapters register their fresh resource/policy checks before exposing issuance.
 if(envelope.definition.template!=='content-change@1')throw new InteractionStoreError(409,'adapter_unavailable');
 if(request.operation!=='cancel')await assertFeature(db,feature(user,saved.project_id));
 const gate=featurePredicate(db,feature(user,saved.project_id)),revision=request.expectedAnswerRevision+1;
 const statements=[...(request.operation==='cancel'?[]:[interactionGuard(db,gate.sql,gate.params)]),
  interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interactions WHERE id=? AND user_id=? AND state='open' AND removed_at IS NULL AND definition_digest=? AND answer_revision=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND step='ready')",[saved.id,user,request.definitionDigest,request.expectedAnswerRevision,user])];
 if(request.operation==='save-draft')statements.push(interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interactions WHERE id=? AND (draft_saved_at IS NULL OR julianday(draft_saved_at)<=julianday('now','-1 second')))",[saved.id]));
 statements.push(db.prepare("UPDATE chat_interactions SET answer_revision=answer_revision+1,state=?,draft_json=?,draft_saved_at=CASE WHEN ?='save-draft' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,envelope_json=CASE WHEN ?='cancel' THEN NULL ELSE envelope_json END,removed_at=CASE WHEN ?='cancel' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,removal_reason=CASE WHEN ?='cancel' THEN 'discarded' ELSE NULL END WHERE id=? AND user_id=?").bind(request.operation==='submit'?'submitted':request.operation==='cancel'?'canceled':'open',request.operation==='save-draft'?canonicalJSON(request.answers,16384):'{}',request.operation,request.operation,request.operation,request.operation,saved.id,user),
  db.prepare("INSERT INTO chat_interaction_requests(user_id,request_id,interaction_id,request_hash,operation,answer_revision,created_at) VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(user,request.requestId,saved.id,requestHash,request.operation,revision));
 if(request.operation==='submit')statements.push(
  db.prepare("INSERT INTO chat_interaction_submissions(id,user_id,interaction_id,answers_json,answers_digest,answer_revision,created_at) VALUES(?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(request.requestId,user,saved.id,canonicalJSON(request.answers,16384),await jsonDigest(request.answers,16384),revision),
  db.prepare('INSERT INTO chat_interaction_continuations(id) VALUES(?)').bind(request.requestId));
 try{await db.batch(statements);}catch(error){
  const committed=await receipt(db,user,request.requestId);
  if(committed){if(committed.request_hash!==requestHash)throw new InteractionStoreError(409,'request_conflict');return readInteractionReceipt(db,user,request.requestId);}
  if(String(error).includes('chat_interaction_changed'))throw changed();throw error;
 }
 return readInteractionReceipt(db,user,request.requestId);
}

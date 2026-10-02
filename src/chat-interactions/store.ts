import {assertWorkspace} from '../workspace-identity/admission';
import {featurePredicate,assertFeature} from '../feature-admission';
import {canonicalJSON,jsonDigest,copyJSON} from '../project-specification/v2/json';
import {readSpecification} from '../project-specification/store';
import type {ProjectSpecification} from '../project-specification/v2/types';
import {InteractionError,sealDefinition,verifyEnvelope,validateMutation,mutationHeader} from './protocol';
import type {Definition,Field} from './types';

export class InteractionStoreError extends Error {
 constructor(readonly status:number,readonly code:string){super(code==='not_found'?'Chat form not found.':code==='request_conflict'?'This request ID already describes another answer.':'This Chat form changed. Read its current state before continuing.');}
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const identifier=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const changed=()=>new InteractionStoreError(409,'interaction_changed');
const unavailable=()=>new InteractionStoreError(404,'not_found');
const feature=(userId:string,projectId:string|null)=>({userId,projectId,featureId:'core.editing' as const,operation:'prepare' as const});
type Row={id:string;user_id:string;project_id:string|null;envelope_json:string;definition_digest:string;issue_hash:string;created_at:string;expires_at:string;state:'open'|'submitted'|'canceled'|'superseded';answer_revision:number;draft_json:string;draft_saved_at:string|null};
type Receipt={request_id:string;interaction_id:string;request_hash:string;operation:'save-draft'|'submit'|'cancel';answer_revision:number;created_at:string};
const ownership="(i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id))";
export function interactionGuard(db:D1Database,sql:string,params:unknown[]=[]){
 return db.prepare(`INSERT INTO chat_interaction_checks(denied) SELECT 1 WHERE NOT (${sql})`).bind(...params);
}
async function row(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!identifier(id))throw new InteractionError('ID');
 const r=await db.prepare(`SELECT i.* FROM chat_interactions i WHERE i.id=? AND i.user_id=? AND ${ownership}`).bind(id,user).first<Row>();
 if(!r)throw unavailable();return r;
}
async function receipt(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!identifier(id))throw new InteractionError('ID');
 return db.prepare(`SELECT r.request_id,r.interaction_id,r.request_hash,r.operation,r.answer_revision,r.created_at FROM chat_interaction_requests r JOIN chat_interactions i ON i.id=r.interaction_id AND i.user_id=r.user_id WHERE r.user_id=? AND r.request_id=? AND ${ownership}`).bind(user,id).first<Receipt>();
}
export async function readInteraction(db:D1Database,user:string,id:string){
 const r=await row(db,user,id),envelope=await verifyEnvelope(JSON.parse(r.envelope_json));
 const submission=await db.prepare('SELECT s.id,s.answers_json,s.answers_digest,s.answer_revision,s.created_at,c.state continuation_state,c.result_turn_id,c.reason FROM chat_interaction_submissions s JOIN chat_interaction_continuations c ON c.id=s.id WHERE s.interaction_id=? AND s.user_id=?').bind(id,user).first<{id:string;answers_json:string;answers_digest:string;answer_revision:number;created_at:string;continuation_state:string;result_turn_id:string|null;reason:string|null}>();
 if(r.state==='submitted'&&!submission)throw new InteractionStoreError(503,'receipt_unavailable');
 if(submission&&await jsonDigest(JSON.parse(submission.answers_json),16384)!==submission.answers_digest)throw new InteractionStoreError(503,'receipt_unavailable');
 const clock=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now").first<{now:string}>();
 // Recheck authority/ownership and the revision after the bounded multi-query read.
 const current=await row(db,user,id);if(current.answer_revision!==r.answer_revision)throw changed();
 return {version:1 as const,envelope,state:r.state==='open'&&r.expires_at<=clock!.now?'expired' as const:r.state,answerRevision:r.answer_revision,draft:JSON.parse(r.draft_json) as Record<string,unknown>,
  submission:submission?{id:submission.id,answers:JSON.parse(submission.answers_json) as Record<string,unknown>,answersDigest:submission.answers_digest,answerRevision:submission.answer_revision,createdAt:submission.created_at,
   continuation:{id:submission.id,state:submission.continuation_state,resultTurnId:submission.result_turn_id,reason:submission.reason}}:null};
}
export async function readInteractionReceipt(db:D1Database,user:string,requestId:string){
 const r=await receipt(db,user,requestId);if(!r)throw unavailable();
 return {version:1 as const,requestId:r.request_id,interactionId:r.interaction_id,operation:r.operation,answerRevision:r.answer_revision,createdAt:r.created_at};
}

/** Server-maintained content fields only. Model-authored questions/defaults are not an issuance API. */
export async function issueContentBrief(db:D1Database,user:string,input:{originTurnId:string;projectId:string;contentIds:string[]}){
 await assertWorkspace(db,user);
 const request=copyJSON(input,4096);
 if(!request||Object.keys(request).sort().join(',')!=='contentIds,originTurnId,projectId'||!identifier(request.originTurnId)||!identifier(request.projectId)||!Array.isArray(request.contentIds)||request.contentIds.length<1||request.contentIds.length>12||new Set(request.contentIds).size!==request.contentIds.length||request.contentIds.some(x=>typeof x!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(x)))throw new InteractionError('SHAPE');
 const issueHash=await jsonDigest(request),prior=await db.prepare('SELECT id,issue_hash FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(request.originTurnId,user).first<{id:string;issue_hash:string}>();
 if(prior){if(prior.issue_hash!==issueHash)throw new InteractionStoreError(409,'request_conflict');return readInteraction(db,user,prior.id);}
 await assertFeature(db,feature(user,request.projectId));
 const current=await readSpecification(db,user,request.projectId);
 if(!current.specification||!current.versionId||current.otherDraftChanges)throw changed();
 const spec=current.specification as ProjectSpecification,targets=new Map<string,{label:string;max:number}>();
 function target(id:string,label:string,max:number){const before=targets.get(id);targets.set(id,{label:before?.label??label,max:Math.min(before?.max??max,max)});}
 for(const page of spec.pages){
  target(page.headline,'Headline',160);target(page.description,'Introduction',1000);target(page.aboutTitle,'About heading',100);target(page.aboutText,'About text',1000);
  page.sections.forEach((section,n)=>{target(section.heading,`Section ${n+1} heading`,100);target(section.text,`Section ${n+1} text`,800);});
 }
 const fields:Field[]=request.contentIds.map((contentId,n)=>{
  const t=targets.get(contentId),content=spec.content.find(c=>c.id===contentId);if(!t||!content)throw new InteractionError('REFERENCE');
  return {id:`field-${n+1}`,type:t.max<=200?'text':'long-text',label:t.label,help:'',required:true,binding:'answer.value@1',constraints:{maxLength:t.max},source:{binding:'site.content@1',contentId,revision:current.revision},...(content.text.trim()?{default:{value:content.text,provenance:'saved' as const}}:{})};
 });
 const definition:Definition={version:1,kind:'form',template:'content-change@1',title:'Update your website text',summary:'Review the text, then prepare a private preview. Saving and publishing each require a separate review.',presentation:'inline',fields,cards:[],submitBinding:'interaction.answers@1',continuationBinding:'site.content-prepare@1'};
 const conversation=await db.prepare('SELECT id FROM chat_conversations WHERE user_id=?').bind(user).first<{id:string}>();
 const conversationId=conversation?.id??crypto.randomUUID(),taskId=crypto.randomUUID(),id=crypto.randomUUID();
 const clock=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') now,strftime('%Y-%m-%dT%H:%M:%fZ','now','+7 days') expiry").first<{now:string;expiry:string}>();
 const envelope=await sealDefinition({version:1,id,scope:{accountId:user,actorId:user,conversationId,projectId:request.projectId,taskId,originTurnId:request.originTurnId},createdAt:clock!.now,expiresAt:clock!.expiry,definition});
 const gate=featurePredicate(db,feature(user,request.projectId));
 try{await db.batch([
  interactionGuard(db,gate.sql,gate.params),
  interactionGuard(db,"EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND step='ready') AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status IN ('pending','completed'))",[user,request.originTurnId,user]),
  interactionGuard(db,'EXISTS(SELECT 1 FROM project_spec_heads h JOIN projects p ON p.id=h.project_id WHERE h.project_id=? AND h.version_id=? AND h.revision=? AND h.draft_revision=p.site_draft_revision)',[request.projectId,current.versionId,current.revision]),
  interactionGuard(db,"(SELECT count(*) FROM chat_interactions WHERE user_id=? AND state='open' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))<20 AND (SELECT count(*) FROM chat_interactions WHERE conversation_id=? AND state='open' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))<5",[user,conversationId]),
  db.prepare('INSERT OR IGNORE INTO chat_conversations(id,user_id) VALUES(?,?)').bind(conversationId,user),
  db.prepare('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)').bind(taskId,user,conversationId,request.projectId,request.originTurnId),
  db.prepare('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,user,conversationId,taskId,request.projectId,request.originTurnId,canonicalJSON(envelope),envelope.definitionDigest,issueHash,clock!.now,clock!.expiry)
 ]);}catch(error){
  const saved=await db.prepare('SELECT id,issue_hash FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(request.originTurnId,user).first<{id:string;issue_hash:string}>();
  if(saved){if(saved.issue_hash!==issueHash)throw new InteractionStoreError(409,'request_conflict');return readInteraction(db,user,saved.id);}
  if(String(error).includes('chat_interaction_changed')||String(error).includes('UNIQUE constraint failed: chat_interaction_tasks'))throw changed();throw error;
 }
 return readInteraction(db,user,id);
}

/** Saves only information. No AI, compiler, domain action or continuation dispatch. */
export async function mutateInteraction(db:D1Database,user:string,input:unknown){
 await assertWorkspace(db,user);
 const raw=mutationHeader(input);
 const saved=await row(db,user,raw.interactionId),envelope=await verifyEnvelope(JSON.parse(saved.envelope_json));
 const {request,requestHash}=await validateMutation(raw,envelope),existing=await db.prepare('SELECT request_hash FROM chat_interaction_requests WHERE user_id=? AND request_id=?').bind(user,request.requestId).first<{request_hash:string}>();
 if(existing){if(existing.request_hash!==requestHash)throw new InteractionStoreError(409,'request_conflict');return readInteractionReceipt(db,user,request.requestId);}
 // Only server-issued content briefs are currently activated. Future maintained
 // adapters register their fresh resource/policy checks before exposing issuance.
 if(envelope.definition.template!=='content-change@1')throw new InteractionStoreError(409,'adapter_unavailable');
 if(request.operation!=='cancel')await assertFeature(db,feature(user,saved.project_id));
 const gate=featurePredicate(db,feature(user,saved.project_id)),revision=request.expectedAnswerRevision+1;
 const statements=[...(request.operation==='cancel'?[]:[interactionGuard(db,gate.sql,gate.params)]),
  interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interactions WHERE id=? AND user_id=? AND state='open' AND definition_digest=? AND answer_revision=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND step='ready')",[saved.id,user,request.definitionDigest,request.expectedAnswerRevision,user])];
 if(request.operation==='save-draft')statements.push(interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interactions WHERE id=? AND (draft_saved_at IS NULL OR julianday(draft_saved_at)<=julianday('now','-1 second')))",[saved.id]));
 statements.push(db.prepare("UPDATE chat_interactions SET answer_revision=answer_revision+1,state=?,draft_json=?,draft_saved_at=CASE WHEN ?='save-draft' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END WHERE id=? AND user_id=?").bind(request.operation==='submit'?'submitted':request.operation==='cancel'?'canceled':'open',request.operation==='save-draft'?canonicalJSON(request.answers,16384):'{}',request.operation,saved.id,user),
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

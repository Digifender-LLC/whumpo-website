import type {AIConfig} from '../ai';
import {sendAIChat} from '../ai-chat';
import {BillingError} from '../billing';
import {reconcileStandardChat} from '../standard-ai-recovery';
import {InteractionError} from './protocol';
import {interactionGuard,InteractionStoreError} from './store';
import {readModelSubmission,taskContinuationContent} from './task-context';

/** Receipt reconciliation never calls the model, replays a tool, or invents a cost. */
export async function reconcileInformationTask(db:D1Database,user:string,submissionId:string,resolveClosed=false){
 let form=await readModelSubmission(db,user,submissionId);
 if(!['pending','unknown'].includes(form.submission.continuation.state))return form;
 const turn=await db.prepare('SELECT id,status,input_tokens,output_tokens,created_at FROM chat_turns WHERE id=? AND user_id=?').bind(submissionId,user).first<{id:string;status:string;input_tokens:number|null;output_tokens:number|null;created_at:string}>();
 if(!turn)throw new InteractionStoreError(503,'receipt_unavailable');
 if(turn.status==='pending')await reconcileStandardChat(db,user,turn);
 await db.batch([
  db.prepare(`UPDATE chat_interaction_continuations SET state='succeeded',result_turn_id=id,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id=? AND state IN ('pending','unknown') AND EXISTS(SELECT 1 FROM chat_turns t JOIN standard_ai_requests s ON s.id=t.id AND s.user_id=t.user_id WHERE t.id=? AND t.user_id=? AND t.status='completed' AND s.state='completed')`).bind(submissionId,submissionId,user),
  db.prepare(`UPDATE chat_interaction_continuations SET state='failed',reason='unavailable',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   WHERE id=? AND state IN ('pending','unknown') AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status='failed')`).bind(submissionId,submissionId,user),
  db.prepare("UPDATE chat_interaction_continuations SET state='unknown' WHERE id=? AND state='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status='uncertain')").bind(submissionId,submissionId,user)
 ]);
 form=await readModelSubmission(db,user,submissionId);
 if(resolveClosed&&form.submission.continuation.state==='unknown'){
  // The Chat result is already fenced. Prove absence of domain effects in the
  // same transaction that releases the task, leaving provider cost unresolved.
  await db.batch([
   interactionGuard(db,`EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status='uncertain' AND input_tokens IS NULL AND output_tokens IS NULL)
    AND NOT EXISTS(SELECT 1 FROM chat_task_progress WHERE turn_id=? AND created_project_id IS NOT NULL)
    AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM project_spec_creations WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM project_spec_proposals WHERE id=?)
    AND NOT EXISTS(SELECT 1 FROM project_spec_chat_links WHERE turn_id=? OR proposal_id=?)`,[submissionId,user,submissionId,submissionId,submissionId,submissionId,submissionId,submissionId]),
   db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason='unavailable',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='unknown'").bind(submissionId)
  ]);
 }
 return readModelSubmission(db,user,submissionId);
}
export async function continueInformationTask(db:D1Database,user:string,submissionId:string,revision:number,config?:AIConfig,transport:typeof fetch=globalThis.fetch.bind(globalThis)){
 const form=await readModelSubmission(db,user,submissionId);
 if(form.submission.continuation.state!=='not-started')return reconcileInformationTask(db,user,submissionId);
 if(!Number.isSafeInteger(revision)||revision<0)throw new InteractionError('NUMBER');
 if(revision>=2000)throw new BillingError(409,'This test workspace has reached its conversation limit. Your answers remain saved.');
 if(!config)throw new BillingError(503,'Your answers are saved. The AI is unavailable; continue this task later or stop its follow-up.');
 try{
  const result=await sendAIChat(db,user,submissionId,revision,taskContinuationContent,config,transport,undefined,false,submissionId);
  if(result.status!==200)throw new BillingError(result.status,result.error??'Your answers are saved. Read the current task before continuing.');
 }catch(error){
  const current=await readModelSubmission(db,user,submissionId);
  // A claim/result acknowledgment may have been lost. Read its identity; never
  // re-enter dispatch. An unclaimed task may be explicitly started later.
  if(current.submission.continuation.state==='not-started'){
   if(String(error).includes('chat_interaction_changed'))throw new InteractionStoreError(409,'interaction_changed');
   throw error;
  }
 }
 return reconcileInformationTask(db,user,submissionId);
}
export async function stopInformationTask(db:D1Database,user:string,submissionId:string){
 const form=await readModelSubmission(db,user,submissionId);
 if(form.submission.continuation.state==='not-started')await db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason='stopped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='not-started'").bind(submissionId).run();
 return readModelSubmission(db,user,submissionId);
}

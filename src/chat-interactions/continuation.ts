import {assertFeature,featurePredicate} from '../feature-admission';
import {assertWorkspace} from '../workspace-identity/admission';
import {prepareSpecification} from '../project-specification/store';
import {BackendError} from '../backend-error';
import {contentRequest,InteractionError} from './protocol';
import {InteractionStoreError,interactionGuard,readInteraction} from './store';

const feature=(userId:string,projectId:string)=>({userId,projectId,featureId:'core.editing' as const,operation:'prepare' as const});
async function submitted(db:D1Database,user:string,id:string){
 await assertWorkspace(db,user);if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw new InteractionError('ID');
 const s=await db.prepare('SELECT interaction_id FROM chat_interaction_submissions WHERE id=? AND user_id=?').bind(id,user).first<{interaction_id:string}>();
 if(!s)throw new InteractionStoreError(404,'not_found');
 const interaction=await readInteraction(db,user,s.interaction_id);
 if(!interaction.submission||interaction.submission.id!==id)throw new InteractionStoreError(503,'receipt_unavailable');
 return {...interaction,submission:interaction.submission};
}
/** Explicit invocation only. Reads/replays never re-enter the compiler or dispatch effects. */
export async function continueContentBrief(db:D1Database,user:string,submissionId:string,expectedChatRevision:number){
 const saved=await submitted(db,user,submissionId),project=saved.envelope.scope.projectId;
 if(saved.submission.continuation.state!=='not-started')return saved;
 if(!Number.isSafeInteger(expectedChatRevision)||expectedChatRevision<0)throw new InteractionError('NUMBER');
 if(!project||saved.envelope.definition.template!=='content-change@1')throw new InteractionStoreError(409,'adapter_unavailable');
 await assertFeature(db,feature(user,project));
 const gate=featurePredicate(db,feature(user,project));
 const currentSubmission=()=>interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id WHERE s.id=? AND s.user_id=? AND i.state='submitted' AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[submissionId,user]);
 try{await db.batch([
  interactionGuard(db,gate.sql,gate.params),currentSubmission(),
  interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interaction_continuations WHERE id=? AND state='not-started')",[submissionId]),
  db.prepare("UPDATE chat_interaction_continuations SET state='pending',started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").bind(submissionId)
 ]);}catch(error){
  const current=await submitted(db,user,submissionId);
  if(current.submission.continuation.state!=='not-started')return current;
  if(String(error).includes('chat_interaction_changed'))throw new InteractionStoreError(409,'interaction_changed');throw error;
 }
 let committing=false;
 try{
  // Existing compiler, ownership, safety, proposal and exact-review links are the
  // sole domain implementation. No inference, private save or publication here.
  const prepared=await prepareSpecification(db,user,submissionId,contentRequest(saved.envelope.definition,saved.submission.answers,project));
  committing=true;
  await db.batch([
   interactionGuard(db,gate.sql,gate.params),currentSubmission(),
   interactionGuard(db,"EXISTS(SELECT 1 FROM chat_interaction_continuations WHERE id=? AND state='pending') AND EXISTS(SELECT 1 FROM workspace_state WHERE user_id=? AND revision=? AND step='ready') AND NOT EXISTS(SELECT 1 FROM chat_turns WHERE user_id=? AND status='pending')",[submissionId,user,expectedChatRevision,user]),
   db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,ai_context_allowed) VALUES(?,?,?,'Prepare a preview from my submitted answers',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'guided','pending',0)").bind(submissionId,user,expectedChatRevision+1,prepared.reply),
   ...prepared.statements,
   db.prepare("UPDATE chat_turns SET status='completed' WHERE id=? AND user_id=? AND status='pending'").bind(submissionId,user),
   db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=? AND revision=?').bind(user,expectedChatRevision),
   db.prepare("UPDATE chat_interaction_continuations SET state='succeeded',result_turn_id=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='pending'").bind(submissionId,submissionId)
  ]);
 }catch(error){
  const current=await submitted(db,user,submissionId);
  if(current.submission.continuation.state==='succeeded')return current;
  // A lost result never authorizes another attempt. Deterministic domain refusal
  // is failed; an unclassified write outcome keeps its identity as unknown.
  const known=error instanceof BackendError||error instanceof InteractionError||String(error).includes('chat_interaction_changed')||String(error).includes('specification_changed');
  if(!committing||known)await db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='pending'").bind(known?'changed':'unavailable',submissionId).run();
  else await db.prepare("UPDATE chat_interaction_continuations SET state='unknown' WHERE id=? AND state='pending'").bind(submissionId).run();
 }
 return submitted(db,user,submissionId);
}

/** Stops collection follow-up only while it has never been claimed. */
export async function stopInteractionContinuation(db:D1Database,user:string,submissionId:string){
 const current=await submitted(db,user,submissionId);
 if(current.submission.continuation.state==='not-started')await db.prepare("UPDATE chat_interaction_continuations SET state='failed',reason='stopped',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='not-started'").bind(submissionId).run();
 return submitted(db,user,submissionId);
}

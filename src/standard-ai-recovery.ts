import {completeStandardAI, readStandardAI} from './standard-ai-usage';

type PendingTurn = {id:string;input_tokens:number|null;output_tokens:number|null;created_at:string};
/** Recover only a persisted standard request. Never dispatch or touch customer balances. */
export async function reconcileStandardChat(db:D1Database,user:string,turn:PendingTurn){
 const receipt=await readStandardAI(db,user,turn.id);
 if(!receipt)return false;
 if(turn.input_tokens!==null&&turn.output_tokens!==null){
  // Leave a persisted answer pending on database failure: the next read retries
  // this idempotent settlement, never the provider or the proposed action.
  await completeStandardAI(db,user,turn.id,turn.input_tokens,turn.output_tokens);
  await db.prepare("UPDATE chat_turns SET status='completed' WHERE id=? AND user_id=? AND status='pending'").bind(turn.id,user).run();
 }else if(Date.parse(turn.created_at)<Date.now()-120000){
  // A result may have committed since the initial read. Recheck inside the same
  // transaction that closes the receipt, so it cannot race a saved proposal.
  const pending="EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=standard_ai_requests.id AND t.user_id=standard_ai_requests.user_id AND t.status='pending' AND t.input_tokens IS NULL AND t.output_tokens IS NULL)";
  const now=new Date().toISOString();
  await db.batch([
   db.prepare(`UPDATE standard_ai_requests SET state='released',updated_at=? WHERE id=? AND user_id=? AND state='reserved' AND ${pending}`).bind(now,turn.id,user),
   db.prepare(`UPDATE standard_ai_requests SET state='uncertain',updated_at=? WHERE id=? AND user_id=? AND state='dispatched' AND ${pending}`).bind(now,turn.id,user),
   db.prepare("UPDATE inference_calls SET status='released' WHERE turn_id=? AND user_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=inference_calls.turn_id AND s.user_id=inference_calls.user_id AND s.state='released')").bind(turn.id,user),
   db.prepare("UPDATE inference_calls SET status='uncertain' WHERE turn_id=? AND user_id=? AND status='dispatched' AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=inference_calls.turn_id AND s.user_id=inference_calls.user_id AND s.state='uncertain')").bind(turn.id,user),
   db.prepare("UPDATE chat_turns SET status='failed',assistant_text='The AI finished processing, but its work result could not be confirmed. Your credits were not used. Check your saved work before asking again.' WHERE id=? AND user_id=? AND status='pending' AND input_tokens IS NULL AND output_tokens IS NULL AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=chat_turns.id AND s.user_id=chat_turns.user_id AND s.state='completed')").bind(turn.id,user),
   db.prepare("UPDATE chat_turns SET status='failed',assistant_text='The request stopped before reaching the AI. Send a new message to try again.' WHERE id=? AND user_id=? AND status='pending' AND input_tokens IS NULL AND output_tokens IS NULL AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=chat_turns.id AND s.user_id=chat_turns.user_id AND s.state='released')").bind(turn.id,user),
   db.prepare("UPDATE chat_turns SET status='uncertain',assistant_text='The AI request was interrupted. This message will not be sent twice. Your credits were not used; check your saved work before asking again.' WHERE id=? AND user_id=? AND status='pending' AND input_tokens IS NULL AND output_tokens IS NULL AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=chat_turns.id AND s.user_id=chat_turns.user_id AND s.state='uncertain')").bind(turn.id,user)
  ]);
 }
 return true;
}

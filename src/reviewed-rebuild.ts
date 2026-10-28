import {BackendError} from './backend-error';
import {reviewChangedMessage,reviewedReplyGuard,type ReviewedReply} from './chat-review-receipts';
/** For review kinds that store no reply digest: `expected` is the reply rebuilt from the saved review row. The review's own
 * turn must still hold exactly that text, else it is not what the owner reviewed. The returned reply feeds reviewedReplyGuard. */
export async function requireRebuiltReply(db:D1Database,user:string,review:string,expected:string):Promise<ReviewedReply>{
 const shown=await db.prepare("SELECT assistant_text FROM chat_turns WHERE id=? AND user_id=? AND status='completed'").bind(review,user).first<{assistant_text:string}>();
 if(shown?.assistant_text!==expected)throw new BackendError(409,reviewChangedMessage);
 return {turn:review,text:expected};
}
export const rebuiltGuard=(user:string,reviewed?:ReviewedReply)=>reviewedReplyGuard(user,reviewed);

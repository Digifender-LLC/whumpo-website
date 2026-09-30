import {BillingError} from './billing';
export type StandardAIReceipt={id:string;user_id:string;request_hash:string;state:'reserved'|'dispatched'|'uncertain'|'completed'|'released';input_tokens:number|null;output_tokens:number|null;created_at:string;updated_at:string};
export async function readStandardAI(db:D1Database,user:string,id:string){
 return db.prepare('SELECT * FROM standard_ai_requests WHERE id=? AND user_id=?').bind(id,user).first<StandardAIReceipt>();
}
/** Internal admission only. It grants no provider budget or authority to perform a task. */
export async function reserveStandardAI(db:D1Database,user:string,id:string,requestHash:string){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)||!/^[0-9a-f]{64}$/.test(requestHash))throw new BillingError(400,'Invalid standard AI request');
 const now=new Date().toISOString();
 // A replay never creates a second receipt and never reopens a terminal receipt.
 const result=await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,user,requestHash,now,now).run();
 const receipt=await readStandardAI(db,user,id);
 if(!receipt||receipt.request_hash!==requestHash)throw new BillingError(409,'Standard AI request identity changed');
 return {receipt,created:result.meta.changes===1};
}
export async function dispatchStandardAI(db:D1Database,user:string,id:string){
 const result=await db.prepare("UPDATE standard_ai_requests SET state='dispatched',updated_at=? WHERE id=? AND user_id=? AND state='reserved'").bind(new Date().toISOString(),id,user).run();
 return result.meta.changes===1;
}
export async function markStandardAIUncertain(db:D1Database,user:string,id:string){
 await db.prepare("UPDATE standard_ai_requests SET state='uncertain',updated_at=? WHERE id=? AND user_id=? AND state='dispatched'").bind(new Date().toISOString(),id,user).run();
}
/** Token reports are internal evidence, never a conversion into customer credits. */
export async function completeStandardAI(db:D1Database,user:string,id:string,input:number,output:number){
 if(![input,output].every(n=>Number.isSafeInteger(n)&&n>=0))throw new BillingError(400,'Invalid standard AI token report');
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=?,output_tokens=?,updated_at=? WHERE id=? AND user_id=? AND state IN ('dispatched','uncertain')").bind(input,output,new Date().toISOString(),id,user).run();
 const receipt=await readStandardAI(db,user,id);
 if(!receipt||receipt.state!=='completed'||receipt.input_tokens!==input||receipt.output_tokens!==output)throw new BillingError(409,'Standard AI completion conflicts with its receipt');
 return receipt;
}
/** Cancel only before dispatch. Unknown provider outcomes must retain their receipt. */
export async function cancelStandardAI(db:D1Database,user:string,id:string){
 await db.prepare("UPDATE standard_ai_requests SET state='released',updated_at=? WHERE id=? AND user_id=? AND state='reserved'").bind(new Date().toISOString(),id,user).run();
 const receipt=await readStandardAI(db,user,id);
 if(!receipt||receipt.state!=='released')throw new BillingError(409,'The request may have been dispatched; reconcile its outcome');
 return receipt;
}

/** Admission is atomic with the Chat claim and internal inference reservation. */
export function standardAIReservationStatement(db:D1Database,user:string,id:string,requestHash:string,date:Date,revision:number){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)||!/^[0-9a-f]{64}$/.test(requestHash)||!Number.isSafeInteger(revision)||revision<0)throw new BillingError(400,'Invalid standard AI request');
 const now=date.toISOString();
 return db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) SELECT ?,user_id,?,?,? FROM workspace_state WHERE user_id=? AND revision=? AND NOT EXISTS(SELECT 1 FROM chat_turns WHERE user_id=? AND status='pending') ON CONFLICT(id) DO NOTHING").bind(id,requestHash,now,now,user,revision,user);
}
/** Failed work can still incur internal costs; never invent a zero-token report. */
export async function closeStandardAIAttempt(db:D1Database,user:string,id:string){
 const cost=await db.prepare("SELECT input_tokens,output_tokens FROM inference_calls WHERE id=? AND user_id=? AND status='observed'").bind(id,user).first<{input_tokens:number;output_tokens:number}>();
 if(cost)await completeStandardAI(db,user,id,cost.input_tokens,cost.output_tokens);
 else await markStandardAIUncertain(db,user,id);
}

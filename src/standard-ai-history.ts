import {BillingError} from './billing';
export type StandardAIHistoryRow={id:string;state:string;created_at:string;chat_status:string|null};
const fields='s.id,s.state,s.created_at,t.status AS chat_status';
const from='FROM standard_ai_requests s LEFT JOIN chat_turns t ON t.id=s.id AND t.user_id=s.user_id';
/** Customer-safe metadata only: no prompts, hashes, model configuration or costs. */
export async function readStandardAIHistory(db:Pick<D1Database,'prepare'>,user:string,page=1){
 if(!Number.isSafeInteger(page)||page<1||page>1000)throw new BillingError(400,'Choose an AI-history page from 1 to 1000.');
 const {results}=await db.prepare(`SELECT ${fields} ${from} WHERE s.user_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 21 OFFSET ?`).bind(user,(page-1)*20).all<StandardAIHistoryRow>();
 return {rows:results.slice(0,20),page,hasMore:results.length>20&&page<1000,truncated:results.length>20&&page===1000};
}
export async function readStandardAIRequest(db:Pick<D1Database,'prepare'>,user:string,id:string){
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id))throw new BillingError(400,'Choose a valid AI request ID.');
 return db.prepare(`SELECT ${fields} ${from} WHERE s.user_id=? AND s.id=?`).bind(user,id).first<StandardAIHistoryRow>();
}
export function standardAIStatus(row:StandardAIHistoryRow){
 if(row.chat_status==='completed')return 'Completed';
 if(row.chat_status==='failed')return 'Could not complete the requested work';
 if(row.chat_status==='uncertain'||row.state==='uncertain')return 'Outcome needs review';
 if(row.state==='released')return 'Stopped before sending';
 if(row.state==='reserved')return 'Preparing';
 if(row.state==='dispatched')return 'Working';
 return row.chat_status==='pending'?'Saving the result':'Response processed';
}
export function describeStandardAIRequest(row:StandardAIHistoryRow){
 return `${row.created_at} · ${standardAIStatus(row)}\nNo units or credits charged.\nRequest: ${row.id}`;
}
export function describeStandardAIHistory(history:Awaited<ReturnType<typeof readStandardAIHistory>>){
 return `Standard AI requests — page ${history.page}\n\n`+(history.rows.length?history.rows.map(describeStandardAIRequest).join('\n\n'):'No standard AI requests on this page.')+(history.hasMore?`\n\nAsk for AI request history page ${history.page+1}.`:history.truncated?'\n\nOlder requests are outside this history window.':'')+"\n\nAsk to inspect a saved request by its ID. Reading history never retries work. Check the original Chat response and saved work before asking again about an interrupted request.";
}

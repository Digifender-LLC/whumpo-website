import {BillingError} from './billing';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const fields='id,kind,reference,statement,created_at,state,public_response,answered_at,customer_read_at';
export type UsageReviewRequest={id:string;kind:'usage_review'|'help'|'safety_notice'|'safety_appeal';reference:string|null;statement:string;created_at:string;state:'open'|'answered';public_response:string|null;answered_at:string|null;customer_read_at:string|null};
export type OperatorQueueRow=UsageReviewRequest&{user_id:string;source:'chat'|'support'|'chat_form';delivery_state:'queued'|'delivered'|'failed'|'cancelled'|null};
function text(value:string,max:number){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new BillingError(400,'Invalid usage-review text.');return value.trim();}
export function usageReviewCommand(content:string){return /^(?:\/usage-reviews?(?:\s|$)|request a usage review(?:\s*:|$)|show my usage reviews?(?: [0-9a-f-]{36})?$)/i.test(content);}
export async function readUsageReviewRequest(db:Pick<D1Database,'prepare'>,user:string,id:string){
 if(!uuid.test(id))throw new BillingError(400,'Choose a valid review ID.');
 return db.prepare(`SELECT ${fields} FROM usage_review_requests WHERE id=? AND user_id=?`).bind(id,user).first<UsageReviewRequest>();
}
export async function listUsageReviewRequests(db:Pick<D1Database,'prepare'>,user:string,kind?:'usage_review'|'help'){
 return (await db.prepare(`SELECT ${fields} FROM usage_review_requests WHERE user_id=?${kind?' AND kind=?':''} ORDER BY created_at DESC,id DESC LIMIT 25`).bind(user,...(kind?[kind]:[])).all<UsageReviewRequest>()).results;
}
/** Operator-only cross-account queue (private: statements and account IDs). Oldest first; no response is implied.
 * WH-016 safety notices and appeals are not in this queue: appeals are decided only through the restricted safety surface. */
export async function listSupportQueue(db:Pick<D1Database,'prepare'>,state:'open'|'answered'='open',limit=50){
 if(!['open','answered'].includes(state)||!Number.isInteger(limit)||limit<1||limit>100)throw new BillingError(400,'Invalid queue request.');
 return (await db.prepare(`SELECT r.user_id,r.source,r.id,r.kind,r.reference,r.statement,r.created_at,r.state,r.public_response,r.answered_at,r.customer_read_at,d.state AS delivery_state FROM usage_review_requests r LEFT JOIN support_deliveries d ON d.request_id=r.id WHERE r.state=? AND r.kind IN ('usage_review','help') ORDER BY r.created_at,r.id LIMIT ?`).bind(state,limit).all<OperatorQueueRow>()).results;
}
export function markReadStatement(db:Pick<D1Database,'prepare'>,user:string,id:string){return db.prepare("UPDATE usage_review_requests SET customer_read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='answered' AND customer_read_at IS NULL").bind(id,user);}
function describe(row:UsageReviewRequest){return `Usage review ${row.id}\n${row.state==='open'?'Waiting for operator review':'Response saved'} · ${row.created_at}\nYour statement: ${row.statement}${row.public_response?'\n\nResponse: '+row.public_response:''}`;}
export async function prepareUsageReviewChat(db:D1Database,user:string,turn:string,content:string){
 const command=content.toLowerCase();
 const read=/^(?:\/usage-reviews|show my usage reviews?)(?:\s+(.+))?$/.exec(command);
 if(read||command==='show my usage reviews'){
  if(read?.[1]){const row=await readUsageReviewRequest(db,user,read[1]);if(!row||row.kind!=='usage_review')throw new BillingError(404,'Usage review not found.');return {reply:describe(row),statements:row.state==='answered'&&!row.customer_read_at?[markReadStatement(db,user,row.id)]:[] as D1PreparedStatement[]};}
  const rows=await listUsageReviewRequests(db,user,'usage_review');
  return {reply:(rows.length?rows.map(row=>`${row.state==='open'?'Waiting for operator review':'Response ready'} · ${row.created_at}\nAsk “show my usage review ${row.id}”`).join('\n\n'):'You have no usage reviews yet.')+'\n\nTo request one, type “request a usage review: ” followed by what you want an operator to understand. Never include passwords or keys. This saves a private request; no external message is sent or limit changed. If Chat is unavailable, open Support in the workspace menu or at /workspace/support.',statements:[] as D1PreparedStatement[]};
 }
 const match=/^(?:\/usage-review\s+|request a usage review\s*:\s*)([\s\S]+)$/i.exec(content);
 if(!match)return {reply:'To request an operator review, type “request a usage review: ” followed by your explanation (up to 950 characters). Your statement is stored for platform operators and kept out of later AI context. No external message is sent, and this does not change service limits or billing.',statements:[] as D1PreparedStatement[]};
 const statement=text(match[1],950);
 const open=await db.prepare("SELECT id FROM usage_review_requests WHERE user_id=? AND kind='usage_review' AND state='open'").bind(user).first<{id:string}>();
 if(open)throw new BillingError(409,'You already have an open usage review. Ask “show my usage review '+open.id+'” to read its status.');
 return {reply:'Your usage review is saved for a platform operator. Your statement stays out of later AI context. No external message was sent, no response time is promised, and no limit or billing setting changed.\n\nReview: '+turn+'\nAsk “show my usage reviews” to check for a response.',statements:[db.prepare("INSERT INTO usage_review_requests(id,user_id,statement,kind,source) SELECT id,user_id,?,'usage_review','chat' FROM chat_turns WHERE id=? AND user_id=? AND ai_context_allowed=0").bind(statement,turn,user)]};
}
/** Operator-only response. This does not deliver a notice or change enforcement. */
export async function answerUsageReview(db:Pick<D1Database,'prepare'>,user:string,id:string,response:string,operator:string){
 if(!uuid.test(user)||!uuid.test(id))throw new BillingError(400,'Invalid review identity.');
 const reply=text(response,2000),who=text(operator,100);
 const existing=await db.prepare('SELECT kind,state,public_response,answered_by FROM usage_review_requests WHERE id=? AND user_id=?').bind(id,user).first<{kind:string;state:string;public_response:string|null;answered_by:string|null}>();
 if(!existing)throw new BillingError(404,'Usage review not found.');
 if(existing.kind!=='usage_review'&&existing.kind!=='help')throw new BillingError(409,'Safety notices and appeals are answered only through the restricted safety review surface.');
 if(existing.state==='answered'){
  if(existing.public_response!==reply||existing.answered_by!==who)throw new BillingError(409,'This review already has a different response.');
  return {review:await readUsageReviewRequest(db,user,id),replayed:true,enforcementEnabled:false};
 }
 await db.prepare("UPDATE usage_review_requests SET state='answered',public_response=?,answered_by=?,answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='open'").bind(reply,who,id,user).run();
 const saved=await db.prepare('SELECT public_response,answered_by FROM usage_review_requests WHERE id=? AND user_id=?').bind(id,user).first<{public_response:string;answered_by:string}>();
 if(saved?.public_response!==reply||saved?.answered_by!==who)throw new BillingError(409,'A different response was saved. Read the review before continuing.');
 return {review:await readUsageReviewRequest(db,user,id),replayed:false,enforcementEnabled:false};
}

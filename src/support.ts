import {BillingError} from './billing';
import {listUsageReviewRequests,markReadStatement,type UsageReviewRequest} from './usage-review-requests';
import {parseSupportReference,operationReference,supportStatusLinks,type SupportConfigView,type SupportKind,type SupportOperation,type SupportOverview,type SupportRequest,type SupportDeliveryState} from './support-shape';
export type SupportEnv={SUPPORT_HOURS?:string;SUPPORT_NOTIFICATION_PROVIDER?:string;SUPPORT_NOTIFICATION_REVIEW?:string};
/** Notification senders implemented in this repository. None is selected or implemented yet. */
export const implementedNotificationProviders:readonly string[]=[];
export type NotificationSettings={provider:string;review:string};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const cleaned=(value:unknown,max:number)=>typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():null;
/** Owner-supplied values only; nothing is invented. Unset values are reported as not configured. */
export function supportConfig(env:SupportEnv,implemented:readonly string[]=implementedNotificationProviders){
 const provider=cleaned(env.SUPPORT_NOTIFICATION_PROVIDER,60),review=cleaned(env.SUPPORT_NOTIFICATION_REVIEW,200);
 const settings:NotificationSettings|null=provider&&review&&implemented.includes(provider)?{provider,review}:null;
 return {hours:cleaned(env.SUPPORT_HOURS,300),settings};
}
export const supportConfigView=(config:ReturnType<typeof supportConfig>):SupportConfigView=>({hours:config.hours,notifications:{enabled:config.settings!==null}});
const columns="r.id,r.kind,r.reference,r.statement,r.created_at,r.state,r.public_response,r.answered_at,r.customer_read_at,CASE d.state WHEN 'accepted' THEN 'delivered' WHEN 'delivered' THEN 'delivered' WHEN 'failed' THEN 'failed' WHEN 'bounced' THEN 'failed' WHEN 'complained' THEN 'failed' WHEN 'unresolved' THEN 'failed' WHEN 'cancelled' THEN 'cancelled' WHEN 'queued' THEN 'queued' WHEN 'dispatching' THEN 'queued' WHEN 'deferred' THEN 'queued' WHEN 'unknown-outcome' THEN 'queued' END AS delivery_state";
type Row=UsageReviewRequest&{delivery_state:Exclude<SupportDeliveryState,'none'>|null};
export function supportRequest(row:Row):SupportRequest{
 const answered=row.state==='answered';
 return {id:row.id,kind:row.kind,reference:row.reference,statement:row.statement,createdAt:row.created_at,state:row.state,publicResponse:answered?row.public_response:null,answeredAt:answered?row.answered_at:null,
  response:{saved:answered},delivery:{state:answered?row.delivery_state??'none':'none'},read:{state:answered?(row.customer_read_at?'read':'unread'):'not_applicable',at:row.customer_read_at}};
}
async function readOwned(db:Pick<D1Database,'prepare'>,user:string,id:string){
 return db.prepare(`SELECT ${columns} FROM usage_review_requests r LEFT JOIN notification_notices d ON d.template='support.response-saved@1' AND d.event_ref=r.id AND d.user_id=r.user_id WHERE r.id=? AND r.user_id=?`).bind(id,user).first<Row>();
}
async function listOwned(db:Pick<D1Database,'prepare'>,user:string,limit=25){
 return (await db.prepare(`SELECT ${columns} FROM usage_review_requests r LEFT JOIN notification_notices d ON d.template='support.response-saved@1' AND d.event_ref=r.id AND d.user_id=r.user_id WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).bind(user,limit).all<Row>()).results;
}
/** Support history bound per account (test capacity), shared by the page and the Chat form. */
export const supportHistoryCapacity=200;
/** Owner-only customer projection used by the Chat support view. Reading never records a customer read. */
export async function listOwnedSupportRequests(db:Pick<D1Database,'prepare'>,user:string,limit=10){
 if(!Number.isSafeInteger(limit)||limit<1||limit>25)throw new BillingError(400,'Invalid support list.');
 return (await listOwned(db,user,limit)).map(supportRequest);
}
/** Counts only, for the owner agent's workspace context: no statement, response or operator detail. */
export async function supportSummary(db:Pick<D1Database,'prepare'>,user:string){
 const r=await db.prepare("SELECT coalesce(sum(state='open' AND kind='help'),0) open_help,coalesce(sum(state='open' AND kind='usage_review'),0) open_usage,coalesce(sum(state='answered' AND customer_read_at IS NULL),0) unread FROM usage_review_requests WHERE user_id=?").bind(user).first<{open_help:number;open_usage:number;unread:number}>();
 return {openHelpRequest:(r?.open_help??0)>0,openUsageReview:(r?.open_usage??0)>0,unreadResponses:r?.unread??0};
}
/** WH-035 owner agent read. The owner's own help-request statements and customer-visible responses may enter the
 * bounded follow-up; reviewer identity, fair-use evidence and provider detail never do. Usage-review text keeps its
 * existing exclusion from model context (metadata only; the owner reads it in the Chat support view or Support page).
 * The list is a bounded preview; one exact owned ID returns the full help text. Reading is not a customer read receipt. */
export async function agentSupportRead(db:Pick<D1Database,'prepare'>,user:string,requestId:string|null){
 const facts=(r:SupportRequest)=>({id:r.id,kind:r.kind,createdAt:r.createdAt,state:r.state,responseSaved:r.response.saved,answeredAt:r.answeredAt,delivery:r.delivery.state,read:r.read.state});
 if(requestId!==null){
  const r=await readSupportRequest(db,user,requestId);
  return {version:1 as const,requests:[r.kind==='help'?{...facts(r),reference:r.reference,statement:r.statement,response:r.publicResponse}:{...facts(r),textAvailableToModel:false}]};
 }
 return {version:1 as const,requests:(await listOwnedSupportRequests(db,user,10)).map(r=>r.kind==='help'?{...facts(r),statementPreview:r.statement.slice(0,160)}:{...facts(r),textAvailableToModel:false})};
}
const families:{family:SupportOperation['family'];label:string;sql:string;minutes:number;next:string}[]=[
 {family:'chat',label:'Chat message',sql:"SELECT id,status AS state,created_at AS since FROM chat_turns WHERE user_id=? AND status IN ('pending','uncertain') ORDER BY created_at LIMIT 10",minutes:10,next:'Wait a few minutes, then ask for help here. Saved work, exports and recovery do not need Chat.'},
 {family:'standard_ai',label:'AI request',sql:"SELECT id,state,updated_at AS since FROM standard_ai_requests WHERE user_id=? AND state IN ('reserved','dispatched','uncertain') ORDER BY updated_at LIMIT 10",minutes:10,next:'Do not repeat it. An unresolved AI request keeps its hold until an operator reconciles it; ask for help here.'},
 {family:'hosting',label:'Domain hosting connection',sql:"SELECT id,state,created_at AS since FROM domain_connections WHERE user_id=? AND state IN ('creating','uncertain','provisioning','disconnecting') ORDER BY created_at LIMIT 10",minutes:10,next:'Check the Domains page; do not start another connection for the same name. Ask for help here if it stays unchanged.'},
 {family:'backup',label:'GitHub backup',sql:"SELECT id,state,COALESCE(dispatched_at,created_at) AS since FROM github_backups WHERE user_id=? AND state IN ('dispatching','uncertain') ORDER BY created_at LIMIT 10",minutes:10,next:'Do not start another backup of the same version until this one is read back. Ask for help here.'},
 {family:'dns',label:'DNS change',sql:"SELECT id,state,created_at AS since FROM cloudflare_dns_actions WHERE user_id=? AND state IN ('sending','uncertain') ORDER BY created_at LIMIT 10",minutes:10,next:'Do not resend. Check the record at your DNS provider and ask for help here.'}
];
/** Own rows only; ids/states/times, never provider detail, hostnames or content. Read-only. */
export async function supportOperations(db:Pick<D1Database,'prepare'>,user:string,now=new Date()):Promise<SupportOperation[]>{
 const out:SupportOperation[]=[];
 for(const f of families){
  for(const row of (await db.prepare(f.sql).bind(user).all<{id:string;state:string;since:string}>()).results){
   const t=Date.parse(row.since),age=Number.isFinite(t)?Math.max(0,Math.floor((now.getTime()-t)/60000)):null;
   out.push({id:row.id,family:f.family,label:f.label,state:row.state,since:row.since,ageMinutes:age,needsAttention:age===null||age>=f.minutes,reference:operationReference(f.family,row.id),next:f.next});
  }
 }
 return out;
}
export async function supportOverview(db:Pick<D1Database,'prepare'>,user:string,config:ReturnType<typeof supportConfig>,now=new Date()):Promise<SupportOverview>{
 return {version:1,config:supportConfigView(config),requests:(await listOwned(db,user)).map(supportRequest),operations:await supportOperations(db,user,now),statusLinks:supportStatusLinks()};
}
const tables:Record<SupportOperation['family'],string>={chat:'chat_turns',standard_ai:'standard_ai_requests',hosting:'domain_connections',backup:'github_backups',dns:'cloudflare_dns_actions'};
export type SupportInput={id:string;kind:SupportKind;statement:string;reference:string|null};
export function supportInput(data:Record<string,unknown>|null|undefined):SupportInput{
 if(!data)throw new BillingError(400,'A JSON request is required.');
 const keys=Object.keys(data).sort().join(',');
 if(data.version!==1||!['id,kind,statement,version','id,kind,reference,statement,version'].includes(keys))throw new BillingError(400,'Use the current support request.');
 const {id,kind,statement,reference}=data as {id:unknown;kind:unknown;statement:unknown;reference?:unknown};
 if(typeof id!=='string'||!uuid.test(id)||kind!=='usage_review'&&kind!=='help')throw new BillingError(400,'Use a valid request ID and kind.');
 if(typeof statement!=='string'||!statement.trim()||statement.trim().length>950||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(statement))throw new BillingError(400,'Describe the request in 1 to 950 characters.');
 if(reference!==undefined&&!parseSupportReference(reference))throw new BillingError(400,'Choose a listed status or one of your own operations.');
 return {id,kind,statement:statement.trim(),reference:typeof reference==='string'?reference:null};
}
/** Idempotent by ID. Needs only the signed-in account: no Chat turn, onboarding or AI budget is read or consumed. */
export async function createSupportRequest(db:Pick<D1Database,'prepare'>,user:string,input:SupportInput){
 const same=(row:Row)=>row.kind===input.kind&&row.statement===input.statement&&row.reference===input.reference;
 const existing=await readOwned(db,user,input.id);
 if(existing){if(!same(existing))throw new BillingError(409,'This request ID already holds a different request.');return {request:supportRequest(existing),replayed:true};}
 const ref=parseSupportReference(input.reference);
 if(ref?.kind==='operation'&&!await db.prepare(`SELECT 1 AS x FROM ${tables[ref.family]} WHERE id=? AND user_id=?`).bind(ref.id,user).first())throw new BillingError(404,'That operation was not found in your account.');
 const open=await db.prepare("SELECT id FROM usage_review_requests WHERE user_id=? AND kind=? AND state='open'").bind(user,input.kind).first<{id:string}>();
 if(open)throw new BillingError(409,'You already have an open '+(input.kind==='help'?'help request':'usage review')+' ('+open.id+'). Read it before opening another.');
 if(((await db.prepare('SELECT count(*) AS n FROM usage_review_requests WHERE user_id=?').bind(user).first<{n:number}>())?.n??0)>=supportHistoryCapacity)throw new BillingError(409,'Support history has reached its test capacity.');
 try{await db.prepare("INSERT INTO usage_review_requests(id,user_id,statement,kind,source,reference) VALUES(?,?,?,?,'support',?)").bind(input.id,user,input.statement,input.kind,input.reference).run();}
 catch(cause){
  const raced=await readOwned(db,user,input.id);if(raced&&same(raced))return {request:supportRequest(raced),replayed:true};
  if(String(cause).includes('usage_review_requests.user_id')||String(cause).includes('UNIQUE'))throw new BillingError(409,'You already have an open request of this kind. Read it before opening another.');
  throw cause;
 }
 return {request:supportRequest((await readOwned(db,user,input.id))!),replayed:false};
}
export async function readSupportRequest(db:Pick<D1Database,'prepare'>,user:string,id:string){
 if(!uuid.test(id))throw new BillingError(400,'Choose a valid request ID.');
 const row=await readOwned(db,user,id);if(!row)throw new BillingError(404,'Support request not found.');return supportRequest(row);
}
/** Called by the page after it has displayed the saved response. Idempotent; reading never changes the response or delivery state. */
export async function markSupportRequestRead(db:Pick<D1Database,'prepare'>,user:string,id:string){
 if(!uuid.test(id))throw new BillingError(400,'Choose a valid request ID.');
 await markReadStatement(db,user,id).run();
 return readSupportRequest(db,user,id);
}
/** Route table for /api/support/v1. Throws BillingError for invalid or missing items. */
export async function supportRoute(db:Pick<D1Database,'prepare'>,user:string,method:string,pathname:string,search:string,data:Record<string,unknown>|null|undefined,config:ReturnType<typeof supportConfig>){
 const rest=pathname.slice('/api/support/v1'.length);
 if(search)throw new BillingError(400,'Use the exact support link.');
 if(rest===''&&method==='GET')return supportOverview(db,user,config);
 if(rest==='/requests'&&method==='POST'){const result=await createSupportRequest(db,user,supportInput(data));return {version:1,...result};}
 const item=/^\/requests\/([^/]+)(\/read)?$/.exec(rest);
 if(item&&!item[2]&&method==='GET')return {version:1,request:await readSupportRequest(db,user,item[1])};
 if(item?.[2]&&method==='POST'){if(!data||Object.keys(data).join(',')!=='version'||data.version!==1)throw new BillingError(400,'Use the current read receipt.');return {version:1,request:await markSupportRequestRead(db,user,item[1])};}
 throw new BillingError(404,'Not found');
}

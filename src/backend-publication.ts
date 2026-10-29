import {reviewedReplyGuard,type ReviewedReply} from './chat-review-receipts';
import {projectRuntime} from './runtime-lane';
import {publicClientKey,reservePublicClient,PublicClientLimitError} from './public-admission';
import {BackendError,listBackends,callBackend} from './backend-versions';
import {hashToken} from './security';
import {admitWithTurnover,compactedReview} from './review-turnover';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Review={id:string;user_id:string;project_id:string;operation:'publish'|'unpublish';version_id:string;run_id:string|null;base_revision:number;status:string;expires_at:string;source:string;digest:string};
export const backendEndpoint=(project:string)=>`https://${project}.whumpo.site/backend`;
export async function readBackendPublication(db:D1Database,user:string,project:string){
 await listBackends(db,user,project);
 const row=await db.prepare('SELECT revision,review_id,version_id FROM backend_publications WHERE project_id=?').bind(project).first<{revision:number;review_id:string|null;version_id:string|null}>();
 return {projectId:project,endpoint:backendEndpoint(project),revision:row?.revision??0,reviewId:row?.review_id??null,versionId:row?.version_id??null};
}
export async function readBackendPublicationReview(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT r.*,v.source,v.digest FROM backend_publication_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN backend_versions v ON v.id=r.version_id AND v.project_id=r.project_id WHERE r.id=? AND r.user_id=?').bind(id,user).first<Review>();
 if(!row)throw await compactedReview(db,'backend_publication_reviews',id,user,(s,m)=>new BackendError(s,m))??new BackendError(404,'Backend publication review not found');
 // Withdrawal grants no execution or serving authority. Damaged source must
 // not prevent an owner from taking its endpoint offline.
 if(row.operation==='publish'&&await hashToken(row.source)!==row.digest)throw new BackendError(409,'Backend integrity check failed');
 return row;
}
export async function prepareBackendPublication(db:D1Database,user:string,project:string,id:string,operation:'publish'|'unpublish',version:string,run:string|null,expectedRevision?:number){
 if(!uuid.test(id)||!uuid.test(version)||!['publish','unpublish'].includes(operation)||operation==='publish'&&(!run||!uuid.test(run))||operation==='unpublish'&&run!==null)throw new BackendError(400,'Provide a review UUID, version UUID and successful test receipt for publication');
 await listBackends(db,user,project);
 const previous=await db.prepare('SELECT id FROM backend_publication_reviews WHERE id=?').bind(id).first();
 if(!previous){
  const gone=await compactedReview(db,'backend_publication_reviews',id,user,(s,m)=>new BackendError(s,m));if(gone)throw gone;
  await db.prepare('INSERT OR IGNORE INTO backend_publications(project_id) VALUES(?)').bind(project).run();
  const current=await readBackendPublication(db,user,project);
  try{await admitWithTurnover(db,'backend_publication_reviews',{user,project},db.prepare('INSERT INTO backend_publication_reviews(id,user_id,project_id,operation,version_id,run_id,base_revision) VALUES(?,?,?,?,?,?,?)').bind(id,user,project,operation,version,run,expectedRevision??current.revision));}catch{/* Read an exact committed review after an uncertain acknowledgment. */}
 }
 let row:Review;try{row=await readBackendPublicationReview(db,user,id);}catch{throw new BackendError(409,'Review unavailable: check the successful test receipt, current publication and review allowance');}
 if(row.project_id!==project||row.operation!==operation||row.version_id!==version||row.run_id!==run||expectedRevision!==undefined&&row.base_revision!==expectedRevision)throw new BackendError(409,'Review ID already used');
 return row;
}
// Only the authenticated human confirmation route/command may call this.
export async function confirmBackendPublication(db:D1Database,user:string,id:string,reviewed?:ReviewedReply){
 const row=await readBackendPublicationReview(db,user,id);if(row.status==='applied')return row;
 try{const g=reviewedReplyGuard(user,reviewed);if(!(await db.prepare("UPDATE backend_publication_reviews SET status='applied' WHERE id=? AND user_id=? AND status='pending'"+g.sql).bind(id,user,...g.params).run()).meta.changes)throw 0;}catch{
  const saved=await readBackendPublicationReview(db,user,id);if(saved.status==='applied')return saved;
  throw new BackendError(409,'Publication review expired or the endpoint changed; prepare a new review');
 }
 return readBackendPublicationReview(db,user,id);
}
export function describeBackendPublication(row:Review){
 return `Backend ${row.operation} review ${row.id}\nStatus: ${row.status}\nEndpoint: ${backendEndpoint(row.project_id)}\nVersion: ${row.version_id}\nSHA-256: ${row.digest}\nBase revision: ${row.base_revision}\nSuccessful test: ${row.run_id??'not applicable'}\nExpires: ${row.expires_at}\n`+
 (row.operation==='publish'?'Anyone can POST JSON to this endpoint. The function receives only that JSON, without private project data, credentials or network access. Calls are limited to 100/project/day, 500/account/day and 1,000/platform/day (UTC), with at most 20/day from one caller connection per project; once half the platform pool is used, accounts that already made 100 calls today wait for the next UTC day. Calls the runtime refuses as busy are not counted. A passing example does not prove all inputs work. Function output is public to its caller; never embed secrets in source.':'This takes the endpoint offline. Already admitted calls may finish. Saved versions and private project data are retained.')+
 `\nSource (untrusted code):\n${row.source}\n`+(row.status==='pending'?"Only you can apply this exact review using its confirmation button.":"This review was applied. Ask for the current status of project "+row.project_id+' for the current endpoint state.');
}
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin','content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
export async function publicBackend(request:Request,db:D1Database,service:Fetcher|undefined,project:string,publication?:string):Promise<Response>{
 const reply=(data:unknown,status=200)=>Response.json(data,{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type',allow:'POST, OPTIONS'}});
 if(request.method!=='POST')return new Response(JSON.stringify({ok:false,error:'method_not_allowed'}),{status:405,headers:{...headers,allow:'POST, OPTIONS'}});
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||request.headers.has('content-encoding'))return reply({ok:false,error:'json_required'},415);
 let input:unknown;
 try{
  const reader=request.body?.getReader();if(!reader)return reply({ok:false,error:'invalid_input'},400);
  let length=0;const parts:Uint8Array[]=[];
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();return reply({ok:false,error:'input_too_large'},413);}parts.push(value);}
  const bytes=new Uint8Array(length);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}input=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
 }catch{return reply({ok:false,error:'invalid_input'},400);}
 try{
  const row=await db.prepare('SELECT b.review_id,v.source,v.digest FROM backend_publications b JOIN backend_versions v ON v.id=b.version_id AND v.project_id=b.project_id JOIN backend_publication_reviews r ON r.id=b.review_id AND r.status=\'applied\' JOIN projects p ON p.id=b.project_id AND p.owner_user_id=r.user_id WHERE b.project_id=?').bind(project).first<{review_id:string;source:string;digest:string}>();
  if(!row||publication&&row.review_id!==publication)return reply({ok:false,error:'not_found'},404);
  if(!service||await hashToken(row.source)!==row.digest)return reply({ok:false,error:'unavailable'},503);
  // One anonymous source may spend at most a bounded share of the project allowance (attempts, never refunded).
  try{await reservePublicClient(db,'backend',project,await publicClientKey(request,'backend',project));}catch(cause){if(cause instanceof PublicClientLimitError)return reply({ok:false,error:'client_allowance_exhausted'},429);throw cause;}
  // The insert trigger runs before UPSERT and serializes the project, account, platform and fair-share quotas.
  // An uncertain reservation acknowledgment must not dispatch the function.
  const day=new Date().toISOString().slice(0,10);
  try{await db.prepare("INSERT INTO backend_public_usage(project_id,day,calls,publication_id) VALUES(?,strftime('%Y-%m-%d','now'),1,?) ON CONFLICT(project_id) DO UPDATE SET day=excluded.day,calls=CASE WHEN backend_public_usage.day=excluded.day THEN backend_public_usage.calls+1 ELSE 1 END,publication_id=excluded.publication_id").bind(project,row.review_id).run();}catch{return reply({ok:false,error:'allowance_or_publication_unavailable'},429);}
  const outcome=await callBackend(await projectRuntime(service,project),row.source,input);
  const refused=!outcome.ok&&(outcome.error==='unavailable'||outcome.error==='busy');
  // The runtime ran no guest code (busy) or gave no verdict: return the project/account/platform call. Best effort;
  // a lost refund leaves the call spent, never over-admits. Guest failures did execute and stay charged.
  if(refused)try{await db.prepare('UPDATE backend_public_usage SET calls=calls-1 WHERE project_id=? AND day=? AND calls>0 AND publication_id=?').bind(project,day,row.review_id).run();}catch{/* Keep the reservation. */}
  return reply(outcome,outcome.ok?200:refused?503:422);
 }catch{return reply({ok:false,error:'unavailable'},503);}
}

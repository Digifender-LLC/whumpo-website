import {projectRuntime} from './runtime-lane';
import {hashToken,newSessionToken} from './security';
import {BackendError,callBackend} from './backend-versions';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes=(s:string)=>new TextEncoder().encode(s).length;
const sessionHash=(token:string)=>hashToken('whumpo-app-session:'+token);
type Visitor={visitor_id:string;project_id:string;access_id:string;token_hash:string};
type Identity=Visitor&{version_id:string;program_revision:number};
type Run={id:string;visitor_id:string;project_id:string;version_id:string;request_hash:string;base_revision:number;state:string;result_json:string|null};
// INTERNAL ONLY: call after successful project-scoped visitor authentication.
// Public visitor authentication uses app-auth.ts; this helper is not an AI tool.
export async function issueAppSession(db:D1Database,visitor:string){
 if(!uuid.test(visitor))throw new BackendError(400,'Invalid visitor identity');
 const token=newSessionToken(),hash=await sessionHash(token);
 await db.prepare("DELETE FROM app_sessions WHERE visitor_id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(visitor).run();
 try{await db.prepare('INSERT INTO app_sessions(token_hash,visitor_id) VALUES(?,?)').bind(hash,visitor).run();}catch{throw new BackendError(409,'Application session unavailable');}
 return token;
}
export async function revokeAppSession(db:D1Database,token:string){if(/^[0-9a-f]{64}$/.test(token))await db.prepare('DELETE FROM app_sessions WHERE token_hash=?').bind(await sessionHash(token)).run();}
/** WH-126 project visitor identity: this project's unexpired session of an unrevoked visitor whose access instance is
 * active. Account export and the visitor's own deletion need only this; no visitor application is required. */
export async function visitorIdentity(db:D1Database,token:string,project:string):Promise<Visitor>{
 if(!/^[0-9a-f]{64}$/.test(token)||!uuid.test(project))throw new BackendError(401,'Application sign-in required');
 const row=await db.prepare("SELECT v.id AS visitor_id,v.project_id,v.access_id,s.token_hash FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id JOIN module_activations ac ON ac.instance_id=v.access_id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=v.project_id AND p.owner_user_id=ar.user_id WHERE s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND v.revoked=0 AND ac.state='active' AND v.project_id=?").bind(await sessionHash(token),project).first<Visitor>();
 if(!row)throw new BackendError(401,'Application sign-in required');return row;
}
/** The visitor application consumes that identity: it must also be enabled and bound to the same access instance. */
export async function appIdentity(db:D1Database,token:string,project:string):Promise<Identity>{
 const visitor=await visitorIdentity(db,token,project);
 const app=await db.prepare('SELECT a.version_id,a.revision AS program_revision FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.access_id=? AND a.enabled=1').bind(project,visitor.access_id).first<{version_id:string;program_revision:number}>();
 if(!app)throw new BackendError(401,'Application sign-in required');return {...visitor,...app};
}
const identity=appIdentity;
export async function readAppData(db:D1Database,token:string,project:string){
 const actor=await identity(db,token,project),doc=await db.prepare('SELECT revision,state_json FROM app_documents WHERE visitor_id=?').bind(actor.visitor_id).first<{revision:number;state_json:string}>();
 if(!doc)throw new BackendError(503,'Application data unavailable');return {revision:doc.revision,state:JSON.parse(doc.state_json)};
}
export async function readAppReceipt(db:D1Database,token:string,project:string,id:string){
 const actor=await identity(db,token,project);
 if(!uuid.test(id))throw new BackendError(400,'Provide an operation UUID');
 const row=await db.prepare('SELECT id,state,result_json FROM app_runs WHERE id=? AND project_id=? AND visitor_id=?').bind(id,project,actor.visitor_id).first<{id:string;state:string;result_json:string|null}>();
 if(!row)throw new BackendError(404,'Application receipt not found');
 return {id:row.id,state:row.state,...(row.result_json?{result:JSON.parse(row.result_json)}:{message:'Operation pending or outcome unknown. This ID will not execute again.'})};
}
export async function transitionAppData(db:D1Database,service:Fetcher,token:string,project:string,id:string,revision:number,input:unknown){
 const actor=await identity(db,token,project);
 if(!uuid.test(id)||!Number.isSafeInteger(revision)||revision<0||input===undefined)throw new BackendError(400,'Provide an operation UUID, current revision and JSON input');
 let encoded:string;try{const json=JSON.stringify(input);if(typeof json!=='string')throw Error('Invalid JSON');encoded=json;}catch{throw new BackendError(400,'Application input must be JSON');}if(bytes(encoded)>4096)throw new BackendError(400,'Application input exceeds 4096 bytes');
 const fingerprint=await hashToken(JSON.stringify([actor.visitor_id,project,revision,encoded]));
 const read=()=>db.prepare('SELECT id,visitor_id,project_id,version_id,request_hash,base_revision,state,result_json FROM app_runs WHERE id=?').bind(id).first<Run>();
 const receipt=(run:Run)=>{if(run.visitor_id!==actor.visitor_id||run.project_id!==project||run.request_hash!==fingerprint)throw new BackendError(409,'Application operation ID already used');return {id,state:run.state,...(run.result_json?{result:JSON.parse(run.result_json)}:{message:'Operation pending or outcome unknown. This ID will not execute again.'})};};
 const old=await read();if(old)return receipt(old);
 const doc=await db.prepare('SELECT revision,state_json FROM app_documents WHERE visitor_id=?').bind(actor.visitor_id).first<{revision:number;state_json:string}>();
 if(!doc||doc.revision!==revision){const concurrent=await read();if(concurrent)return receipt(concurrent);throw new BackendError(409,'Application data changed; read the current revision');}
 const payload={state:JSON.parse(doc.state_json),input:JSON.parse(encoded)};if(bytes(JSON.stringify(payload))>8192)throw new BackendError(400,'Combined application state and input exceed 8192 bytes');
 const code=await db.prepare('SELECT source,digest FROM backend_versions WHERE id=? AND project_id=?').bind(actor.version_id,project).first<{source:string;digest:string}>();
 if(!code||await hashToken(code.source)!==code.digest)throw new BackendError(503,'Application program unavailable');
 try{await db.prepare('INSERT INTO app_runs(id,visitor_id,project_id,version_id,session_hash,request_hash,base_revision,program_revision,page_review_id) SELECT ?,?,?,?,?,?,?,?,(SELECT id FROM app_live_pages WHERE project_id=?)').bind(id,actor.visitor_id,project,actor.version_id,actor.token_hash,fingerprint,revision,actor.program_revision,project).run();}catch{
  const found=await read();if(found)return receipt(found);throw new BackendError(409,'Application changed or execution allowance reached');
 }
 const outcome=await callBackend(await projectRuntime(service,project),code.source,payload),value=outcome.ok?outcome.value:null;
 const valid=value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&'state'in value&&'result'in value&&bytes(JSON.stringify((value as {state:unknown}).state))<=4096&&bytes(JSON.stringify((value as {result:unknown}).result))<=4096;
 const proposed=value as {state:unknown;result:unknown};
 const result=valid?{ok:true,value:proposed.result,revision:revision+1}:outcome.ok?{ok:false,error:'invalid_transition'}:outcome;
 try{await db.prepare("UPDATE app_runs SET state=?,next_json=?,result_json=? WHERE id=? AND state='running'").bind(valid?'complete':'failed',valid?JSON.stringify(proposed.state):null,JSON.stringify(result),id).run();}catch{
  // Lost commit acknowledgments are read back. Competing writes and revoked or
  // changed authority never rerun the guest or overwrite the current document.
  const saved=await read();if(saved?.state!=='running'){if(!saved)throw new BackendError(503,'Application receipt unavailable');return receipt(saved);}
  const current=await db.prepare("SELECT 1 AS valid FROM app_documents d JOIN app_visitors v ON v.id=d.visitor_id JOIN module_activations ac ON ac.instance_id=v.access_id AND ac.state='active' JOIN app_spaces a ON a.project_id=v.project_id AND a.access_id=v.access_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_sessions s ON s.visitor_id=v.id JOIN app_runs r ON r.id=? AND r.page_review_id IS (SELECT id FROM app_live_pages WHERE project_id=a.project_id) WHERE v.id=? AND v.revoked=0 AND a.enabled=1 AND d.revision=? AND a.version_id=? AND a.revision=? AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(id,actor.visitor_id,revision,actor.version_id,actor.program_revision,actor.token_hash).first();
  if(!current)try{await db.prepare("UPDATE app_runs SET state='conflict',result_json=? WHERE id=? AND state='running'").bind(JSON.stringify({ok:false,error:'state_or_authority_changed'}),id).run();}catch{/* Retain an uncertain receipt if storage is unavailable. */}
 }
 const final=await read();if(!final)throw new BackendError(503,'Application receipt unavailable');return receipt(final);
}

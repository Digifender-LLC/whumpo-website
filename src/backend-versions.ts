import {hashToken} from './security';
export class BackendError extends Error {constructor(readonly status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const size=(text:string)=>new TextEncoder().encode(text).length;
const categories=new Set(['invalid_request','invalid_code','execution_failed','work_limit','unresolved_promise','invalid_output','unavailable','busy']);
type Outcome={ok:true;value:unknown}|{ok:false;error:string};
type Run={id:string;user_id:string;project_id:string;version_id:string;request_hash:string;state:string;result_json:string|null};
async function owner(db:D1Database,user:string,project:string){if(!uuid.test(project)||!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new BackendError(404,'Project not found');}
export async function listBackends(db:D1Database,user:string,project:string){await owner(db,user,project);return (await db.prepare('SELECT id,digest,created_at FROM backend_versions WHERE project_id=? ORDER BY created_at DESC,id LIMIT 25').bind(project).all()).results;}
export async function saveBackend(db:D1Database,user:string,project:string,id:unknown,source:unknown){
 await owner(db,user,project);
 if(typeof id!=='string'||!uuid.test(id)||typeof source!=='string'||!source.trim()||size(source)>8192)throw new BackendError(400,'Provide a version UUID and JavaScript module up to 8192 bytes');
 const digest=await hashToken(source),previous=await db.prepare('SELECT id,project_id,digest FROM backend_versions WHERE id=?').bind(id).first<{id:string;project_id:string;digest:string}>();
 if(previous){if(previous.project_id!==project||previous.digest!==digest)throw new BackendError(409,'Version ID already used');return previous;}
 try{await db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)').bind(id,project,source,digest,new Date().toISOString(),project,user).run();}
 catch{const found=await db.prepare('SELECT id,project_id,digest FROM backend_versions WHERE id=?').bind(id).first<{id:string;project_id:string;digest:string}>();if(found?.project_id===project&&found.digest===digest)return found;throw new BackendError(409,'Version was not saved; check the version list and storage allowance');}
 const saved=await db.prepare('SELECT id,project_id,digest FROM backend_versions WHERE id=? AND project_id=?').bind(id,project).first();if(!saved)throw new BackendError(404,'Project not found');return saved;
}
// Pure execution only. This client never passes cookies, credentials or host capabilities.
export async function callBackend(service:Fetcher,source:string,input:unknown):Promise<Outcome>{
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 const work=async():Promise<Outcome>=>{
  const response=await service.fetch('https://runtime/execute',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,source,input}),signal:controller.signal});
  if(![200,422,503].includes(response.status)||!response.headers.get('content-type')?.startsWith('application/json')){await response.body?.cancel();return {ok:false,error:'unavailable'};}
  const reader=response.body?.getReader();if(!reader)return {ok:false,error:'unavailable'};
  let count=0;const parts:Uint8Array[]=[];
  for(;;){const {value,done}=await reader.read();if(done)break;count+=value.length;if(count>18000){await reader.cancel();return {ok:false,error:'unavailable'};}parts.push(value);}
  const buffer=new Uint8Array(count);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(buffer));
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
   if(response.status===200&&parsed.ok===true&&Object.keys(parsed).length===2&&'value'in parsed&&size(JSON.stringify(parsed.value))<=16384)return {ok:true,value:parsed.value};
   if(response.status!==200&&parsed.ok===false&&Object.keys(parsed).length===2&&categories.has(parsed.error))return {ok:false,error:parsed.error};
  }
  return {ok:false,error:'unavailable'};
 };
 try{return await Promise.race([work(),new Promise<Outcome>(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({ok:false,error:'unavailable'});},5000);})]);}catch{return {ok:false,error:'unavailable'};}finally{if(timer!==undefined)clearTimeout(timer);}
}
export async function testBackend(db:D1Database,service:Fetcher,user:string,project:string,version:string,id:unknown,input:unknown){
 await owner(db,user,project);
 if(!uuid.test(version)||typeof id!=='string'||!uuid.test(id)||input===undefined)throw new BackendError(400,'Provide an invocation UUID and JSON input');
 let serialized:string;try{serialized=JSON.stringify(input);}catch{throw new BackendError(400,'Input must be JSON');}
 if(size(serialized)>8192)throw new BackendError(400,'Input exceeds 8192 bytes');
 const saved=await db.prepare('SELECT source,digest FROM backend_versions WHERE id=? AND project_id=?').bind(version,project).first<{source:string;digest:string}>();if(!saved)throw new BackendError(404,'Backend version not found');
 if(await hashToken(saved.source)!==saved.digest)throw new BackendError(409,'Backend integrity check failed');
 const requestHash=await hashToken(JSON.stringify([project,version,saved.digest,serialized]));
 const read=()=>db.prepare('SELECT * FROM backend_runs WHERE id=?').bind(id).first<Run>();
 const receipt=(run:Run)=>{if(run.user_id!==user||run.project_id!==project||run.version_id!==version||run.request_hash!==requestHash)throw new BackendError(409,'Invocation ID already used');return {id,state:run.state,...(run.result_json?{result:JSON.parse(run.result_json)}:{message:'Execution is pending or its outcome is unknown. This ID will not be run again.'})};};
 const old=await read();if(old)return receipt(old);
 try{await db.prepare('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)').bind(id,user,project,version,requestHash).run();}
 catch{const found=await read();if(found)return receipt(found);throw new BackendError(429,'Backend test allowance reached or reservation unavailable');}
 const result=await callBackend(service,saved.source,input);
 try{await db.prepare("UPDATE backend_runs SET state='complete',result_json=? WHERE id=? AND user_id=? AND state='running'").bind(JSON.stringify(result),id,user).run();}catch{/* Read back a possibly committed receipt; never execute again. */}
 const final=await read();if(!final)throw new BackendError(503,'Execution receipt unavailable');return receipt(final);
}

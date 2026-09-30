import {BackendError} from './backend-versions';
import {hashToken} from './security';
import {contentPolicyVersion} from './content-policy';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const columns='id,project_id,digest,policy_version,state,created_at,scanned_at';
type ImportStatus={id:string;project_id:string;digest:string;policy_version:string;state:'pending'|'requires_review'|'blocked';created_at:string;scanned_at:string|null};
const describe=(row:ImportStatus)=>({...row,usable:false,message:row.state==='pending'?'Imported code is quarantined and queued for background checks.':row.state==='blocked'?'Imported code was blocked by preliminary safety checks. It cannot be run or managed.':'Preliminary checks finished. Imported code remains quarantined until the required safety scanner review is available.'});
async function owned(db:D1Database,user:string,project:string){if(!uuid.test(project)||!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new BackendError(404,'Project not found');}
export async function quarantineBackendImport(db:D1Database,user:string,project:string,id:unknown,source:unknown){
 await owned(db,user,project);
 if(typeof id!=='string'||!uuid.test(id)||typeof source!=='string'||!source.trim()||new TextEncoder().encode(source).length>8192)throw new BackendError(400,'Provide an import UUID and JavaScript module up to 8192 bytes');
 const digest=await hashToken(source);
 const read=()=>db.prepare(`SELECT ${columns} FROM backend_imports WHERE id=? AND user_id=? AND project_id=?`).bind(id,user,project).first<ImportStatus>();
 const previous=await read();if(previous){if(previous.digest!==digest)throw new BackendError(409,'Import ID already used for different code');return describe(previous);}
 try{await db.prepare('INSERT INTO backend_imports(id,user_id,project_id,source,digest,policy_version) VALUES(?,?,?,?,?,?)').bind(id,user,project,source,digest,contentPolicyVersion).run();}
 catch{const saved=await read();if(saved?.digest===digest)return describe(saved);throw new BackendError(409,'Import was not accepted; use a new import ID or check the import allowance');}
 const row=await read();if(!row)throw new BackendError(503,'Import status unavailable');return describe(row);
}
export async function listBackendImports(db:D1Database,user:string,project:string){await owned(db,user,project);const {results}=await db.prepare(`SELECT ${columns} FROM backend_imports WHERE user_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT 25`).bind(user,project).all<ImportStatus>();return results.map(describe);}
/** Bounded static triage only. No execution, network, model input or approval. */
export function triageImportedSource(source:string):'credential'|'dynamic_code'|'remote_dependency'|null{
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk_live_|sk_test_|ghp_|github_pat_)[A-Za-z0-9_]{12,}/.test(source))return 'credential';
 if(/\b(?:eval\s*\(|new\s+Function\s*\(|WebAssembly\s*\.)/.test(source))return 'dynamic_code';
 if(/\b(?:import\s*\(|require\s*\(|import\s+[^;\n]*\bfrom\s*['"]|import\s*['"]|export\s+[^;\n]*\bfrom\s*['"])/.test(source))return 'remote_dependency';
 return null;
}
export async function scanBackendImports(db:D1Database){
 const {results}=await db.prepare("SELECT id,source,digest,policy_version FROM backend_imports WHERE state='pending' ORDER BY created_at,id LIMIT 10").all<{id:string;source:string;digest:string;policy_version:string}>();
 for(const row of results){
  const reason=await hashToken(row.source)!==row.digest?'integrity':triageImportedSource(row.source);
  // Even no findings means held for a real scanner, never safe/approved.
  await db.prepare("UPDATE backend_imports SET state=?,reason=?,scanned_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='pending' AND digest=? AND policy_version=?").bind(reason?'blocked':'requires_review',reason??'scanner_required',row.id,row.digest,row.policy_version).run();
 }
 return {examined:results.length};
}

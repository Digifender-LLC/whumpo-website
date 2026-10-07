import type {ActiveConnectorProvider} from '../connector-catalog';
import {assertWorkspace} from '../workspace-identity/admission';
export class ConnectorBudgetError extends Error{
 readonly status=429;readonly code='connector_rate_limited';
 constructor(readonly retryAfterSeconds:number){super(`This connection reached its request limit. Try again in ${retryAfterSeconds} seconds. Saved outcome checks and disconnect remain available.`);}
}
const limited=(error:unknown)=>error instanceof Error&&/^(?:D1_ERROR: )?connector_provider_rate_limited(?:: SQLITE_CONSTRAINT(?: \(extended: SQLITE_CONSTRAINT_TRIGGER\))?)?$/.test(error.message);
/** Wrap the actual operation/CAS statement. Never classify unrelated database failures as a rate limit. */
export async function connectorBudgetStatement<T>(db:D1Database,user:string,provider:ActiveConnectorProvider,kind:'read'|'action',statement:()=>Promise<T>):Promise<T>{
 try{return await statement();}catch(error){
  if(!limited(error))throw error;
  const row=await db.prepare('SELECT MAX(1,window_start+60-unixepoch()) seconds FROM connector_request_budgets WHERE user_id=? AND provider=? AND kind=?').bind(user,provider,kind).first<{seconds:number}>();
  throw new ConnectorBudgetError(row?.seconds??1);
 }
}
/** Admitted new-work reads only. Callers repeat exact credential admission after this committing statement. */
export async function claimConnectorRead(db:D1Database,user:string,provider:ActiveConnectorProvider){
 await assertWorkspace(db,user);
 return connectorBudgetStatement(db,user,provider,'read',()=>db.prepare(`INSERT INTO connector_request_budgets(user_id,provider,kind,window_start,used) VALUES(?,?,'read',(unixepoch()/60)*60,1)
 ON CONFLICT(user_id,provider,kind) DO UPDATE SET window_start=MAX(window_start,excluded.window_start),used=CASE WHEN excluded.window_start>window_start THEN 1 ELSE used+1 END`).bind(user,provider).run());
}
/** Source-owned dispatch ID is a locator, never approval. Only an already claimed owned action can prove it. */
type GitHubDispatch={repo_owner:string;repo_name:string;branch:string;path:string;state:string};
type CloudflareDispatch={zone_id:string;record_name:string;state:string};
export function connectorDispatchReceipt(db:D1Database,user:string,provider:'github',id:string|undefined,token:string,project:string|null):Promise<GitHubDispatch|null>;
export function connectorDispatchReceipt(db:D1Database,user:string,provider:'cloudflare',id:string|undefined,token:string,project:string|null):Promise<CloudflareDispatch|null>;
export async function connectorDispatchReceipt(db:D1Database,user:string,provider:ActiveConnectorProvider,id:string|undefined,token:string,project:string|null){
 if(!id||!project)return null;
 if(provider==='github')return db.prepare("SELECT b.repo_owner,b.repo_name,b.branch,b.path,b.state FROM github_backups b JOIN projects p ON p.id=b.project_id WHERE b.id=? AND b.user_id=? AND p.owner_user_id=? AND b.project_id=? AND b.token_id=? AND b.state IN ('dispatching','uncertain')").bind(id,user,user,project,token).first<{repo_owner:string;repo_name:string;branch:string;path:string;state:string}>();
 if(provider==='cloudflare')return db.prepare("SELECT a.zone_id,a.record_name,a.state FROM cloudflare_dns_actions a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.user_id=? AND p.owner_user_id=? AND a.project_id=? AND a.token_id=? AND a.state IN ('sending','uncertain')").bind(id,user,user,project,token).first<{zone_id:string;record_name:string;state:string}>();
 return null;
}
/** Counters expire as metadata only; cleanup cannot renew consent or any uncertain write. */
export async function cleanupConnectorBudgets(db:D1Database){return db.prepare('DELETE FROM connector_request_budgets WHERE rowid IN (SELECT rowid FROM connector_request_budgets WHERE window_start<unixepoch()-600 ORDER BY window_start LIMIT 100)').run();}

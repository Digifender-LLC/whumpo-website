import {hashToken} from '../security';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';

/** WH-126 access descriptor export hook (WH-071 lifecycle; WH-077 composes it). It serializes the access instance's
 * `project-roles` data set: the staff grants and revoked suppressions with opaque visitor ids, revisions and dates.
 * Visitor identity itself (`visitor-identity`, subject visitor) is exported only by each visitor's own account export
 * (separate approval). No credential, recovery code, session, document or visitor-submitted value is included.
 * Deterministic: no inference, provider, network or Chat history. */
export const accessRolesExportHook='access-roles-export-v1';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
type Role={visitorId:string;role:'staff';state:'granted'|'revoked';accessRevision:number;grantedAt:string;updatedAt:string};

/** Owner only (current workspace identity and project ownership), in every activation state and with the catalog pin
 * withdrawn or restaged; the registered descriptor must name this hook and the caller's configRevision must be current. */
export async function exportAccessRoles(db:D1Database,user:string,project:string,resourceId:string,configRevision:number){
 await assertWorkspace(db,user);
 const row=await db.prepare(`SELECT i.kind,i.local_id,i.config_revision,i.config_json,i.descriptor_json,s.revision access_revision FROM module_instances i JOIN projects p ON p.id=i.project_id
  JOIN module_access_states s ON s.instance_id=i.id WHERE i.id=? AND i.project_id=? AND p.owner_user_id=?`).bind(resourceId,project,user)
  .first<{kind:string;local_id:string;config_revision:number;config_json:string;descriptor_json:string;access_revision:number}>();
 if(!row||row.kind!=='access')throw new ModuleError('not_found');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 if((JSON.parse(row.descriptor_json) as {lifecycle?:{exportHook?:unknown}}).lifecycle?.exportHook!==accessRolesExportHook)throw new ModuleError('unavailable');
 const {results}=await db.prepare("SELECT visitor_id,role,state,access_revision,granted_at,updated_at FROM module_access_roles WHERE instance_id=? AND project_id=? ORDER BY visitor_id,role LIMIT 1000")
  .bind(resourceId,project).all<{visitor_id:string;role:'staff';state:'granted'|'revoked';access_revision:number;granted_at:number;updated_at:number}>();
 const roles:Role[]=results.map(r=>({visitorId:r.visitor_id,role:r.role,state:r.state,accessRevision:r.access_revision,grantedAt:iso(r.granted_at),updatedAt:iso(r.updated_at)}));
 const staffRole=(JSON.parse(row.config_json) as {roles?:unknown}).roles;
 return {format:'whumpo-access-roles',schemaVersion:1,project:{id:project},
  instance:{resourceId,localId:row.local_id,configRevision:row.config_revision,accessRevision:row.access_revision,staffRole:Array.isArray(staffRole)&&staffRole.includes('staff')},
  roles,rolesSha256:await hashToken(JSON.stringify(roles))};
}

/** Import validation for `whumpo-access-roles` v1: exact wrapper and row shapes and the roles SHA-256. It validates
 * only; nothing imports roles (a restore re-admits through the current schema and reviews, never by replaying grants). */
export async function validateAccessRolesExport(value:unknown){
 const fail=():never=>{throw new ModuleError('invalid_request','This is not a current Whumpo access roles export.');};
 const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
 const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=1;
 const time=(v:unknown)=>typeof v==='string'&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
 if(!exact(value,['format','schemaVersion','project','instance','roles','rolesSha256'])||value.format!=='whumpo-access-roles'||value.schemaVersion!==1)return fail();
 const {project,instance,roles}=value;
 if(!exact(project,['id'])||typeof project.id!=='string'||!uuid.test(project.id))return fail();
 if(!exact(instance,['resourceId','localId','configRevision','accessRevision','staffRole'])||typeof instance.resourceId!=='string'||!uuid.test(instance.resourceId)
  ||typeof instance.localId!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(instance.localId)||!count(instance.configRevision)||!count(instance.accessRevision)||typeof instance.staffRole!=='boolean')return fail();
 if(!Array.isArray(roles)||roles.length>1000)return fail();
 const seen=new Set<string>();
 for(const r of roles as unknown[]){
  if(!exact(r,['visitorId','role','state','accessRevision','grantedAt','updatedAt'])||typeof r.visitorId!=='string'||!uuid.test(r.visitorId)||r.role!=='staff'||!['granted','revoked'].includes(String(r.state))
   ||!count(r.accessRevision)||(r.accessRevision as number)>(instance.accessRevision as number)||!time(r.grantedAt)||!time(r.updatedAt)||String(r.updatedAt)<String(r.grantedAt)||seen.has(r.visitorId))return fail();
  seen.add(r.visitorId);
 }
 if(typeof value.rolesSha256!=='string'||await hashToken(JSON.stringify(roles))!==value.rolesSha256)return fail();
 return {projectId:project.id,resourceId:instance.resourceId,roles:roles as Role[]};
}

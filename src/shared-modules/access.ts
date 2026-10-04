import {hashToken} from '../security';
import {ModuleError,type ModulePrincipal} from './policy';
import {registeredInstances} from './registry';
import type {ModuleHandlers,ModuleReadHandler} from './api';
import type {AccessRoleFacts,AccessVisitorFacts} from './shape';

/** WH-126 access module. Visitor principals are the project's existing visitor identities (passkeys, invitations,
 * recovery and sessions in app-auth.ts/app-data.ts); this module derives the server-side principal from the visitor
 * session cookie on the visitor origin, adds the `staff` role and the access revision, and serves `access.me`
 * (visitor) and `access.list` (owner). Deterministic only: no inference, provider or network access. A workspace
 * cookie is never read here, and a staff role confers no workspace, Chat, publication, spending or identity authority. */
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const declaresStaff=(config:string)=>{try{const roles=JSON.parse(config)?.roles;return Array.isArray(roles)&&roles.includes('staff');}catch{return false;}};

type PrincipalRow={visitor_id:string;access_id:string;config_json:string;access_revision:number;staff:number};
/** The visitor principal for one module resource, or null for an anonymous (public) request. Requires the exact
 * project's current visitor session (unrevoked identity, unexpired session, enabled visitor application) and an access
 * instance governing the resource: the resource itself, or its declared same-project access dependency. Roles count
 * only when the access configuration declares `staff` and a current grant exists; the committing statement repeats
 * this through `visitorPredicate`. */
export async function visitorPrincipal(db:D1Database,token:string,project:string,resourceId:string):Promise<ModulePrincipal|null>{
 if(!/^[0-9a-f]{64}$/.test(token)||!uuid(project)||!uuid(resourceId))return null;
 const sessionHash=await hashToken('whumpo-app-session:'+token);
 const row=await db.prepare(`SELECT v.id visitor_id,x.id access_id,x.config_json,st.revision access_revision,
  EXISTS(SELECT 1 FROM module_access_roles r WHERE r.instance_id=x.id AND r.visitor_id=v.id AND r.role='staff' AND r.state='granted') staff
  FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id
  JOIN module_instances i ON i.id=? AND i.project_id=v.project_id
  JOIN module_instances x ON x.project_id=i.project_id AND x.kind='access' AND (x.id=i.id OR x.id IN (SELECT value FROM json_each(i.dependencies_json)))
  JOIN module_access_states st ON st.instance_id=x.id AND st.project_id=x.project_id
  WHERE s.token_hash=? AND v.project_id=? AND v.revoked=0 AND a.enabled=1 AND s.expires_at>${now} ORDER BY x.local_id LIMIT 1`)
  .bind(resourceId,sessionHash,project).first<PrincipalRow>();
 if(!row)return null;
 return {kind:'visitor',projectId:project,visitorId:row.visitor_id,sessionHash,accessInstanceId:row.access_id,roles:row.staff===1&&declaresStaff(row.config_json)?['staff']:[],accessRevision:row.access_revision};
}

/** Composed into every visitor commit and read fence: the same session and identity, the same active access instance
 * at the same access revision, and the same staff decision. Any revocation, erasure, sign-out, recovery, application
 * disable or role change after the decision makes it false. */
export function visitorPredicate(p:Extract<ModulePrincipal,{kind:'visitor'}>){
 return {sql:`(EXISTS(SELECT 1 FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id
   WHERE s.token_hash=? AND v.id=? AND v.project_id=? AND v.revoked=0 AND a.enabled=1 AND s.expires_at>${now})
  AND EXISTS(SELECT 1 FROM module_access_states st JOIN module_instances x ON x.id=st.instance_id JOIN module_activations ac ON ac.instance_id=x.id
   WHERE st.instance_id=? AND st.project_id=? AND st.revision=? AND x.kind='access' AND ac.state='active')
  AND ?=EXISTS(SELECT 1 FROM module_access_roles r JOIN module_instances x ON x.id=r.instance_id WHERE r.instance_id=? AND r.visitor_id=? AND r.role='staff' AND r.state='granted'
   AND EXISTS(SELECT 1 FROM json_each(x.config_json,'$.roles') WHERE value='staff')))`,
  params:[p.sessionHash,p.visitorId,p.projectId,p.accessInstanceId,p.projectId,p.accessRevision,p.roles.length?1:0,p.accessInstanceId,p.visitorId] as unknown[]};
}

type RosterRow={visitor_id:string;created_at:string;revoked:number;state:string|null;granted_at:number|null;updated_at:number|null};
const iso=(seconds:number|null)=>seconds===null?null:new Date(seconds*1000).toISOString();
/** Owner roster for one access instance: opaque visitor ids, enrollment dates and staff state. Never credentials,
 * passkey material, recovery codes, sessions, documents or visitor-submitted values. */
export async function accessRoster(db:D1Database,instanceId:string,projectId:string):Promise<AccessVisitorFacts[]>{
 const {results}=await db.prepare(`SELECT v.id visitor_id,v.created_at,v.revoked,r.state,r.granted_at,r.updated_at FROM app_visitors v
  LEFT JOIN module_access_roles r ON r.visitor_id=v.id AND r.instance_id=? AND r.role='staff' WHERE v.project_id=? ORDER BY v.created_at DESC,v.id LIMIT 100`).bind(instanceId,projectId).all<RosterRow>();
 return results.map(r=>({visitorId:r.visitor_id,enrolledAt:new Date(r.created_at).toISOString(),revoked:r.revoked===1,staff:r.state==='granted',staffChangedAt:r.state?iso(r.updated_at):null}));
}

const me:ModuleReadHandler=async(_db,{principal,resource})=>{
 if(principal.kind!=='visitor'||principal.accessInstanceId!==resource.resourceId)throw new ModuleError('forbidden');
 return {roles:[...principal.roles],accessRevision:principal.accessRevision};
};
const list:ModuleReadHandler=async(db,{principal,resource})=>{
 if(principal.kind!=='owner')throw new ModuleError('forbidden');
 const state=await db.prepare('SELECT revision FROM module_access_states WHERE instance_id=? AND project_id=?').bind(resource.resourceId,resource.projectId).first<{revision:number}>();
 if(!state)throw new ModuleError('unavailable');
 return {accessRevision:state.revision,staffRole:resource.instance.kind==='access'&&(resource.instance.config.roles as string[]).includes('staff'),visitors:await accessRoster(db,resource.resourceId,resource.projectId)};
};
/** Delivered access handlers. `access.prepareRole`/`access.confirmRole` stay unregistered (`unavailable`): owner role
 * changes go only through the recent-sign-in Chat reviews `accessRoleReview`/`accessRoleApply`. */
export const accessHandlers:ModuleHandlers=Object.freeze({'access.me':me,'access.list':list});

/** `access.roles@1`: staff roster for each registered access instance of one owned project. Identity and ownership
 * only, so owners can always read and revoke after plan loss; granting re-checks core.editing inclusion. */
export async function readAccessRoles(db:D1Database,user:string,project:string):Promise<AccessRoleFacts>{
 if(!uuid(project)||!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new ModuleError('not_found','Project not found.');
 const items:AccessRoleFacts['items']=[];
 for(const row of (await registeredInstances(db,project)).filter(r=>r.kind==='access').slice(0,8)){
  const state=await db.prepare('SELECT revision FROM module_access_states WHERE instance_id=?').bind(row.id).first<{revision:number}>();
  if(!state||row.state===null)continue;
  items.push({localId:row.local_id,resourceId:row.id,state:row.state as AccessRoleFacts['items'][number]['state'],configRevision:row.config_revision,accessRevision:state.revision,staffRole:declaresStaff(row.config_json),visitors:await accessRoster(db,row.id,project)});
 }
 return {items};
}

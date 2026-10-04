import {moduleCatalog} from '../project-specification/catalog';
import {validateSpecification} from '../project-specification/v3/schema';
import {moduleKinds,type ModuleInstance,type ModuleKind,type ModulePin} from '../project-specification/v3/modules';
import {jsonDigest,SpecificationError} from '../project-specification/v2/json';
import {featurePredicate} from '../feature-admission';
import {featureRequest} from '../feature-inclusion';
import {ModuleError,type ModulePrincipal} from './policy';
import type {ModuleInstanceFacts} from './shape';
import {collectionsExportHook} from './collections';
import {accessRolesExportHook} from './access-export';
import {filesExportHook,recordsExportHook} from './export-hooks';

/** WH-125 instance registry and scoped resolver. Deterministic: no inference, provider or network access.
 * The trusted module catalog, the saved specification and the registry rows are the only inputs. */
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export const moduleFeature=(kind:ModuleKind)=>kind==='records'?'core.forms' as const:'core.editing' as const;
export type CatalogState='available'|'withdrawn'|'stale';
/** Exact current pins only: another digest is stale, a withdrawn kind is unavailable; never a fallback. */
export function catalogState(kind:ModuleKind,moduleDigest:string,schemaDigest:string):CatalogState{
 const entry=moduleCatalog.find(row=>row.kind===kind);
 if(!entry||entry.state!=='available')return 'withdrawn';
 return entry.module.digest===moduleDigest&&entry.schema.digest===schemaDigest&&entry.module.version===1&&entry.schema.version===1?'available':'stale';
}
export const pin=(kind:ModuleKind,part:'module'|'schema',digest:string):ModulePin=>({name:moduleKinds[kind][part],version:1,digest});

/** WH-071 descriptor v1 for one registered instance. Logical references only: no owner identifier, physical
 * locator or secret. A kind without a delivered export serializer keeps every data set `excluded` and no export hook.
 * WH-129: the content kind's `directories` data set is eligible project data exported by `collectionsExportHook`
 * (the existing `whumpo-directory` v1 serializer). WH-126: the access kind's `project-roles` data set is exported by
 * `accessRolesExportHook`; its `visitor-identity` data set is visitor-subject data exported only with the visitor's own
 * separate approval (their account export). WH-127/128: the records kind's `module-records` and the files kind's
 * `module-files` data sets are visitor-subject data exported by `recordsExportHook` and `filesExportHook` under WH-077's
 * separate approval (owner-run serializers, optionally limited to one visitor's own records or uploads). */
const exportHooks:{[K in ModuleKind]:string|null}={content:collectionsExportHook,records:recordsExportHook,files:filesExportHook,access:accessRolesExportHook};
export function moduleDescriptor(projectId:string,resourceId:string,instance:ModuleInstance,dependencies:{resourceId:string;module:ModulePin}[]){
 const subjects:Record<string,'project'|'visitor'>={directories:'project','module-records':'visitor','module-files':'visitor','visitor-identity':'visitor','project-roles':'project'};
 const exportHook=exportHooks[instance.kind];
 return {contractVersion:1,ref:{projectId,resourceId},kind:instance.kind,module:instance.module,schema:instance.schema,
  ownership:{data:moduleKinds[instance.kind].lifecycleClasses.map(classId=>({id:classId,classId,subject:subjects[classId],export:!exportHook?'excluded':subjects[classId]==='visitor'?'separate-approval':'eligible'})),assets:[]},
  dependencies:dependencies.map(d=>({ref:{projectId,resourceId:d.resourceId},module:d.module})),
  lifecycle:{exportFormat:1,exportHook,deleteHook:'project-cascade',restoreHook:'unsupported',migrateHook:'migration-required',portability:'platform-only'}};
}

export type CurrentSpecification={versionId:string;revision:number;digest:string;instances:ModuleInstance[];pages:{id:string;path:string}[]};
/** The owned project's current saved specification head, revalidated against its saved digest. */
export async function currentSpecification(db:D1Database,user:string,project:string):Promise<CurrentSpecification|null>{
 if(!uuid(project))throw new ModuleError('invalid_request','Choose an owned project.');
 const row=await db.prepare('SELECT p.id,h.version_id,h.revision,v.spec_json,v.spec_digest FROM projects p LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=p.id WHERE p.id=? AND p.owner_user_id=?')
  .bind(project,user).first<{id:string;version_id:string|null;revision:number|null;spec_json:string|null;spec_digest:string|null}>();
 if(!row)throw new ModuleError('not_found','Project not found.');
 if(!row.version_id||!row.spec_json||!row.spec_digest||row.revision===null)return null;
 try{
  const spec=validateSpecification(JSON.parse(row.spec_json));
  if(await jsonDigest(spec)!==row.spec_digest)throw new ModuleError('unavailable','The saved website configuration failed its integrity check.');
  return {versionId:row.version_id,revision:row.revision,digest:row.spec_digest,instances:spec.instances,pages:spec.pages.map(p=>({id:p.id,path:p.path}))};
 }catch(error){
  if(error instanceof SpecificationError||error instanceof SyntaxError)throw new ModuleError('unavailable','The saved website configuration is not current.');
  throw error;
 }
}

export type RegistryRow={id:string;project_id:string;local_id:string;kind:ModuleKind;module_digest:string;schema_digest:string;config_json:string;config_digest:string;descriptor_digest:string;dependencies_json:string;config_revision:number;source_version_id:string;source_spec_digest:string;descriptor_json:string;state:string|null;activation_revision:number|null;updated_at:number};
const columns='i.id,i.project_id,i.local_id,i.kind,i.module_digest,i.schema_digest,i.config_json,i.config_digest,i.descriptor_digest,i.dependencies_json,i.config_revision,i.source_version_id,i.source_spec_digest,i.descriptor_json,i.updated_at,a.state,a.revision activation_revision';
export async function instanceOf(row:RegistryRow):Promise<ModuleInstance>{
 const config=JSON.parse(row.config_json);
 if(await jsonDigest(config)!==row.config_digest)throw new ModuleError('unavailable');
 return {id:row.local_id,kind:row.kind,module:pin(row.kind,'module',row.module_digest),schema:pin(row.kind,'schema',row.schema_digest),dependencies:[],config} as ModuleInstance;
}
export async function registeredInstances(db:D1Database,project:string){
 return (await db.prepare(`SELECT ${columns} FROM module_instances i LEFT JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? ORDER BY i.local_id LIMIT 64`).bind(project).all<RegistryRow>()).results;
}
/** Active dependencies, and (WH-014) no safety hold on the website configuration this instance or a dependency was
 * activated from: a later hold stops visitor, staff and public serving; owner reads, export and disable stay open. */
async function dependenciesActive(db:D1Database,row:RegistryRow){
 return !!await db.prepare(`SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) d WHERE NOT EXISTS(SELECT 1 FROM module_instances x JOIN module_activations a ON a.instance_id=x.id WHERE x.id=d.value AND x.project_id=? AND a.state='active' AND NOT EXISTS(SELECT 1 FROM project_spec_held h WHERE h.version_id=x.source_version_id)))
  AND NOT EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=?)`).bind(row.dependencies_json,row.project_id,row.source_version_id).first();
}

export type ResolvedResource={resourceId:string;projectId:string;localId:string;kind:ModuleKind;instance:ModuleInstance;configRevision:number;activationRevision:number;state:string;moduleDigest:string;schemaDigest:string};
/** `resolveResource(verifiedContext, ref, expected)` (WH-071). The principal is server-derived; a foreign or
 * missing resource is one generic `not_found`. Withdrawn/stale pins and a different configRevision fail before
 * any handler runs. Visitor/staff/public principals additionally require an active instance and dependencies;
 * owners keep reads, export, removal and revocation in every activation state. The committing statement
 * repeats these checks (`module_request_admit`). */
export async function resolveResource(db:D1Database,principal:ModulePrincipal,resourceId:string,configRevision:number):Promise<ResolvedResource>{
 if(!uuid(resourceId)||!uuid(principal.projectId))throw new ModuleError('not_found');
 const owner=principal.kind==='owner';
 const row=await db.prepare(`SELECT ${columns} FROM module_instances i JOIN projects p ON p.id=i.project_id JOIN module_activations a ON a.instance_id=i.id WHERE i.id=? AND i.project_id=?${owner?' AND p.owner_user_id=?':''}`)
  .bind(...[resourceId,principal.projectId,...(owner?[principal.userId]:[])]).first<RegistryRow>();
 if(!row||row.state===null||row.activation_revision===null)throw new ModuleError('not_found');
 const catalog=catalogState(row.kind,row.module_digest,row.schema_digest);
 if(catalog==='withdrawn')throw new ModuleError('unavailable');
 if(catalog==='stale')throw new ModuleError('stale_module_version');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 if(!owner&&(row.state!=='active'||!await dependenciesActive(db,row)))throw new ModuleError('unavailable');
 return {resourceId:row.id,projectId:row.project_id,localId:row.local_id,kind:row.kind,instance:await instanceOf(row),configRevision:row.config_revision,activationRevision:row.activation_revision,state:row.state,moduleDigest:row.module_digest,schemaDigest:row.schema_digest};
}

/** `module.instances@1`: owner status of configured and registered instances. Identity and ownership only,
 * so read/export/disable outlive plan loss; `canActivate` is informational and the activation handlers
 * re-evaluate inclusion. Counts and states only: no configuration value or visitor-submitted value. */
export async function readModuleInstances(db:D1Database,user:string,project:string):Promise<ModuleInstanceFacts>{
 let spec:CurrentSpecification|null=null,specification:'current'|'none'|'unavailable'='none';
 try{spec=await currentSpecification(db,user,project);specification=spec?'current':'none';}
 catch(error){if(!(error instanceof ModuleError)||error.code!=='unavailable')throw error;specification='unavailable';}
 const rows=await registeredInstances(db,project),include:Record<string,boolean>={};
 for(const feature of ['core.forms','core.editing'] as const){
  const gate=featurePredicate(db,featureRequest({userId:user,projectId:project,featureId:feature,operation:'prepare'}));
  include[feature]=!!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first();
 }
 const ids=[...new Set([...(spec?.instances.map(i=>i.id)??[]),...rows.map(r=>r.local_id)])].sort().slice(0,32),items:ModuleInstanceFacts['items']=[];
 for(const localId of ids){
  const configured=spec?.instances.find(i=>i.id===localId),row=rows.find(r=>r.local_id===localId),kind=(row?.kind??configured!.kind) as ModuleKind;
  const catalog=row?catalogState(row.kind,row.module_digest,row.schema_digest):catalogState(configured!.kind,configured!.module.digest,configured!.schema.digest);
  const state=(row?.state??'unregistered') as ModuleInstanceFacts['items'][number]['state'];
  items.push({localId,kind,resourceId:row?.id??null,state,serving:!!row&&state==='active'&&catalog==='available'&&await dependenciesActive(db,row),configRevision:row?.config_revision??null,
   inSpecification:!!configured,configChanged:!!row&&!!configured&&(row.kind!==configured.kind||await jsonDigest(configured.config)!==row.config_digest),catalog,canActivate:include[moduleFeature(kind)]});
 }
 return {specification,specificationRevision:spec?.revision??null,items};
}

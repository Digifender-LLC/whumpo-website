import {compilerCatalog,moduleCatalog} from '../project-specification/catalog';
import {assertCompilerAvailable} from '../project-specification/compiler';
import {SpecificationError,jsonDigest} from '../project-specification/v2/json';
import {DirectoryError,directoryAction,exportDirectory,publicDirectory} from '../directory';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import type {ModuleHandlers,ModuleReadHandler} from './api';

/** WH-129 content collections module (docs/shared-modules.md#content-collections-module-wh-129--october-4-2026-utc).
 * A `content` instance has exactly one `directory-listing@1` collection, and a project has at most one content instance,
 * so the instance is the project's directory: `directories`, `directory_reviews` and `directory_exports` stay its only
 * storage and the existing exact draft, publication, restore and export reviews stay its only owner write path. This file
 * adds the module envelope's public read and the descriptor's export/restore hooks over the same directory functions;
 * it adds no table, module mutation operation, staff path or second serializer. Deterministic: no inference, provider, network or Chat history. */
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

/** `collections.readPublic` (`target: {collectionId}`, `input: null`). Returns only the approved public snapshot that the
 * directory publication review exposed (the same reader as the public directory page and JSON), never the private draft,
 * revision or review history. Unpublished, offline or parent-publication-invalidated directories are `unavailable`. */
const readPublic:ModuleReadHandler=async(db,context)=>{
 const instance=context.resource.instance,target=context.request.target;
 if(instance.kind!=='content')throw new ModuleError('not_found');
 if(!exact(target,['collectionId'])||context.request.input!==null)throw new ModuleError('invalid_request');
 const collection=instance.config.collections.find(x=>x.id===target.collectionId);
 if(!collection)throw new ModuleError('not_found');
 let snapshot:Awaited<ReturnType<typeof publicDirectory>>;
 try{snapshot=await publicDirectory(db,context.resource.projectId);}
 catch(error){if(error instanceof DirectoryError)throw new ModuleError('unavailable');throw error;}
 if(!snapshot)throw new ModuleError('unavailable','This collection is not published.');
 return {collectionId:collection.id,type:collection.type,name:snapshot.name,publishedAt:snapshot.publishedAt,listings:snapshot.listings};
};
export const collectionsHandlers:ModuleHandlers=Object.freeze({'collections.readPublic':readPublic});

/** Descriptor lifecycle hook ids for the content kind, resolved only from this maintained table (WH-071). */
export const collectionsExportHook='collections-directory-export-v1';
export const collectionsRestoreHook='collections-directory-restore-v1';

/** Export hook `collections-directory-export-v1`: one applied directory snapshot as the existing `whumpo-directory` v1
 * export (`exportDirectory`, also served by GET /api/projects/P/directory/snapshots/S/export), so the module export and
 * the directory download are one serializer. Owner only (current workspace identity and project ownership), in every
 * activation state and with the catalog pin withdrawn or restaged, as the contract keeps owner export intact; the
 * registered descriptor must name this hook and the caller's configRevision must be current. */
export async function exportCollectionSnapshot(db:D1Database,user:string,project:string,resourceId:string,configRevision:number,snapshotId:string){
 await assertWorkspace(db,user);
 const row=await db.prepare('SELECT i.kind,i.config_revision,i.descriptor_json FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE i.id=? AND i.project_id=? AND p.owner_user_id=?')
  .bind(resourceId,project,user).first<{kind:string;config_revision:number;descriptor_json:string}>();
 if(!row||row.kind!=='content')throw new ModuleError('not_found');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 if((JSON.parse(row.descriptor_json) as {lifecycle?:{exportHook?:unknown}}).lifecycle?.exportHook!==collectionsExportHook)throw new ModuleError('unavailable');
 try{return await exportDirectory(db,user,project,snapshotId);}
 catch(error){
  if(!(error instanceof DirectoryError))throw error;
  throw new ModuleError(error.status===404?'not_found':error.status===400?'invalid_request':'unavailable');
 }
}

/** Owner lifecycle restore hook prepares the existing exact applied-snapshot-to-private-draft review. It does not
 * import an arbitrary export, execute a module, publish or apply the review. Existing directory confirmation remains
 * the sole authority. Disabled modules retain owner recovery; withdrawn or stale pins require a current review. */
async function requireCollectionRestore(db:D1Database,user:string,project:string,resourceId:string,configRevision:number){
 await assertWorkspace(db,user);
 const row=await db.prepare(`SELECT i.kind,i.local_id,i.config_revision,i.config_json,i.config_digest,i.module_digest,i.schema_digest,i.descriptor_json,i.descriptor_digest,
  source.lock_json,head.spec_json current_spec_json,head.lock_json current_lock_json FROM module_instances i JOIN projects p ON p.id=i.project_id
  JOIN project_spec_versions source ON source.version_id=i.source_version_id AND source.project_id=i.project_id AND source.spec_digest=i.source_spec_digest
  JOIN project_spec_heads h ON h.project_id=i.project_id JOIN project_spec_versions head ON head.version_id=h.version_id AND head.project_id=i.project_id
  WHERE i.id=? AND i.project_id=? AND p.owner_user_id=?`)
  .bind(resourceId,project,user).first<{kind:string;local_id:string;config_revision:number;config_json:string;config_digest:string;module_digest:string;schema_digest:string;descriptor_json:string;descriptor_digest:string;lock_json:string;current_lock_json:string;current_spec_json:string}>();
 if(!row||row.kind!=='content')throw new ModuleError('not_found');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 const entry=moduleCatalog.find(i=>i.kind==='content');
 if(!entry||entry.state!=='available')throw new ModuleError('unavailable');
 if(row.module_digest!==entry.module.digest||row.schema_digest!==entry.schema.digest)throw new ModuleError('stale_module_version');
 try{assertCompilerAvailable(JSON.parse(row.lock_json),compilerCatalog);assertCompilerAvailable(JSON.parse(row.current_lock_json),compilerCatalog);}
 catch(error){if(error instanceof SpecificationError)throw new ModuleError(error.code==='COMPILER_LOCK_MISMATCH'?'stale_module_version':'unavailable');throw error;}
 const descriptor=JSON.parse(row.descriptor_json) as {lifecycle?:{restoreHook?:unknown}},config=JSON.parse(row.config_json);
 if(descriptor.lifecycle?.restoreHook!==collectionsRestoreHook||await jsonDigest(descriptor)!==row.descriptor_digest||await jsonDigest(config)!==row.config_digest)throw new ModuleError('unavailable');
 const saved=(JSON.parse(row.current_spec_json) as {instances:{id:string;kind:string;module:{digest:string};schema:{digest:string};config:unknown}[]}).instances.find(i=>i.id===row.local_id);
 if(!saved||saved.kind!=='content'||saved.module.digest!==row.module_digest||saved.schema.digest!==row.schema_digest||await jsonDigest(saved.config)!==row.config_digest)throw new ModuleError('stale_configuration');
}
/** Repeat the live catalog check at the actual confirmation boundary. Applied reviews are nonmutating receipts. */
export async function checkCollectionRestoreConfirmation(db:D1Database,user:string,reviewId:string){
 const row=await db.prepare("SELECT t.action_json FROM directory_reviews r JOIN chat_turns t ON t.id=r.id AND t.user_id=r.user_id WHERE r.id=? AND r.user_id=? AND r.status='pending' AND json_extract(t.action_json,'$.type')='collectionRestoreReview'")
  .bind(reviewId,user).first<{action_json:string}>();
 if(!row)return;
 const action=JSON.parse(row.action_json) as {projectId:string;resourceId:string;configRevision:number};
 await requireCollectionRestore(db,user,action.projectId,action.resourceId,action.configRevision);
}
export async function prepareCollectionRestore(db:D1Database,user:string,turn:string,project:string,resourceId:string,configRevision:number,snapshotId:string){
 await requireCollectionRestore(db,user,project,resourceId,configRevision);
 try{return await directoryAction(db,user,turn,{operation:'restore',projectId:project,snapshotId});}
 catch(error){if(!(error instanceof DirectoryError))throw error;throw new ModuleError(error.status===404?'not_found':error.status===400?'invalid_request':'unavailable');}
}
export async function prepareCollectionRestoreCommand(db:D1Database,user:string,turn:string,command:string){
 const match=/^\/review-directory-snapshot ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) ([1-9][0-9]{0,8}) ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
 if(!match)throw new ModuleError('invalid_request');
 return prepareCollectionRestore(db,user,turn,match[1],match[2],Number(match[3]),match[4]);
}

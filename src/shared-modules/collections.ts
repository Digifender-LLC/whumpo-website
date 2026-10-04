import {DirectoryError,exportDirectory,publicDirectory} from '../directory';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import type {ModuleHandlers,ModuleReadHandler} from './api';

/** WH-129 content collections module (docs/shared-modules.md#content-collections-module-wh-129--october-4-2026-utc).
 * A `content` instance has exactly one `directory-listing@1` collection, and a project has at most one content instance,
 * so the instance is the project's directory: `directories`, `directory_reviews` and `directory_exports` stay its only
 * storage and the existing exact draft, publication, restore and export reviews stay its only owner write path. This file
 * adds the module envelope's public read and the descriptor's export hook over the same directory functions; it has no
 * table, write, staff path or second serializer. Deterministic: no inference, provider, network or Chat history. */
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

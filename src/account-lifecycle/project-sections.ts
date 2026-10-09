/** WH-018/WH-187 shared per-project section reader. The account export (`whumpo-account-export-v1`, export.ts) and the
 * portable project bundle (`whumpo-portable-export` v1, portable.ts) both read a project's owner data through these
 * functions, so there is one implementation of each read: the saved specification head, the latest applied directory
 * snapshot (WH-129 serializer), the approved owner photo library (approved-only, size and digest re-checked after the
 * private read), the staff role list (WH-126 serializer) and the visitor-subject records/files pages (WH-127/WH-128
 * serializers). Every private object read, library photo or module file, is charged to the per-account export
 * allowance before the platform-wide ceiling.
 *
 * Every statement uses the caller's admitted workspace database and owner id; the serializers recheck the current
 * workspace identity and project ownership themselves. Nothing here reads credentials, sessions, recovery material,
 * provider tokens, safety cases/evidence/holds, scanner references or object keys beyond the private read itself. */
import {directoryHistory,exportDirectory} from '../directory';
import {approvedPhotoSQL,ownerLibrarySQL,photoBytesMatch} from '../photo-safety';
import {maxPhotoBytes} from '../photo-format';
import {reserveStorage,StorageLimitError} from '../storage-budget';
import {exportAccessRoles} from '../shared-modules/access-export';
import {exportRecords} from '../shared-modules/records-export';
import {exportFiles} from '../shared-modules/files-export';
import {ModuleError} from '../shared-modules/policy';
import {AccountLifecycleError} from './errors';

export type SectionEnv={DB:D1Database;FILES?:R2Bucket};
export type InstanceRow={id:string;project_id:string;local_id:string;kind:'content'|'records'|'files'|'access';config_revision:number;config_json:string;module_digest:string;schema_digest:string};

/** Per-account monthly export allowance (account_export_usage): 10 downloads and 5,000 photo reads per account, checked
 * before the platform-wide storage ceiling, so one account's repeated exports cannot exhaust shared photo capacity.
 * Account exports and portable bundles share it (docs/portable-exports.md decision 2, recommended option). */
export const exportDownloadsPerMonth=10,exportPhotoReadsPerMonth=5000;
export const allowanceMessage='This account reached its monthly export allowance. Try again after the monthly reset.';
export async function reserveExportPhotoRead(db:D1Database,user:string){
 const row=await db.prepare(`INSERT INTO account_export_usage(user_id,period,photo_reads) VALUES(?,strftime('%Y-%m','now'),1)
  ON CONFLICT(user_id,period) DO UPDATE SET photo_reads=photo_reads+1 WHERE photo_reads<${exportPhotoReadsPerMonth} RETURNING photo_reads`).bind(user).first();
 if(!row)throw new StorageLimitError(allowanceMessage);
 await reserveStorage(db,'read');
}

/** Registered module instances of the owner's projects (optionally one project), ordered by project then local id. */
export async function ownedInstances(db:D1Database,user:string,project?:string){
 return (await db.prepare(`SELECT i.id,i.project_id,i.local_id,i.kind,i.config_revision,i.config_json,i.module_digest,i.schema_digest FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE p.owner_user_id=?${project?' AND p.id=?':''} ORDER BY i.project_id,i.local_id`)
  .bind(...(project?[user,project]:[user])).all<InstanceRow>()).results;
}

export type SpecificationHead={revision:number;version_id:string;spec_json:string;spec_digest:string;lock_json:string;held:number};
/** The project's current saved specification head and whether that exact version is held (WH-014 `project_spec_held`). */
export async function specificationHead(db:D1Database,project:string){
 return db.prepare('SELECT h.revision,h.version_id,v.spec_json,v.spec_digest,v.lock_json,EXISTS(SELECT 1 FROM project_spec_held s WHERE s.version_id=h.version_id) held FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id WHERE h.project_id=?').bind(project).first<SpecificationHead>();
}

/** The latest applied directory snapshot through the WH-129 `whumpo-directory` v1 serializer, or null. */
export async function latestDirectory(db:D1Database,user:string,project:string){
 const history=await directoryHistory(db,user,project);
 return history.snapshots.length?exportDirectory(db,user,project,history.snapshots[0].id):null;
}

/** Owner library photos that are not exported because they are not currently cleared (pending, blocked, expired or held
 * approval, or not ready). One generic count; the reason is never distinguished. */
export async function withheldLibraryPhotos(db:D1Database,project:string){
 return (await db.prepare(`SELECT count(*) n FROM project_files f WHERE f.project_id=? AND ${ownerLibrarySQL} AND NOT (f.status='ready' AND ${approvedPhotoSQL})`).bind(project).first<{n:number}>())?.n??0;
}
export type LibraryPhoto={id:string;project_id:string;digest:string;size:number;width:number;height:number;created_at:string;bytes:Uint8Array};
/** Owner photo library: only ready photos whose exact digest is currently approved, read one at a time from private
 * storage after a per-account read reservation, size-checked and re-hashed. A missing or changed object fails closed.
 * `beforeRead` sees each stored size before anything is reserved or read (the portable bundle's size budget). */
export async function* approvedLibraryPhotos(env:SectionEnv,user:string,project:string,beforeRead?:(size:number)=>void):AsyncGenerator<LibraryPhoto>{
 const photos=(await env.DB.prepare(`SELECT f.id,f.project_id,f.object_key,f.digest,f.size,f.width,f.height,f.created_at FROM project_files f WHERE f.project_id=? AND f.status='ready' AND ${ownerLibrarySQL} AND ${approvedPhotoSQL} ORDER BY f.created_at,f.id`).bind(project).all<Omit<LibraryPhoto,'bytes'>&{object_key:string}>()).results;
 for(const f of photos){
  if(!env.FILES)throw new AccountLifecycleError(503,'closure_unavailable','Photo storage is unavailable. Try the export again later.');
  if(f.size>maxPhotoBytes)throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');
  beforeRead?.(f.size);
  await reserveExportPhotoRead(env.DB,user);
  const object=await env.FILES.get(f.object_key);
  if(!object||object.size!==f.size){await object?.body.cancel();throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');}
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(!await photoBytesMatch(bytes,f.digest))throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');
  yield {id:f.id,project_id:f.project_id,digest:f.digest,size:f.size,width:f.width,height:f.height,created_at:f.created_at,bytes};
 }
}

/** The access instance's staff role list (WH-126 `whumpo-access-roles` v1), or null before the instance has state. */
export async function accessRolesSection(db:D1Database,user:string,project:string,instance:InstanceRow){
 if(!await db.prepare('SELECT 1 FROM module_access_states WHERE instance_id=?').bind(instance.id).first())return null;
 return exportAccessRoles(db,user,project,instance.id,instance.config_revision);
}

/** Schema (records) or collection (files) ids of a visitor-subject instance, in configuration order. */
export function datasetTargets(instance:InstanceRow){
 const list=(JSON.parse(instance.config_json) as Record<string,unknown>)[instance.kind==='records'?'schemas':'collections'];
 return Array.isArray(list)?list.map(x=>(x as {id:string}).id).filter(x=>typeof x==='string'):[];
}
export type RecordsPage=Awaited<ReturnType<typeof exportRecords>>;
export type FilesPage=Awaited<ReturnType<typeof exportFiles>>;
/** Serializer pages of one visitor-subject data set (WH-127 records, WH-128 files), following the opaque cursor up to
 * `maxPages`. `complete` is false when more pages remain; each caller decides how its own bound fails closed. Every
 * module file read is charged to the per-account photo allowance before the platform-wide ceiling, like a library photo
 * (`reserveRead` replaces that reservation; the portable bundle adds its size budget). With `each`, pages are handed
 * over one at a time and not retained. */
export async function visitorDatasetPages(env:SectionEnv,user:string,project:string,instance:InstanceRow,target:string,maxPages:number,
 {reserveRead=()=>reserveExportPhotoRead(env.DB,user),each}:{reserveRead?:(size:number)=>Promise<void>;each?:(page:RecordsPage|FilesPage)=>void}={}){
 const pages:(RecordsPage|FilesPage)[]=[];let after:string|null=null,read=0;
 do{
  let page:RecordsPage|FilesPage;
  try{
   page=instance.kind==='records'
    ?await exportRecords(env.DB,user,project,instance.id,instance.config_revision,{recordId:target,after})
    :await exportFiles(env.DB,env.FILES as R2Bucket,user,project,instance.id,instance.config_revision,{collectionId:target,after,reserveRead});
  }catch(error){
   // An exhausted read allowance is the same refusal as for a library photo, not a stale export section.
   if(error instanceof ModuleError&&error.code==='limited')throw new StorageLimitError(allowanceMessage);
   throw error;
  }
  read++;if(each)each(page);else pages.push(page);after=page.next;
 }while(after&&read<maxPages);
 return {pages,complete:!after};
}

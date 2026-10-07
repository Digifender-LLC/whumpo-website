import {hashToken} from '../security';
import {jsonDigest,plain} from '../project-specification/v2/json';
import {approvedPhotoSQL,photoBytesMatch} from '../photo-safety';
import {maxPhotoBytes} from '../photo-format';
import {reserveStorage,StorageLimitError} from '../storage-budget';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {instanceOf,type RegistryRow} from './registry';
import {filesExportHook} from './export-hooks';

/** WH-128 files descriptor export hook `files-export-v1` (WH-071 lifecycle; WH-077 composes it, no route serves it).
 * It serializes the eligible files of one collection of one files instance: only ready files whose exact digest has a
 * current safety approval, newest first, 8 per page with an opaque cursor, each with its cleaned JPEG bytes after a size
 * check and a SHA-256 re-hash against the approved digest. Held and blocked files are never exported; the page reports
 * only how many were withheld. No object key, bucket, file name, scanner reference or safety receipt leaves the server.
 * With `visitorId` it is limited to that visitor's own uploads, the visitor-subject slice WH-077 hands out only under
 * its separate approval (`module-files` stays `separate-approval` in the descriptor). Deterministic: no inference,
 * provider, network or Chat history. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const local=/^[a-z][a-z0-9-]{0,39}$/;
const pageSize=8;
type Row={id:string;object_key:string;digest:string;size:number;width:number;height:number;created_at:string;module_created_at:number;uploader_kind:'owner'|'staff'|'visitor';visitor_id:string|null};
type ExportFile={fileId:string;uploadedBy:'owner'|'staff'|'visitor';visitorId:string|null;mediaType:'image/jpeg';width:number;height:number;size:number;sha256:string;createdAt:string;bytes:string};
export type FilesExportOptions={collectionId:string;visitorId?:string|null;after?:string|null};
const base64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);};
const unbase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
type Cursor={v:1;k:string;c:number;t:number;i:string};
const encode=(c:Cursor)=>btoa(JSON.stringify(c)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
function decode(value:unknown):Cursor|null{
 if(value===null)return null;
 if(typeof value!=='string'||value.length>400||!/^[A-Za-z0-9_-]+$/.test(value))throw new ModuleError('invalid_request');
 try{
  const c=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
  if(plain(c)&&Object.keys(c).sort().join()==='c,i,k,t,v'&&c.v===1&&typeof c.k==='string'&&Number.isSafeInteger(c.c)&&Number.isSafeInteger(c.t)&&typeof c.i==='string'&&uuid.test(c.i))return c as Cursor;
 }catch{/* malformed */}
 throw new ModuleError('invalid_request');
}

/** Owner only (current workspace identity and project ownership), in every activation state and with the catalog pin
 * withdrawn or restaged; the registered descriptor must name this hook and the caller's configRevision must be current.
 * `files` is the receiving Worker's private R2 binding; a stored object that no longer matches its approved digest fails
 * the export (`unavailable`) instead of being skipped or served. */
export async function exportFiles(db:D1Database,files:R2Bucket,user:string,project:string,resourceId:string,configRevision:number,options:FilesExportOptions,beforeRead?:()=>Promise<void>){
 await assertWorkspace(db,user);
 const subject=options.visitorId??null;
 if(!uuid.test(project)||!uuid.test(resourceId))throw new ModuleError('not_found');
 if(typeof options.collectionId!=='string'||!local.test(options.collectionId)||subject!==null&&(typeof subject!=='string'||!uuid.test(subject)))throw new ModuleError('invalid_request');
 const row=await db.prepare(`SELECT i.id,i.project_id,i.local_id,i.kind,i.module_digest,i.schema_digest,i.config_json,i.config_digest,i.config_revision,i.descriptor_json FROM module_instances i JOIN projects p ON p.id=i.project_id
  WHERE i.id=? AND i.project_id=? AND p.owner_user_id=?`).bind(resourceId,project,user).first<RegistryRow>();
 if(!row||row.kind!=='files')throw new ModuleError('not_found');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 if((JSON.parse(row.descriptor_json) as {lifecycle?:{exportHook?:unknown}}).lifecycle?.exportHook!==filesExportHook)throw new ModuleError('unavailable');
 const instance=await instanceOf(row);if(instance.kind!=='files')throw new ModuleError('not_found');
 const collection=instance.config.collections.find(c=>c.id===options.collectionId);if(!collection)throw new ModuleError('not_found');
 if(subject&&!await db.prepare('SELECT 1 FROM app_visitors WHERE id=? AND project_id=?').bind(subject,project).first())throw new ModuleError('not_found');
 const key=await jsonDigest(['files-export',resourceId,collection.id,user,subject??'']),cursor=decode(options.after??null);
 if(cursor&&(cursor.k!==key||cursor.c!==row.config_revision))throw new ModuleError('stale_configuration');
 const scope=`mf.instance_id=? AND mf.project_id=? AND mf.collection_id=? AND f.status='ready'${subject?' AND mf.visitor_id=?':''}`,params=[resourceId,project,collection.id,...(subject?[subject]:[])];
 const {results}=await db.prepare(`SELECT f.id,f.object_key,f.digest,f.size,f.width,f.height,f.created_at,mf.created_at module_created_at,mf.uploader_kind,mf.visitor_id FROM module_files mf
  JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id WHERE ${scope} AND ${approvedPhotoSQL}${cursor?' AND (mf.created_at<? OR mf.created_at=? AND mf.file_id<?)':''}
  ORDER BY mf.created_at DESC,mf.file_id DESC LIMIT ?`).bind(...params,...(cursor?[cursor.t,cursor.t,cursor.i]:[]),pageSize+1).all<Row>();
 const withheld=(await db.prepare(`SELECT count(*) n FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id WHERE ${scope} AND NOT ${approvedPhotoSQL}`).bind(...params).first<{n:number}>())?.n??0;
 const out:ExportFile[]=[];
 for(const r of results.slice(0,pageSize)){
  if(r.size>maxPhotoBytes)throw new ModuleError('unavailable','A file could not be verified.');
  // A composed account export adds its account allowance before this unavoidable shared storage reservation.
  try{await beforeRead?.();await reserveStorage(db,'read');}catch(error){if(error instanceof StorageLimitError)throw new ModuleError('limited');throw error;}
  const object=await files.get(r.object_key);
  if(!object)throw new ModuleError('unavailable','A file could not be verified.');
  if(object.size!==r.size){await object.body.cancel();throw new ModuleError('unavailable','A file could not be verified.');}
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(!await photoBytesMatch(bytes,r.digest))throw new ModuleError('unavailable','A file could not be verified.');
  out.push({fileId:r.id,uploadedBy:r.uploader_kind,visitorId:r.visitor_id,mediaType:'image/jpeg',width:r.width,height:r.height,size:r.size,sha256:r.digest,createdAt:r.created_at,bytes:base64(bytes)});
 }
 const last=results.length>pageSize?results[pageSize-1]:null;
 return {format:'whumpo-module-files',schemaVersion:1,project:{id:project},
  instance:{resourceId,localId:row.local_id,configRevision:row.config_revision},collection:{collectionId:collection.id,read:collection.read},
  subject:subject?{visitorId:subject}:null,files:out,withheld,next:last?encode({v:1,k:key,c:row.config_revision,t:last.module_created_at,i:last.id}):null,
  filesSha256:await hashToken(JSON.stringify(out))};
}

/** Import validation for `whumpo-module-files` v1: exact wrapper and file shapes, uploader identity, subject scope, each
 * file's bytes (a JPEG start marker, the declared size within 1 MiB and the declared SHA-256) and the files SHA-256. It
 * validates only; nothing imports files (a restore re-admits bytes through the current upload path and safety gate). */
export async function validateFilesExport(value:unknown){
 const fail=():never=>{throw new ModuleError('invalid_request','This is not a current Whumpo files export.');};
 const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
 const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=1;
 const time=(v:unknown)=>typeof v==='string'&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
 if(!exact(value,['format','schemaVersion','project','instance','collection','subject','files','withheld','next','filesSha256'])||value.format!=='whumpo-module-files'||value.schemaVersion!==1)return fail();
 const {project,instance,collection,subject,files}=value;
 if(!exact(project,['id'])||typeof project.id!=='string'||!uuid.test(project.id))return fail();
 if(!exact(instance,['resourceId','localId','configRevision'])||typeof instance.resourceId!=='string'||!uuid.test(instance.resourceId)||typeof instance.localId!=='string'||!local.test(instance.localId)||!count(instance.configRevision))return fail();
 if(!exact(collection,['collectionId','read'])||typeof collection.collectionId!=='string'||!local.test(collection.collectionId)||!['owner','staff','submitter'].includes(collection.read as string))return fail();
 if(subject!==null&&(!exact(subject,['visitorId'])||typeof subject.visitorId!=='string'||!uuid.test(subject.visitorId)))return fail();
 if(!Number.isSafeInteger(value.withheld)||(value.withheld as number)<0)return fail();
 if(value.next!==null&&(typeof value.next!=='string'||value.next.length>400||!/^[A-Za-z0-9_-]+$/.test(value.next)))return fail();
 if(!Array.isArray(files)||files.length>pageSize)return fail();
 const seen=new Set<string>();
 for(const f of files as unknown[]){
  if(!exact(f,['fileId','uploadedBy','visitorId','mediaType','width','height','size','sha256','createdAt','bytes'])||typeof f.fileId!=='string'||!uuid.test(f.fileId)||seen.has(f.fileId)
   ||!['owner','staff','visitor'].includes(f.uploadedBy as string)||(f.uploadedBy==='owner')!==(f.visitorId===null)||f.visitorId!==null&&(typeof f.visitorId!=='string'||!uuid.test(f.visitorId))
   ||subject!==null&&f.visitorId!==subject.visitorId||f.mediaType!=='image/jpeg'||!count(f.width)||!count(f.height)||!count(f.size)||(f.size as number)>maxPhotoBytes
   ||typeof f.sha256!=='string'||!/^[0-9a-f]{64}$/.test(f.sha256)||!time(f.createdAt)||typeof f.bytes!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.bytes))return fail();
  seen.add(f.fileId);
  let bytes:Uint8Array;try{bytes=unbase64(f.bytes);}catch{return fail();}
  if(bytes.length!==f.size||bytes[0]!==0xff||bytes[1]!==0xd8||!await photoBytesMatch(bytes,f.sha256))return fail();
 }
 if(typeof value.filesSha256!=='string'||await hashToken(JSON.stringify(files))!==value.filesSha256)return fail();
 return {projectId:project.id,resourceId:instance.resourceId,collectionId:collection.collectionId,subject:subject===null?null:subject.visitorId as string,files:files as ExportFile[],withheld:value.withheld as number,next:value.next as string|null};
}

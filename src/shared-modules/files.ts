import {FileError,cleanPhoto,maxPhotoBytes} from '../photo-format';
import {approvedPhotoSQL,photoBytesMatch,photoSafetySQL} from '../photo-safety';
import {reserveStorage,StorageLimitError} from '../storage-budget';
import {plain} from '../project-specification/v2/json';
import type {FilesConfig} from '../project-specification/v3/modules';
import {ModuleError,type ModulePrincipal} from './policy';
import type {ModuleContext,ModuleHandlers,ModuleReadHandler,ModuleWriteHandler} from './api';

/** WH-128 files and galleries module (docs/shared-modules.md#files-and-galleries-module-wh-128--october-4-2026-utc).
 * Deterministic handlers over the existing private project photo storage: a module upload is a `project_files` row
 * (cleaned JPEG up to 1 MiB, create-only private R2 object, project/account/platform quotas, pending safety receipt) plus
 * a `module_files` row naming its instance, collection and uploader. Upload authority is the collection's role policy
 * (policy.ts, the engine's receipt predicate and `module_file_admit`); names, object keys and prefixes are never
 * consulted, and object keys never leave the server. Reads and galleries return only files whose exact digest has a
 * current safety approval, and bytes are re-hashed on delivery. No inference, provider, model context or Chat history. */
type Collection=FilesConfig['collections'][number];
type FileRow={id:string;object_key:string;digest:string;size:number;width:number;height:number;created_at:string;uploader_kind:'owner'|'staff'|'visitor';safety:'pending'|'approved'|'blocked'};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const invalid=()=>new ModuleError('invalid_request');
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
const visitorOf=(p:ModulePrincipal)=>p.kind==='visitor'?p:null;

function collectionOf(context:ModuleContext,id:unknown):Collection{
 if(context.resource.instance.kind!=='files')throw new ModuleError('not_found');
 const collection=context.resource.instance.config.collections.find(c=>c.id===id);
 if(!collection)throw new ModuleError('not_found');
 return collection;
}
/** Defense in depth for the WH-124 validator: a gallery or read audience wider than the collection's read policy is
 * refused at serving time, never narrowed silently. */
function servable(collection:Collection){
 if(collection.gallery&&(collection.gallery.audience==='staff'?collection.read==='owner':collection.read!=='submitter'))throw new ModuleError('forbidden','This gallery is wider than its collection allows.');
}
/** Rows of one collection visible to the decision: owner all; staff all (collection read staff/submitter); a visitor
 * only their own uploads. Non-owners see only files with a current exact-digest approval. */
function scope(context:ModuleContext,collectionId:string){
 const visitor=visitorOf(context.principal),own=context.decision.scope==='own',owner=context.principal.kind==='owner';
 if(!owner&&!visitor)throw new ModuleError('forbidden');
 return {sql:`mf.instance_id=? AND mf.project_id=? AND mf.collection_id=? AND f.status='ready'${own?' AND mf.visitor_id=?':''}${owner?'':` AND ${approvedPhotoSQL}`}`,
  params:[context.resource.resourceId,context.resource.projectId,collectionId,...(own?[visitor!.visitorId]:[])] as unknown[]};
}
const columns=`f.id,f.object_key,f.digest,f.size,f.width,f.height,f.created_at,mf.uploader_kind,${photoSafetySQL} AS safety`;

/** files.putBytes — one bounded upload through the visitor origin's upload route (`POST /modules/upload`, JPEG body,
 * envelope in a header). Input declares the media type, byte length and SHA-256 of the sent bytes; the server checks
 * them, cleans the JPEG, checks the collection's byte bound, writes a create-only private object under a fresh
 * server-chosen key and commits the photo row (which writes the pending safety receipt) and the module row beside the
 * receipt. A lost acknowledgement reads the receipt back; an uncommitted object is removed by the orphan sweep. */
const putBytes:ModuleWriteHandler=async(db,context)=>{
 if(context.principal.kind==='owner')return fileOwnerPhoto(db,context);
 const visitor=visitorOf(context.principal);
 if(!visitor)throw new ModuleError('forbidden');
 if(!exact(context.request.target,['collectionId']))throw invalid();
 const collection=collectionOf(context,context.request.target.collectionId),input=context.request.input;
 if(!exact(input,['mediaType','byteLength','sha256'])||input.mediaType!=='image/jpeg'||!Number.isSafeInteger(input.byteLength)||Number(input.byteLength)<1
  ||Number(input.byteLength)>Math.min(collection.maxBytes,maxPhotoBytes)||typeof input.sha256!=='string'||!/^[0-9a-f]{64}$/.test(input.sha256))throw invalid();
 const {files,upload}=context.host;
 if(!files||!upload)throw new ModuleError('unavailable','Upload files through the module upload route.');
 if(upload.length!==input.byteLength||hex(await crypto.subtle.digest('SHA-256',upload))!==input.sha256)throw invalid();
 let photo:ReturnType<typeof cleanPhoto>;
 try{photo=cleanPhoto(upload);}catch(error){if(error instanceof FileError)throw invalid();throw error;}
 if(photo.bytes.length>collection.maxBytes)throw invalid();
 // The policy table already admitted this principal's role for the collection (staff when the visitor holds the role).
 const uploader=visitor.roles.length?'staff':'visitor';
 const project=context.resource.projectId,fileId=crypto.randomUUID(),key=`photos/${project}/${fileId}.jpg`,digest=hex(await crypto.subtle.digest('SHA-256',photo.bytes));
 // Early capacity answer before any object write; the project_files and module_files triggers decide inside the commit.
 const room=await db.prepare(`SELECT (SELECT count(*) FROM project_files WHERE project_id=?)<20 AND (SELECT count(*) FROM project_files f JOIN projects p ON p.id=f.project_id
  WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=?))<50 AND (SELECT count(*) FROM project_files)+(SELECT count(*) FROM file_cleanup)<500
  AND (SELECT count(*) FROM module_files WHERE visitor_id=? AND instance_id=? AND created_at>unixepoch()-3600)<10 ok`).bind(project,project,visitor.visitorId,context.resource.resourceId).first<{ok:number}>();
 if(!room?.ok)throw new ModuleError('limited');
 try{await reserveStorage(db,'write');}catch(error){if(error instanceof StorageLimitError)throw new ModuleError('limited');throw error;}
 const stored=await files.put(key,photo.bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/jpeg'},customMetadata:{sha256:digest}});
 if(!stored)throw new ModuleError('unresolved');
 const now=new Date();
 return {statements:[
  db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at,handoff_json) VALUES(?,?,?,?,?,?,?,?,'ready',?,'null')")
   .bind(fileId,project,`${uploader==='staff'?'Staff':'Visitor'} upload ${fileId.slice(0,8)}`,key,digest,photo.bytes.length,photo.width,photo.height,now.toISOString()),
  db.prepare('INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(fileId,context.resource.resourceId,project,collection.id,uploader,visitor.visitorId,context.request.requestId,Math.floor(now.getTime()/1000))
 ],result:{fileId,collectionId:collection.id,safety:'pending'}};
};

/** Owner `files.putBytes` (workspace origin, JSON route) — files one of the project's existing owner photos into an owner
 * collection (`upload` lists `owner`). The owner's bytes are already stored by the owner photo upload route (the only
 * owner byte path, with its Chat handoff, exact recovery, quotas and pending safety receipt), so the owner names one of
 * them by `fileId` and its exact `sha256` instead of sending bytes again: the collection reuses that `project_files` row
 * and object, with no second object, row or reservation. A photo belongs to at most one collection; module uploads by
 * staff or visitors can never be filed. Filing changes no safety state: galleries and publication still need the exact
 * digest approval. The photo stays in the owner's library (Chat, pickers and website photo pages); removing it with the
 * photo removal review removes it from the collection. `module_file_admit` repeats the active instance, the collection's
 * `owner` upload policy and a ready photo of the same project inside the commit. */
async function fileOwnerPhoto(db:D1Database,context:ModuleContext){
 const t=context.request.target,input=context.request.input;
 if(!exact(t,['collectionId'])||!exact(input,['fileId','sha256'])||!uuid(input.fileId)||typeof input.sha256!=='string'||!/^[0-9a-f]{64}$/.test(input.sha256))throw invalid();
 const collection=collectionOf(context,t.collectionId);
 if(!collection.upload.includes('owner'))throw new ModuleError('forbidden');
 const project=context.resource.projectId;
 const photo=await db.prepare(`SELECT f.id,f.digest,(SELECT mf.uploader_kind FROM module_files mf WHERE mf.file_id=f.id) filed,${photoSafetySQL} AS safety FROM project_files f JOIN projects p ON p.id=f.project_id
  WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.status='ready'`).bind(input.fileId,project,context.principal.kind==='owner'?context.principal.userId:'').first<{id:string;digest:string;filed:string|null;safety:'pending'|'approved'|'blocked'}>();
 // Another project's photo, a pending reservation and a staff/visitor module upload are one generic not_found.
 if(!photo||photo.filed!==null&&photo.filed!=='owner')throw new ModuleError('not_found');
 if(photo.digest!==input.sha256)throw invalid();
 if(photo.filed!==null)throw new ModuleError('invalid_request','This photo is already in a collection.');
 return {statements:[
  db.prepare("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,?,'owner',NULL,?,?)")
   .bind(photo.id,context.resource.resourceId,project,collection.id,context.request.requestId,Math.floor(Date.now()/1000))
 ],result:{fileId:photo.id,collectionId:collection.id,safety:photo.safety}};
}

/** files.gallery — the collection's files visible to the caller, newest first (50). Visitors and staff need the
 * collection's gallery; everyone except the owner sees approved files only; the owner also sees each file's safety state. */
const gallery:ModuleReadHandler=async(db,context)=>{
 const t=context.request.target;
 if(!exact(t,['collectionId'])||context.request.input!==null)throw invalid();
 const collection=collectionOf(context,t.collectionId),owner=context.principal.kind==='owner';
 if(!owner)servable(collection);
 const where=scope(context,collection.id);
 const {results}=await db.prepare(`SELECT ${columns} FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id WHERE ${where.sql} ORDER BY mf.created_at DESC,mf.file_id DESC LIMIT 50`).bind(...where.params).all<FileRow>();
 return {collectionId:collection.id,items:results.map(r=>({fileId:r.id,width:r.width,height:r.height,size:r.size,createdAt:r.created_at,uploadedBy:r.uploader_kind,...(owner?{safety:r.safety}:{})}))};
};

/** files.read — one file's bytes for the visitor origin (the gateway turns `bytes` into an image response). Every caller,
 * the owner included, gets only bytes whose exact digest has a current approval; the object is size-checked and
 * re-hashed against that digest before it is returned. */
const read:ModuleReadHandler=async(db,context)=>{
 const t=context.request.target;
 if(!exact(t,['collectionId','fileId'])||!uuid(t.fileId)||context.request.input!==null)throw invalid();
 const collection=collectionOf(context,t.collectionId);
 if(!context.host.files)throw new ModuleError('unavailable','Read files through the visitor origin.');
 const visitor=visitorOf(context.principal),own=context.decision.scope==='own';
 const row=await db.prepare(`SELECT ${columns} FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id
  WHERE mf.file_id=? AND mf.instance_id=? AND mf.project_id=? AND mf.collection_id=? AND f.status='ready'${own?' AND mf.visitor_id=?':''}`)
  .bind(t.fileId,context.resource.resourceId,context.resource.projectId,collection.id,...(own?[visitor!.visitorId]:[])).first<FileRow>();
 if(!row)throw new ModuleError('not_found');
 // Stored is not cleared: held and blocked files are never served or referenced.
 if(row.safety!=='approved')throw new ModuleError('unavailable','This file is held for safety checks.');
 try{await reserveStorage(db,'read');}catch(error){if(error instanceof StorageLimitError)throw new ModuleError('limited');throw error;}
 const object=await context.host.files.get(row.object_key);
 if(!object)throw new ModuleError('not_found');
 if(object.size!==row.size){await object.body.cancel();throw new ModuleError('unavailable','This file could not be verified.');}
 const bytes=new Uint8Array(await object.arrayBuffer());
 if(!await photoBytesMatch(bytes,row.digest))throw new ModuleError('unavailable','This file could not be verified.');
 return {fileId:row.id,bytes};
};

/** Delivered files handlers (WH-128). `files.putBytes` carries metadata with bytes in one visitor/staff request or names
 * an existing owner photo. Owner removal uses the existing exact photo removal review, including its safety holds and
 * saved-version checks. Dormant prepareUpload/requestRemoval names are not part of the current operation contract. */
export const filesHandlers:ModuleHandlers=Object.freeze({'files.putBytes':putBytes,'files.gallery':gallery,'files.read':read});

import {FileError,cleanPhoto,maxPhotoBytes} from './photo-format';
import {assertWorkspace} from './workspace-identity/admission';
import type {PhotoUploadStatus,PhotoHandoff} from './photo-upload-shape';
import {parsePhotoHandoff,admitPhotoHandoff,photoUploadGuards,closedPhotoHandoff} from './chat-interactions/photo-handoff';
import {approvedPhotoSQL,photoSafetySQL,photoBytesMatch} from './photo-safety';
import { reserveStorage, StorageLimitError } from './storage-budget';
async function bodyBytes(request:Request){
 if(request.headers.get('content-type')?.split(';')[0]!=='image/jpeg')throw new FileError(415,'Prepared JPEG photos are required');
 if(Number(request.headers.get('content-length'))>maxPhotoBytes)throw new FileError(413,'Photos must be at most 1 MiB');
 const reader=request.body?.getReader();if(!reader)throw new FileError(400,'Choose a photo');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maxPhotoBytes){await reader.cancel();throw new FileError(413,'Photos must be at most 1 MiB');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return bytes;
}
type FileRow={id:string;project_id:string;name:string;object_key:string;digest:string;size:number;width:number;height:number;status:'pending'|'ready';safetyStatus:'pending'|'approved'|'blocked';created_at:string;handoff_json:string};
export async function uploadPhoto(request:Request,env:Pick<Env,'DB'|'FILES'>,userId:string,projectId:string,id:string){
 await assertWorkspace(env.DB,userId);
 if(!(await env.DB.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,userId).first()))throw new FileError(404,'Project not found');
 const handoff=parsePhotoHandoff(request.headers.get('x-whumpo-photo-handoff')),handoffJSON=JSON.stringify(handoff);
 const prior=await env.DB.prepare('SELECT project_id,handoff_json FROM project_files WHERE id=?').bind(id).first<{project_id:string;handoff_json:string}>();
 if(prior&&(prior.project_id!==projectId||prior.handoff_json!==handoffJSON))throw new FileError(409,'This upload ID was already used for another photo or Chat handoff');
 await admitPhotoHandoff(env.DB,userId,projectId,handoff,!!prior);
 let name:string;try{name=decodeURIComponent(request.headers.get('x-photo-name')??'').trim();}catch{throw new FileError(400,'Invalid photo name');}
 if(!name||name.length>100||/[\x00-\x1f\x7f/\\]/.test(name))throw new FileError(400,'Use a photo name of 1 to 100 characters');
 const photo=cleanPhoto(await bodyBytes(request));
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',photo.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const key=`photos/${projectId}/${id}.jpg`;
 try{await env.DB.batch([...photoUploadGuards(env.DB,userId,projectId,handoff),env.DB.prepare('INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,created_at,handoff_json) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,projectId,name,key,digest,photo.bytes.length,photo.width,photo.height,new Date().toISOString(),handoffJSON)]);}
 catch(cause){if(/photo_handoff_changed|chat_interaction_changed/.test(String(cause)))throw new FileError(409,'The photo uploader or your project access changed. Check the original upload status before continuing.');if(String(cause).includes('photo_removal_replay'))throw new FileError(409,'This photo was removed. Choose a new upload to add it again.');if(String(cause).includes('file_cleanup_quota'))throw new FileError(409,'Photo storage is full or awaiting cleanup. Try again after the daily cleanup.');if(/file_.*_quota/.test(String(cause)))throw new FileError(409,'Photo test limit reached: 20 per project, 50 per account, 500 across the platform');throw cause;}
 const row=await env.DB.prepare(`SELECT f.*,${photoSafetySQL} AS safetyStatus FROM project_files f WHERE f.id=? AND f.project_id=?`).bind(id,projectId).first<FileRow>();
 if(!row||row.digest!==digest||row.name!==name||row.handoff_json!==handoffJSON)throw new FileError(409,'This upload ID was already used for another photo or Chat handoff');
 await env.DB.batch(photoUploadGuards(env.DB,userId,projectId,handoff));
 if(row.status==='ready')return {id:row.id,name:row.name,width:row.width,height:row.height,size:row.size,status:'ready',safetyStatus:row.safetyStatus};
 try{
  await reserveStorage(env.DB,'write');
  await env.DB.batch(photoUploadGuards(env.DB,userId,projectId,handoff));
  const stored=await env.FILES.put(key,photo.bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/jpeg'},customMetadata:{sha256:digest}});
  if(!stored){await reserveStorage(env.DB,'read');const existing=await env.FILES.head(key);if(existing?.customMetadata?.sha256!==digest||existing.size!==photo.bytes.length)throw Error('Object mismatch');}
  await env.DB.batch([
   ...photoUploadGuards(env.DB,userId,projectId,handoff),
   env.DB.prepare("UPDATE project_files SET status='ready' WHERE id=? AND project_id=? AND status='pending'").bind(id,projectId),
   env.DB.prepare("INSERT OR IGNORE INTO activity_events(id,user_id,project_id,action,summary,created_at) SELECT ?,?,project_id,'file.uploaded','Uploaded a private project photo',? FROM project_files WHERE id=? AND status='ready'").bind('file:'+id,userId,new Date().toISOString(),id)
  ]);
  if(!(await env.DB.prepare("SELECT id FROM project_files WHERE id=? AND status='ready'").bind(id).first()))throw Error('File reservation removed');
 }catch(cause){if(cause instanceof StorageLimitError)throw cause;throw new FileError(503,'Photo upload is awaiting confirmation. Retry the same photo to finish it safely.');}
 return {id:row.id,name:row.name,width:row.width,height:row.height,size:row.size,status:'ready',safetyStatus:row.safetyStatus};
}
export async function listPhotos(db:D1Database,userId:string,projectId:string){
 if(!(await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,userId).first()))throw new FileError(404,'Project not found');
 const {results}=await db.prepare(`SELECT f.id,f.name,f.size,f.width,f.height,f.status,f.created_at,${photoSafetySQL} AS safetyStatus,(SELECT COUNT(*) FROM version_photos WHERE file_id=f.id) AS saved_versions FROM project_files f WHERE f.project_id=? ORDER BY f.created_at DESC,f.id DESC LIMIT 50`).bind(projectId).all();return {files:results};
}
/** Readback of an exact private upload, including unconfirmed reservations. Never reads R2. */
export async function readPhotoUpload(db:D1Database,userId:string,projectId:string,id:string,handoff:PhotoHandoff|null=null):Promise<PhotoUploadStatus>{
 await assertWorkspace(db,userId);
 const owned=async()=>{if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,userId).first())throw new FileError(404,'Project not found');};
 const read=async()=>{
  const row=await db.prepare(`SELECT f.id,f.project_id AS projectId,f.name,f.digest,f.size,f.width,f.height,f.status,f.handoff_json,${photoSafetySQL} AS safetyStatus FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.project_id=? AND p.owner_user_id=?`).bind(id,projectId,userId).first<Omit<NonNullable<PhotoUploadStatus['photo']>,'handoff'>&{handoff_json:string}>();
  if(!row)return null;
  const {handoff_json,...photo}=row;return {...photo,handoff:parsePhotoHandoff(handoff_json)};
 };
 await owned();const first=await read(),closedHandoff=first?null:await closedPhotoHandoff(db,userId,projectId,handoff),photo=await read();
 if(JSON.stringify(first)!==JSON.stringify(photo))throw new FileError(409,'Photo status changed. Check again.');
 await owned();await assertWorkspace(db,userId);return {version:1,photo,closedHandoff};
}
export async function readPhoto(env:Pick<Env,'DB'|'FILES'>,userId:string,id:string){
 const row=await env.DB.prepare(`SELECT f.object_key,f.digest,f.size,${approvedPhotoSQL} AS approved FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_user_id=? AND f.status='ready'`).bind(id,userId).first<{object_key:string;digest:string;size:number;approved:number}>();
 if(!row)throw new FileError(404,'Photo not found');if(!row.approved)throw new FileError(423,'This photo is held for safety checks and cannot be displayed yet');await reserveStorage(env.DB,'read');const object=await env.FILES.get(row.object_key);if(!object)throw new FileError(404,'Photo not found');
 if(object.size!==row.size){await object.body.cancel();throw new FileError(503,'Photo could not be verified');}const bytes=new Uint8Array(await object.arrayBuffer());if(!await photoBytesMatch(bytes,row.digest))throw new FileError(503,'Photo could not be verified');
 return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(object.size),'content-disposition':'inline; filename="photo.jpg"','cache-control':'private, no-store','content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin'}});
}
/** Account/project removal queues object keys; late writes are caught by a bounded orphan sweep. */
export async function cleanupPhotos(env:Pick<Env,'DB'|'FILES'>,now=new Date()){
 const cutoff=new Date(now.getTime()-3600000).toISOString();
 const {results}=await env.DB.prepare('SELECT object_key FROM file_cleanup WHERE created_at<? LIMIT 100').bind(cutoff).all<{object_key:string}>();
 for(const row of results){await env.FILES.delete(row.object_key);await env.DB.prepare('DELETE FROM file_cleanup WHERE object_key=?').bind(row.object_key).run();}
 // Read at most 500 reservations once, avoiding one subrequest per listed object.
 const {results:active}=await env.DB.prepare('SELECT object_key FROM project_files').all<{object_key:string}>();
 const retained=new Set(active.map(row=>row.object_key));
 const listed=await env.FILES.list({prefix:'photos/',limit:1000});
 const orphaned=listed.objects.filter(object=>object.uploaded.toISOString()<cutoff&&!retained.has(object.key)).map(object=>object.key);
 if(orphaned.length)await env.FILES.delete(orphaned);
 // With at most 500 active objects, deleting orphans from each page makes progress on later runs.
}

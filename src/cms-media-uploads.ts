import {cmsConnection} from './cms-status';
import {callCMS,callSignedCMS} from './cms-bridge';
import {cmsCapabilitiesPath,supportsCMSUpload} from './cms-capability-contract';
import {signCMSMediaUpload} from './cms-media-upload-bridge';
import {cleanPhoto} from './photo-format';
import {CMSProjectError} from './cms-error';
import {cmsItemId} from './cms-content-shape';
import {cmsMediaMetadata} from './cms-media';
type Upload={id:string;user_id:string;project_id:string;origin:string;filename:string;digest:string;size:number;width:number;height:number;result:string|null;created_at:string;safety?:'approved'|'pending'|'blocked'};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const view=(row:Upload)=>({requestId:row.id,filename:row.filename,size:row.size,width:row.width,height:row.height,status:row.result?'saved':'unresolved',safety:row.safety??'pending',createdAt:row.created_at,result:row.result?JSON.parse(row.result):null});
// WH-013: every receipt starts held; only the trusted approved_cms_media view can report approval.
const uploadSQL="SELECT u.*,CASE WHEN EXISTS(SELECT 1 FROM approved_cms_media a WHERE a.upload_id=u.id) THEN 'approved' WHEN EXISTS(SELECT 1 FROM cms_media_safety s WHERE s.upload_id=u.id AND s.state='blocked') THEN 'blocked' ELSE 'pending' END AS safety FROM cms_media_uploads u";
export async function readCMSUploads(db:D1Database,user:string,project:string,env:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,env);let uploadEnabled=false;
 try{uploadEnabled=supportsCMSUpload(await callCMS(service,config,cmsCapabilitiesPath,crypto.randomUUID()));}catch{/* Old/unavailable native artifacts never enable uploads. */}
 const rows=await db.prepare(uploadSQL+' WHERE u.user_id=? AND u.project_id=? ORDER BY u.created_at DESC,u.id DESC LIMIT 20').bind(user,project).all<Upload>();
 return {projectId:project,uploadEnabled,maxBytes:1048576,maxDimension:1600,uploads:rows.results.map(view)};
}
/** Bytes are never stored in control D1 or copied to model context. */
export async function uploadCMSMedia(db:D1Database,user:string,project:string,id:string,bytes:Uint8Array,name:string,env:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,env);
 if(!uuid.test(id)||typeof name!=='string'||name.length>100||!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,95}\.jpe?g$/i.test(name))throw new CMSProjectError(400,'Choose a valid upload ID and a simple JPEG filename');
 let photo;try{photo=cleanPhoto(bytes);}catch{throw new CMSProjectError(400,'Use the image picker to prepare a JPEG no larger than 1 MiB and 1600 pixels per side');}
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(photo.bytes))),v=>v.toString(16).padStart(2,'0')).join('');
 const read=()=>db.prepare(uploadSQL+' WHERE u.id=?').bind(id).first<Upload>();let row=await read();
 if(row&&(row.user_id!==user||row.project_id!==project||row.origin!==config.origin||row.filename!==name||row.digest!==digest||row.size!==photo.bytes.length))throw new CMSProjectError(409,'This upload ID belongs to a different request. Re-select the original file to recover it.');
 if(row?.result)return view(row);
 let capable=false;try{capable=supportsCMSUpload(await callCMS(service,config,cmsCapabilitiesPath,crypto.randomUUID()));}catch{}
 if(!capable)throw new CMSProjectError(409,'Image upload is not available on this publishing space yet. An existing unresolved request keeps its reserved storage.');
 if(!row){
  try{await db.prepare('INSERT INTO cms_media_uploads(id,user_id,project_id,origin,filename,digest,size,width,height) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,user,project,config.origin,name,digest,photo.bytes.length,photo.width,photo.height).run();}catch{}
  row=await read();if(!row)throw new CMSProjectError(409,'CMS image storage is full or unavailable. Unresolved uploads keep their reserved space.');
  if(row.user_id!==user||row.project_id!==project||row.origin!==config.origin||row.filename!==name||row.digest!==digest||row.size!==photo.bytes.length)throw new CMSProjectError(409,'This upload ID belongs to another request');
 }
 if(!row.result){
  try{
   const data=await callSignedCMS(service,await signCMSMediaUpload(config,id,photo.bytes,name)),item=data?.item;
   if(!item||!cmsItemId.test(item.id??'')||item.status!=='ready'||item.mimeType!=='image/jpeg'||item.size!==photo.bytes.length||item.width!==photo.width||item.height!==photo.height)throw Error('Unconfirmed native upload');
   const projected=cmsMediaMetadata({items:[item],totalCount:1},1).items[0];
   const result=JSON.stringify({mediaId:projected.id,filename:projected.filename,mimeType:projected.mimeType,size:projected.size,width:projected.width,height:projected.height});
   await db.prepare('UPDATE cms_media_uploads SET result=? WHERE id=? AND result IS NULL').bind(result,id).run();
  }catch{/* An uncertain native write or lost local acknowledgment keeps its reservation. */}
  row=await read();
 }
 if(!row?.result)throw new CMSProjectError(503,'Upload outcome is unresolved. Retry this same request with the same prepared file; do not start a replacement upload.');
 return view(row);
}

/** Owner lookup precedes reading a bounded, timed request body. */
export async function uploadCMSMediaRequest(request:Request,db:D1Database,user:string,project:string,id:string,env:Record<string,unknown>){
 await cmsConnection(db,user,project,env);
 if(request.headers.has('content-encoding')||request.headers.get('content-type')!=='image/jpeg')throw new CMSProjectError(415,'Use a prepared JPEG image');
 let name:string;try{name=decodeURIComponent(request.headers.get('x-photo-name')??'');}catch{throw new CMSProjectError(400,'Invalid image filename');}
 if(Number(request.headers.get('content-length'))>1048576)throw new CMSProjectError(413,'Images must be at most 1 MiB');
 const reader=request.body?.getReader();if(!reader)throw new CMSProjectError(400,'Choose an image');
 let timer:ReturnType<typeof setTimeout>|undefined,size=0,complete=false;
 const chunks:Uint8Array[]=[];
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(new CMSProjectError(408,'Image upload timed out. Retry the same prepared image.'));void reader.cancel().catch(()=>{});},15000);});
 try{
  while(true){const part=await Promise.race([reader.read(),timeout]);if(part.done)break;size+=part.value.length;if(size>1048576)throw new CMSProjectError(413,'Images must be at most 1 MiB');chunks.push(part.value);}
  complete=true;
 }finally{if(timer!==undefined)clearTimeout(timer);if(!complete)void reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 return uploadCMSMedia(db,user,project,id,bytes,name,env);
}

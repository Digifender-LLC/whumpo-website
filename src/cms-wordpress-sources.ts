import {cmsConnection} from './cms-status';
import {CMSProjectError} from './cms-error';
import {reserveStorage} from './storage-budget';
export type CMSWordPressSource={id:string;user_id:string;project_id:string;filename:string;digest:string;size:number;state:'pending'|'ready';created_at:string};
const maxBytes=1048576,uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const cmsWordPressSourceKey=(row:Pick<CMSWordPressSource,'project_id'|'id'|'digest'>)=>`cms-wordpress-sources/${row.project_id}/${row.id}/${row.digest}.xml`;
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
const view=(row:CMSWordPressSource)=>({id:row.id,projectId:row.project_id,filename:row.filename,digest:row.digest,size:row.size,state:row.state,createdAt:row.created_at});
export async function readCMSWordPressSource(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT s.* FROM cms_wordpress_sources s JOIN projects p ON p.id=s.project_id WHERE s.id=? AND s.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<CMSWordPressSource>();
 if(!row)throw new CMSProjectError(404,'WordPress source was not found');return row;
}
async function verifiedBytes(db:D1Database,files:R2Bucket,row:CMSWordPressSource){
 await reserveStorage(db,'read');const object=await files.get(cmsWordPressSourceKey(row));if(!object)return null;
 if(object.size!==row.size||object.size>maxBytes){await object.body.cancel();throw new CMSProjectError(503,'Stored WordPress source could not be verified');}
 const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length!==row.size||await hash(bytes)!==row.digest)throw new CMSProjectError(503,'Stored WordPress source could not be verified');return bytes;
}
/** Returns raw untrusted source only to an authenticated owner path or a bounded parser. */
export async function captureCMSWordPressSource(db:D1Database,files:R2Bucket,user:string,id:string){
 const row=await readCMSWordPressSource(db,user,id);if(row.state!=='ready')throw new CMSProjectError(409,'Recover the original source upload before continuing');
 const bytes=await verifiedBytes(db,files,row);if(!bytes)throw new CMSProjectError(503,'The original source file needs recovery');return {source:view(row),bytes};
}
export async function uploadCMSWordPressSource(db:D1Database,files:R2Bucket,user:string,project:string,id:string,filename:string,bytes:Uint8Array,env:Record<string,unknown>){
 await cmsConnection(db,user,project,env);
 if(!uuid.test(id)||typeof filename!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,95}\.xml$/i.test(filename)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>maxBytes)throw new CMSProjectError(400,'Choose a named XML export up to 1 MiB');
 try{new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{throw new CMSProjectError(400,'Choose a UTF-8 XML export');}
 const digest=await hash(bytes);
 let record=await db.prepare('SELECT id FROM cms_wordpress_sources WHERE id=? OR (project_id=? AND digest=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1').bind(id,project,digest,id).first<{id:string}>();
 if(!record){try{await db.prepare('INSERT INTO cms_wordpress_sources(id,user_id,project_id,filename,digest,size) VALUES(?,?,?,?,?,?)').bind(id,user,project,filename,digest,bytes.length).run();}catch{}record=await db.prepare('SELECT id FROM cms_wordpress_sources WHERE project_id=? AND digest=?').bind(project,digest).first<{id:string}>();}
 if(!record)throw new CMSProjectError(409,'WordPress source storage is full or unavailable');
 let row=await readCMSWordPressSource(db,user,record.id);
 if(row.project_id!==project||row.digest!==digest||row.size!==bytes.length||row.id===id&&row.filename!==filename)throw new CMSProjectError(409,'This source upload ID belongs to a different file. Recover the original upload.');
 try{
  if(!await verifiedBytes(db,files,row)){
   await reserveStorage(db,'write');await files.put(cmsWordPressSourceKey(row),new Uint8Array(bytes),{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'},customMetadata:{sha256:digest}});
   if(!await verifiedBytes(db,files,row))throw Error('Missing source receipt');
  }
  if(row.state==='pending')await db.prepare("UPDATE cms_wordpress_sources SET state='ready' WHERE id=? AND state='pending'").bind(row.id).run();
 }catch{throw new CMSProjectError(503,'Source upload needs recovery. Retry the same file and request; a saved object will be verified before another upload.');}
 row=await readCMSWordPressSource(db,user,row.id);if(row.state!=='ready')throw new CMSProjectError(503,'Source receipt needs recovery');return view(row);
}
export async function listCMSWordPressSources(db:D1Database,user:string,project:string,env:Record<string,unknown>){
 await cmsConnection(db,user,project,env);return (await db.prepare('SELECT * FROM cms_wordpress_sources WHERE user_id=? AND project_id=? ORDER BY created_at DESC,id LIMIT 5').bind(user,project).all<CMSWordPressSource>()).results.map(view);
}
export async function downloadCMSWordPressSource(db:D1Database,files:R2Bucket,user:string,id:string){
 const {source,bytes}=await captureCMSWordPressSource(db,files,user,id);
 return new Response(new Uint8Array(bytes),{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${source.filename}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'referrer-policy':'no-referrer'}});
}

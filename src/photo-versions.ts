import {approvedPhotoSQL} from './photo-safety';
import {launchConfig,siteConfig,photoConfig,renderSite,renderPhotoPage,previewHeaders,type SiteConfig,type PhotoConfig} from './components';
import {hashToken} from './security';
import {FileError} from './files';
import {reserveStorage} from './storage-budget';
export type PageConfig=SiteConfig|PhotoConfig;
export const parsePage=(value:unknown):PageConfig=>value&&typeof value==='object'&&'photos' in value?photoConfig(value):siteConfig(value);
export function savedPage(component:string,json:string):PageConfig{
 const value=JSON.parse(json);
 if(component==='photo-page@1')return photoConfig(value);
 if(component==='site-page@1')return siteConfig(value);
 if(component!=='launch-page@1')throw Error('Unsupported saved component');
 const c=launchConfig(value);return {...c,headline:c.name,aboutTitle:'A little introduction.',aboutText:c.description||'More details are coming soon.',sections:[]};
}
export async function pageDraft(db:D1Database,userId:string,turnId:string,projectId:string,value:PageConfig,base:string|null,source:'ai'|'guided'){
 const config=parsePage(value),photos='photos' in config?config.photos:[],component='photos' in config?'photo-page@1':'site-page@1';
 for(const photo of photos)if(!(await db.prepare(`SELECT f.id FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL}`).bind(photo.id,projectId,userId).first()))throw new FileError(400,'Choose photos belonging to this project that have cleared safety checks');
 const html='photos' in config?renderPhotoPage(config):renderSite(config),digest=await hashToken(html),now=new Date().toISOString();
 return {reply:`I saved a private draft of “${config.name}”${photos.length?` with ${photos.length} photo${photos.length===1?'':'s'}`:''}. Open the preview below. Your live site is unchanged.`,statements:[
 db.prepare('INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source,base_version_id) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?) AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)').bind(turnId,projectId,component,JSON.stringify(config),html,digest,now,source,base,turnId,userId,projectId,userId),
 ...photos.map((p,n)=>db.prepare('INSERT INTO version_photos(version_id,file_id,position,alt) SELECT id,?,?,? FROM site_versions WHERE id=?').bind(p.id,n,p.alt,turnId)),
 db.prepare("INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) SELECT ?,?,project_id,'site.preview.created','Saved a private website draft',? FROM site_versions WHERE id=?").bind('draft:'+turnId,userId,now,turnId)
 ]};
}
export async function attachPhoto(db:D1Database,userId:string,turnId:string,fileId:string){
 const file=await db.prepare(`SELECT f.id,f.project_id,f.name,p.name AS project_name,p.purpose FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL}`).bind(fileId,userId).first<{id:string;project_id:string;name:string;project_name:string;purpose:string}>();
 if(!file)throw new FileError(404,'Photo is unavailable or has not cleared safety checks');
 const prior=await db.prepare('SELECT id,component_id,config_json FROM site_versions WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(file.project_id).first<{id:string;component_id:string;config_json:string}>();
 const base=prior?savedPage(prior.component_id,prior.config_json):{name:file.project_name,headline:file.project_name,description:file.purpose,theme:'ocean' as const,aboutTitle:'A little introduction.',aboutText:file.purpose||'More details are coming soon.',sections:[]};
 const photos='photos' in base?base.photos:[];
 if(photos.some(p=>p.id===file.id))return {reply:'That photo is already included in this project’s latest saved version. Use /versions to review it.',statements:[] as D1PreparedStatement[]};
 if(photos.length>=4)throw new FileError(409,'This page already has four photos. Ask the AI to replace or remove a photo first.');
 return pageDraft(db,userId,turnId,file.project_id,{...base,photos:[...photos,{id:file.id,alt:file.name}]},prior?.id??null,'guided');
}
export type PhotoAsset={id:string;alt:string;digest:string;size:number;bytes:Uint8Array};
export async function versionPhotos(env:Pick<Env,'DB'|'FILES'>,versionId:string,config:PhotoConfig):Promise<PhotoAsset[]>{
 const {results}=await env.DB.prepare(`SELECT f.id,f.object_key,f.digest,f.size,v.alt,${approvedPhotoSQL} AS approved FROM version_photos v JOIN project_files f ON f.id=v.file_id WHERE v.version_id=? ORDER BY v.position`).bind(versionId).all<{id:string;object_key:string;digest:string;size:number;alt:string;approved:number}>();
 if(results.length!==config.photos.length||results.some((row,n)=>row.id!==config.photos[n].id||row.alt!==config.photos[n].alt))throw new FileError(503,'Saved photo references could not be verified');
 if(results.some(row=>!row.approved))throw new FileError(423,'This version includes photos held for safety checks');
 if(results.length)await reserveStorage(env.DB,'read',results.length);
 const assets:PhotoAsset[]=[];
 for(const row of results){
  const object=await env.FILES.get(row.object_key);if(!object||object.size!==row.size){await object?.body.cancel();throw new FileError(503,'A saved photo is unavailable. Please try again later.');}
  const bytes=new Uint8Array(await object.arrayBuffer());const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==row.digest)throw new FileError(503,'A saved photo could not be verified');assets.push({id:row.id,alt:row.alt,digest:row.digest,size:row.size,bytes});
 }
 return assets;
}
export async function ownedPreview(env:Pick<Env,'DB'|'FILES'>,userId:string,id:string){
 const row=await env.DB.prepare('SELECT v.id,v.html,v.component_id,v.config_json FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(id,userId).first<{id:string;html:string;component_id:string;config_json:string}>();
 if(!row)return null;let html=row.html;
 if(row.component_id==='photo-page@1'){
  const photos=await versionPhotos(env,row.id,photoConfig(JSON.parse(row.config_json)));
  for(const photo of photos){let binary='';for(let n=0;n<photo.bytes.length;n+=8192)binary+=String.fromCharCode(...photo.bytes.subarray(n,n+8192));html=html.replace(`src="assets/${photo.id}.jpg"`,`src="data:image/jpeg;base64,${btoa(binary)}"`);}
 }
 return new Response(html,{headers:{...previewHeaders,'content-security-policy':previewHeaders['content-security-policy']+"; img-src data:"}});
}

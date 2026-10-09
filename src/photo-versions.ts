import {approvedPhotoSQL} from './photo-safety';
import {requireSpecificationAvailable} from './specification-safety';
import {siteConfig,photoConfig,previewHeaders,type SiteConfig,type PhotoConfig} from './components';
import {FileError} from './photo-format';
import {reserveStorage} from './storage-budget';
export type PageConfig=SiteConfig|PhotoConfig;
export function savedPage(component:string,json:string):PageConfig{
 const value=JSON.parse(json);
 if(component==='photo-page@1')return photoConfig(value);
 if(component==='site-page@1')return siteConfig(value);
 throw new FileError(409,'Unsupported saved website component. Create a current website draft.');
}
export type PhotoAsset={id:string;alt:string;digest:string;size:number;bytes:Uint8Array};
/** Charges `count` private photo reads before any object is read. Owner previews and exports use the
 * platform pool; anonymous guest views charge their project budget (reserveGuestPreviewPhotoReads). */
export type PhotoReadReservation=(count:number)=>Promise<void>;
export async function versionPhotos(env:Pick<Env,'DB'|'FILES'>,versionId:string,config:PhotoConfig,reserve:PhotoReadReservation=count=>reserveStorage(env.DB,'read',count)):Promise<PhotoAsset[]>{
 const {results}=await env.DB.prepare(`SELECT f.id,f.object_key,f.digest,f.size,v.alt,${approvedPhotoSQL} AS approved FROM version_photos v JOIN project_files f ON f.id=v.file_id WHERE v.version_id=? ORDER BY v.position`).bind(versionId).all<{id:string;object_key:string;digest:string;size:number;alt:string;approved:number}>();
 if(results.length!==config.photos.length||results.some((row,n)=>row.id!==config.photos[n].id||row.alt!==config.photos[n].alt))throw new FileError(503,'Saved photo references could not be verified');
 if(results.some(row=>!row.approved))throw new FileError(423,'This version includes photos held for safety checks');
 if(results.length)await reserve(results.length);
 const assets:PhotoAsset[]=[];
 for(const row of results){
  const object=await env.FILES.get(row.object_key);if(!object||object.size!==row.size){await object?.body.cancel();throw new FileError(503,'A saved photo is unavailable. Please try again later.');}
  const bytes=new Uint8Array(await object.arrayBuffer());const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==row.digest)throw new FileError(503,'A saved photo could not be verified');assets.push({id:row.id,alt:row.alt,digest:row.digest,size:row.size,bytes});
 }
 return assets;
}
export type SavedVersionRow={id:string;html:string;component_id:string;config_json:string};
/** The single isolated preview rendering of one exact saved version, shared by the owner and
 * guest-link paths: current-format/hold check, then digest-verified private photos inlined as
 * data URIs. No object URL, asset alias or other version is ever exposed. */
export async function savedVersionHTML(env:Pick<Env,'DB'|'FILES'>,row:SavedVersionRow,reserve?:PhotoReadReservation){
 await requireSpecificationAvailable(env.DB,row.id);let html=row.html;
 if(row.component_id==='photo-page@1'){
  const photos=await versionPhotos(env,row.id,photoConfig(JSON.parse(row.config_json)),reserve);
  for(const photo of photos){let binary='';for(let n=0;n<photo.bytes.length;n+=8192)binary+=String.fromCharCode(...photo.bytes.subarray(n,n+8192));html=html.replace(`src="assets/${photo.id}.jpg"`,`src="data:image/jpeg;base64,${btoa(binary)}"`);}
 }
 return html;
}
export async function ownedPreview(env:Pick<Env,'DB'|'FILES'>,userId:string,id:string){
 const row=await env.DB.prepare('SELECT v.id,v.html,v.component_id,v.config_json FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(id,userId).first<SavedVersionRow>();
 if(!row)return null;
 return new Response(await savedVersionHTML(env,row),{headers:{...previewHeaders,'content-security-policy':previewHeaders['content-security-policy']+"; img-src data:"}});
}

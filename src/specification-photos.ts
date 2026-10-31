import {BackendError} from './backend-error';
import {approvedPhotoSQL,ownerLibrarySQL} from './photo-safety';
import {reserveStorage} from './storage-budget';
export type SpecificationPhoto={id:string;alt:string};
/** Current project ownership and clearance, checked again when a review is opened. */
export async function requireSpecificationPhotos(db:D1Database,user:string,project:string,photos:SpecificationPhoto[]){
 for(const photo of photos)if(!await db.prepare(`SELECT f.id FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL} AND ${ownerLibrarySQL}`).bind(photo.id,project,user).first())throw new BackendError(423,'A reviewed photo is unavailable or held for safety checks.');
}
/** Preview only: authenticated owned, cleared, digest-verified photo bytes. */
export async function inlineSpecificationPhotos(db:D1Database,files:R2Bucket|undefined,user:string,project:string,html:string,photos:SpecificationPhoto[]){
 if(!photos.length)return html;
 if(!files)throw new BackendError(503,'Photo previews are unavailable.');
 await requireSpecificationPhotos(db,user,project,photos);
 await reserveStorage(db,'read',photos.length);
 for(const photo of photos){
  const row=await db.prepare(`SELECT f.object_key,f.size,f.digest FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL} AND ${ownerLibrarySQL}`).bind(photo.id,project,user).first<{object_key:string;size:number;digest:string}>();
  if(!row)throw new BackendError(423,'A reviewed photo is unavailable or held for safety checks.');
  const object=await files.get(row.object_key);
  if(!object||object.size!==row.size){await object?.body.cancel();throw new BackendError(503,'A reviewed photo is unavailable.');}
  const bytes=new Uint8Array(await object.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==row.digest)throw new BackendError(503,'A reviewed photo failed its integrity check.');
  let binary='';for(let n=0;n<bytes.length;n+=8192)binary+=String.fromCharCode(...bytes.subarray(n,n+8192));
  html=html.replaceAll(`src="assets/${photo.id}.jpg"`,()=>`src="data:image/jpeg;base64,${btoa(binary)}"`);
 }
 return html;
}
export {assetPhotos} from './brand-tokens';

import {cmsImageReferences} from './cms-image-block';
import {readCMSMediaBytes} from './cms-media-preview';
import {cmsConnection} from './cms-status';
import {cleanPhoto} from './photo-format';
import {CMSProjectError} from './cms-error';
export type CMSArticleImage={mediaId:string;digest:string;size:number;width:number;height:number;bytes:Uint8Array};
/** Capture verified native bytes for receipt verification. No storage, delivery or publication side effects;
 * this does not release held media (see cms-media-safety). */
export async function captureCMSArticleImages(db:D1Database,user:string,project:string,content:unknown,env:Record<string,unknown>):Promise<CMSArticleImage[]>{
 const images=cmsImageReferences(content);if(!images.length)return [];
 const {config}=await cmsConnection(db,user,project,env);
 const captured:CMSArticleImage[]=[];
 for(const mediaId of new Set(images.map(image=>image.asset._ref))){
  // Only confirmed images uploaded through this owner's current native instance qualify.
  const receipt=await db.prepare("SELECT digest,size,width,height FROM cms_media_uploads WHERE user_id=? AND project_id=? AND origin=? AND result IS NOT NULL AND json_extract(result,'$.mediaId')=? ORDER BY created_at,id LIMIT 1").bind(user,project,config.origin,mediaId).first<{digest:string;size:number;width:number;height:number}>();
  if(!receipt)throw new CMSProjectError(409,'Choose a confirmed image uploaded to this publishing space');
  // Internal verification read; every delivering caller applies requireApprovedCMSMedia.
  const {bytes,type}=await readCMSMediaBytes(db,user,project,mediaId,env);
  let photo;try{photo=cleanPhoto(bytes);}catch{throw new CMSProjectError(409,'The saved article image is no longer a supported JPEG');}
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(type!=='image/jpeg'||photo.bytes.length!==bytes.length||digest!==receipt.digest||bytes.length!==receipt.size||photo.width!==receipt.width||photo.height!==receipt.height)throw new CMSProjectError(409,'The article image changed. Its original upload bytes must be recovered before publication.');
  captured.push({mediaId,digest,size:bytes.length,width:photo.width,height:photo.height,bytes});
 }
 return captured;
}

import type {CMSArticleImage} from './cms-article-images';
import {CMSProjectError} from './cms-error';
import {reserveStorage,reservePublicPhotoRead} from './storage-budget';
import {PublicClientLimitError} from './public-admission';
type Media={review_id:string;media_id:string;user_id:string;project_id:string;digest:string;size:number;width:number;height:number;state:'pending'|'ready'};
export const cmsPublicationMediaKey=(row:Pick<Media,'project_id'|'review_id'|'digest'>)=>`cms-publications/${row.project_id}/${row.review_id}/${row.digest}.jpg`;
const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),v=>v.toString(16).padStart(2,'0')).join('');
async function verifiedObject(db:D1Database,files:R2Bucket,row:Media,reserve=()=>reserveStorage(db,'read')){
 await reserve();const object=await files.get(cmsPublicationMediaKey(row));if(!object)return null;
 if(object.size!==row.size||object.size>1048576){await object.body.cancel();throw new CMSProjectError(503,'Frozen article image could not be verified');}
 const bytes=new Uint8Array(await object.arrayBuffer());if(await hash(bytes)!==row.digest)throw new CMSProjectError(503,'Frozen article image could not be verified');return bytes;
}
/** Called only after the immutable review and its complete manifest have been atomically reserved. */
export async function freezeCMSPublicationMedia(db:D1Database,files:R2Bucket,user:string,review:string,images:CMSArticleImage[]){
 const owner=await db.prepare('SELECT r.id FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(review,user,user).first();
 if(!owner)throw new CMSProjectError(404,'CMS publication review not found');
 const rows=(await db.prepare('SELECT * FROM cms_publication_media WHERE review_id=? ORDER BY media_id').bind(review).all<Media>()).results;
 for(const row of rows){
  let bytes=await verifiedObject(db,files,row);
  if(!bytes){
   const image=images.find(i=>i.mediaId===row.media_id);
   if(!image||image.digest!==row.digest||image.bytes.length!==row.size||image.width!==row.width||image.height!==row.height||await hash(image.bytes)!==row.digest)throw new CMSProjectError(409,'Recover the exact reviewed image before continuing publication');
   await reserveStorage(db,'write');
   await files.put(cmsPublicationMediaKey(row),image.bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'image/jpeg'},customMetadata:{sha256:row.digest}});
   bytes=await verifiedObject(db,files,row);if(!bytes)throw new CMSProjectError(503,'Article image storage needs recovery');
  }
  if(row.state==='pending')await db.prepare("UPDATE cms_publication_media SET state='ready' WHERE review_id=? AND media_id=? AND state='pending'").bind(review,row.media_id).run();
 }
}
/** Exact current-publication membership is checked before any private bucket read. */
export async function publicCMSPublicationImage(request:Request,db:D1Database,files:R2Bucket,project:string,review:string,digest:string){
 const headers={'content-type':'image/jpeg','cache-control':'no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'cross-origin'};
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{...headers,allow:'GET, HEAD'}});
 const row=await db.prepare("SELECT m.* FROM cms_publication_media m JOIN cms_live_articles a ON a.publication_id=m.review_id AND a.project_id=m.project_id AND a.user_id=m.user_id WHERE m.project_id=? AND m.review_id=? AND m.digest=? AND m.state='ready' LIMIT 1").bind(project,review,digest).first<Media>();
 if(!row)return new Response(null,{status:404,headers});
 try{const bytes=await verifiedObject(db,files,row,()=>reservePublicPhotoRead(db,request,project));if(!bytes)return new Response(null,{status:503,headers});return new Response(request.method==='HEAD'?null:new Uint8Array(bytes),{headers:{...headers,'content-length':String(bytes.length)}});}catch(cause){return new Response(null,{status:cause instanceof PublicClientLimitError?429:503,headers});}
}

/** Inline only verified frozen JPEGs into an authenticated review; no public access is granted. */
export async function inlineCMSPublicationImages(db:D1Database,files:R2Bucket,user:string,review:string,html:string){
 const rows=(await db.prepare("SELECT m.* FROM cms_publication_media m JOIN cms_publication_reviews r ON r.id=m.review_id JOIN projects p ON p.id=m.project_id WHERE m.review_id=? AND m.user_id=? AND r.user_id=m.user_id AND p.owner_user_id=m.user_id ORDER BY m.media_id").bind(review,user).all<Media>()).results;
 for(const row of rows){
  if(row.state!=='ready')throw new CMSProjectError(409,'Publication images need recovery before preview');
  const bytes=await verifiedObject(db,files,row);if(!bytes)throw new CMSProjectError(503,'Frozen article image is unavailable');
  let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  html=html.replaceAll(`src="/cms/media/${review}/${row.digest}.jpg"`,`src="data:image/jpeg;base64,${btoa(binary)}"`);
 }
 return html;
}

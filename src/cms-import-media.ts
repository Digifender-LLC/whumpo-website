import {cmsImageReferences} from './cms-image-block';
import {prepareWordPressMediaCandidate} from './cms-wordpress-mapped-media';
import {canonicalImportProvenance} from './cms-import-provenance';
import {CMSProjectError} from './cms-error';
export type ImportImage=Awaited<ReturnType<typeof prepareWordPressMediaCandidate>>['mediaPlan'][number];
const fail=()=>new CMSProjectError(409,'The reviewed image mapping no longer matches its source and confirmed uploads. Recover the original files before retrying this review.');
export function importMediaPlan(value:unknown,content:unknown):ImportImage[]{
 const images=cmsImageReferences(content);
 if(!Array.isArray(value)||value.length!==images.length||value.length>4)throw fail();
 return value.map((v,i)=>{
  const keys=['position','blockKey','sourceAttachmentId','sourceURL','attachmentURL','mediaId','digest','size','width','height'];
  if(!v||typeof v!=='object'||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k))||v.position!==i||v.blockKey!==images[i]._key||v.mediaId!==images[i].asset._ref||!Number.isSafeInteger(v.sourceAttachmentId)||v.sourceAttachmentId<1||typeof v.digest!=='string'||!/^[0-9a-f]{64}$/.test(v.digest)||!Number.isSafeInteger(v.size)||v.size<1||v.size>1048576||!Number.isSafeInteger(v.width)||v.width<1||v.width>1600||!Number.isSafeInteger(v.height)||v.height<1||v.height>1600)throw fail();
  for(const field of ['sourceURL','attachmentURL']){if(v[field]!==null&&(typeof v[field]!=='string'||v[field].length>2048))throw fail();}
  return {position:v.position,blockKey:v.blockKey,sourceAttachmentId:v.sourceAttachmentId,sourceURL:v.sourceURL,attachmentURL:v.attachmentURL,mediaId:v.mediaId,digest:v.digest,size:v.size,width:v.width,height:v.height};
 });
}
type MappedReview={project_id:string;source_upload_id:string|null;source_digest:string;source_id:number;collection:string;body:string;provenance:string;taxonomy_plan:string;media_plan:string};
/** Re-derive authority from retained source and exact native upload bytes, never metadata supplied by a caller. */
export async function verifyCMSImportMedia(db:D1Database,user:string,row:MappedReview,env:Record<string,unknown>){
 const body=JSON.parse(row.body),plan=importMediaPlan(JSON.parse(row.media_plan),body.data.content);
 if(!plan.length)return;
 const files=env.FILES as R2Bucket|undefined;if(!files)throw new CMSProjectError(503,'Source storage is unavailable');if(!row.source_upload_id)throw fail();
 const result=await prepareWordPressMediaCandidate(db,files,user,row.project_id,row.source_upload_id,row.source_id,plan.map(p=>({position:p.position,mediaId:p.mediaId})),env);
 if(result.sourceDigest!==row.source_digest||result.collection!==row.collection||JSON.stringify(result.body)!==row.body||canonicalImportProvenance(result.provenance)!==row.provenance||JSON.stringify(result.taxonomyPlan)!==row.taxonomy_plan||JSON.stringify(result.mediaPlan)!==JSON.stringify(plan))throw fail();
}
/** Generic draft recovery must preserve the same image approval as import confirmation. */
export async function verifyCMSImportDraftMedia(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 const row=await db.prepare("SELECT r.* FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=? AND r.media_plan<>'[]'").bind(id,user,user).first<MappedReview&{status:string}>();
 if(row){if(row.status!=='approved')throw new CMSProjectError(409,'Confirm or resume the original image import review');await verifyCMSImportMedia(db,user,row,env);}
}

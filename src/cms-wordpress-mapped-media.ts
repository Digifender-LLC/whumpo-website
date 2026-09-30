import {gutenbergToPortableText} from '@emdash-cms/gutenberg-to-portable-text';
import {captureCMSWordPressSource} from './cms-wordpress-sources';
import {analyzeCMSWordPress} from './cms-wordpress-api';
import {wordpressExcerpt} from './cms-wordpress-analysis';
import {cmsImageBlock} from './cms-image-block';
import {cmsItemId,cmsRichDraftBody} from './cms-content-shape';
import {captureCMSArticleImages} from './cms-article-images';
import {requireCMSImages} from './cms-status';
import {CMSProjectError} from './cms-error';
export type WordPressImageChoice={position:number;mediaId:string};
function choices(input:unknown):WordPressImageChoice[]{
 if(!Array.isArray(input)||!input.length||input.length>4)throw new CMSProjectError(400,'Choose a local image for every source image');
 const seen=new Set<number>();
 return input.map(value=>{
  if(!value||typeof value!=='object'||Object.keys(value).length!==2||!Object.hasOwn(value,'position')||!Object.hasOwn(value,'mediaId')||!Number.isSafeInteger(value.position)||value.position<0||value.position>3||seen.has(value.position)||typeof value.mediaId!=='string'||!cmsItemId.test(value.mediaId))throw new CMSProjectError(400,'Choose each source image once with a valid local media ID');
  seen.add(value.position);return {position:value.position,mediaId:value.mediaId};
 }).sort((a,b)=>a.position-b.position);
}
/** Read-only preparation. Nothing is imported, approved, fetched from source URLs or published. */
export async function prepareWordPressMediaCandidate(db:D1Database,files:R2Bucket,user:string,project:string,sourceId:string,itemId:number,input:unknown,env:Record<string,unknown>){
 const selected=choices(input); // Copy choices before asynchronous source/native reads.
 if(!Number.isSafeInteger(itemId)||itemId<1)throw new CMSProjectError(400,'Choose a source article');
 const {source,bytes}=await captureCMSWordPressSource(db,files,user,sourceId);
 if(source.projectId!==project)throw new CMSProjectError(404,'Source file is not in this publishing space');
 const report=await analyzeCMSWordPress(bytes),article=report.articles.find(row=>row.sourceId===itemId);
 if(report.source.digest!==source.digest||!article?.collection||article.mediaPlan.status!=='needs_local_media'||article.reasons.some(reason=>reason!=='media_requires_reviewed_local_import')||article.taxonomyPlan.status==='needs_changes')throw new CMSProjectError(409,'Resolve this article’s source or layout issues before mapping its images');
 const inventory=article.mediaPlan.images;
 if(selected.length!==inventory.length||selected.some((choice,i)=>choice.position!==inventory[i].position))throw new CMSProjectError(400,'Choose exactly one local image for every source image');
 let position=0;
 const content=gutenbergToPortableText(article.sourceHTML,{mediaMap:new Map()}).map((block,i)=>{
  if(block._type==='image'){
   const image=inventory[position],choice=selected[position++];
   return cmsImageBlock({_type:'image',_key:'wp-image-'+image.position,asset:{_ref:choice.mediaId},alt:image.alt,...(image.caption?{caption:image.caption}:{})});
  }
  if(block._type!=='block')return block; // The complete native shape rejects unsupported blocks.
  const definitions=block.markDefs??[],keys=new Map(definitions.map((d,j)=>[d._key,'wp-link-'+j]));
  return {...block,_key:'wp-block-'+i,markDefs:definitions.map(d=>({...d,_key:keys.get(d._key)})),children:block.children.map((span,j)=>({...span,_key:'wp-text-'+j,marks:(span.marks??[]).map(mark=>keys.get(mark)??mark)}))};
 });
 if(position!==selected.length)throw new CMSProjectError(409,'Source image conversion did not match its inventory');
 let body:ReturnType<typeof cmsRichDraftBody>;
 try{body=cmsRichDraftBody(article.title,content,article.collection==='posts'?wordpressExcerpt(article.sourceExcerpt):undefined);}catch{throw new CMSProjectError(409,'The converted article or excerpt exceeds the supported draft shape');}
 await requireCMSImages(db,user,project,env);
 const captured=await captureCMSArticleImages(db,user,project,body.data.content,env);
 const mediaPlan=inventory.map((image,i)=>{
  const local=captured.find(row=>row.mediaId===selected[i].mediaId);
  if(!local)throw new CMSProjectError(409,'A selected local image could not be verified');
  const {bytes:_,...metadata}=local;
  return {position:image.position,blockKey:'wp-image-'+image.position,sourceAttachmentId:image.attachmentId,sourceURL:image.sourceURL,attachmentURL:image.attachmentURL,...metadata};
 });
 return {sourceUploadId:sourceId,sourceDigest:source.digest,sourceItemId:itemId,projectId:project,collection:article.collection,body,mediaPlan,taxonomyPlan:article.taxonomyPlan.terms,
  provenance:{sourceHTML:article.sourceHTML,author:article.sourceAuthor??'',sourceURL:article.sourceURL??'',sourceStatus:article.sourceStatus,sourceDate:article.sourceDate??'',sourceSlug:article.sourceSlug??'',excerpt:article.sourceExcerpt,categories:article.categories,tags:article.tags},
  imported:false as const,published:false as const,reviewRequired:true as const};
}

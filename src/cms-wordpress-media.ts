import {gutenbergToPortableText} from '@emdash-cms/gutenberg-to-portable-text';
import type {WxrAttachment} from './vendor/emdash-wxr';
type SourceImage={position:number;attachmentId:number|null;sourceURL:string|null;attachmentURL:string|null;alt:string;caption:string;issues:string[]};
const media=/<(?:img|video|audio|source|iframe|embed|object)\b|<!--\s*wp:(?:image|gallery|media-text|cover|video|audio|embed)\b/i;
function sourceURL(value:unknown){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x20\x7f]/.test(value))return null;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash?url.href:null;}catch{return null;}
}
/** Source inventory only. URLs are inert evidence, never fetch targets or local media authority. */
export function wordpressMediaPlan(html:string,attachments:WxrAttachment[]){
 const issues=new Set<string>(),images:SourceImage[]=[];
 if(!media.test(html))return {version:1 as const,status:'none' as const,imageCount:0,images,issues:[],fetched:false as const};
 let blocks:ReturnType<typeof gutenbergToPortableText>;
 try{blocks=gutenbergToPortableText(html,{mediaMap:new Map()});}catch{return {version:1 as const,status:'needs_changes' as const,imageCount:0,images,issues:['media_conversion_failed'],fetched:false as const};}
 const found=blocks.filter(block=>block._type==='image');
 if(blocks.some(block=>block._type!=='block'&&block._type!=='image')||/<(?:video|audio|source|iframe|embed|object)\b|<!--\s*wp:(?:gallery|media-text|cover|video|audio|embed)\b/i.test(html))issues.add('unsupported_media_layout');
 if(!found.length)issues.add('no_supported_image_blocks');
 if((html.match(/<img\b/gi)??[]).length>found.length)issues.add('unmapped_source_images');
 if(found.length>4)issues.add('too_many_article_images');
 found.slice(0,4).forEach((image,position)=>{
  const row=image as unknown as Record<string,unknown>,asset=row.asset as Record<string,unknown>|undefined;
  const ref=typeof asset?._ref==='string'?asset._ref:'',id=/^[1-9][0-9]*$/.test(ref)&&Number.isSafeInteger(Number(ref))?Number(ref):null;
  const url=sourceURL(asset?.url),matches=id?attachments.filter(a=>a.id===id):url?attachments.filter(a=>sourceURL(a.url)===url):[];
  const problems:string[]=[];
  if(matches.length!==1)problems.push(matches.length?'ambiguous_source_attachment':'missing_source_attachment');
  const attachment=matches.length===1?matches[0]:undefined,attachmentURL=sourceURL(attachment?.url);
  if(!url||!attachmentURL)problems.push('unsupported_source_image_url');
  if(url&&attachmentURL&&url!==attachmentURL)problems.push('source_image_variant_requires_review');
  const alt=typeof row.alt==='string'?row.alt:'',caption=typeof row.caption==='string'?row.caption:'';
  if(alt.length>500||caption.length>1000||/[\x00-\x1f\x7f]/.test(alt+caption))problems.push('image_description_requires_changes');
  images.push({position,attachmentId:attachment?.id??null,sourceURL:url,attachmentURL,alt:alt.slice(0,500),caption:caption.slice(0,1000),issues:problems});
  for(const problem of problems)issues.add(problem);
 });
 return {version:1 as const,status:issues.size?'needs_changes' as const:'needs_local_media' as const,imageCount:found.length,images,issues:[...issues].sort(),fetched:false as const};
}

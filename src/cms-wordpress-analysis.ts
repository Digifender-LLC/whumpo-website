import {wordpressTaxonomyPlan,type WordPressTaxonomyEvidence} from './cms-wordpress-taxonomies';
import {canonicalImportProvenance} from './cms-import-provenance';
import sax from 'sax';
import {parseWxrString} from './vendor/emdash-wxr';
import {gutenbergToPortableText} from '@emdash-cms/gutenberg-to-portable-text';
import {cmsRichDraftBody} from './cms-content-shape';
/** Excerpts are native plain text. Preserve the original HTML in provenance. */
export function wordpressExcerpt(source:string){
 if(!source.trim())return undefined;
 if(/<\/?(?!p\b|br\b|strong\b|b\b|em\b|i\b|a\b|span\b|ul\b|ol\b|li\b|blockquote\b)[a-z]|\son[a-z]+\s*=|\[[a-z][a-z0-9_-]*(?:\s[^\]]*)?\]/i.test(source))throw Error('Excerpt needs manual conversion');
 const blocks=gutenbergToPortableText(source,{mediaMap:new Map()});
 if(!blocks.length||blocks.some(block=>block._type!=='block'||!Array.isArray(block.children)||block.children.some(span=>span._type!=='span'||typeof span.text!=='string')))throw Error('Excerpt needs manual conversion');
 const text=blocks.map(block=>{if(block._type!=='block')throw Error('Excerpt needs manual conversion');return block.children.map(span=>span.text).join('');}).join('\n').trim();
 if(!text||text.length>512)throw Error('Excerpt exceeds native limit');
 return text;
}
const maxBytes=1048576,maxItems=100;
function validateXML(xml:string){
 if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw Error('DTD and entity declarations are not accepted');
 const evidence:WordPressTaxonomyEvidence={languages:new Set(),labels:new Map()};
 const texts:string[]=[];
 const p=sax.parser(true,{xmlns:true}),stack:sax.QualifiedTag[]=[];let items=0,channels=0,wxr=false,root=false;
 p.onopentag=tag=>{const n=tag as sax.QualifiedTag;stack.push(n);texts.push('');if(stack.length>40)throw Error('WordPress XML nesting exceeds the staging limit');
  if(stack.length===1){if(n.local!=='rss'||n.uri)throw Error('Choose a WordPress RSS export');root=true;}
  if(stack.length===2&&n.local==='channel'&&!n.uri)channels++;
  if(stack.length===3&&n.local==='item'&&!n.uri&&++items>maxItems)throw Error('Split this export into batches of at most 100 items');
  if(n.local==='wxr_version'&&/^https?:\/\/wordpress\.org\/export\/1\.[012]\/$/.test(n.uri)&&n.prefix==='wp'&&stack.length===3)wxr=true;
  // The pinned upstream importer addresses these by their standard prefix.
  if(n.prefix==='wp'&&!/^https?:\/\/wordpress\.org\/export\/1\.[012]\/$/.test(n.uri))throw Error('Invalid WordPress namespace');
 };
 p.ontext=p.oncdata=text=>{if(texts.length)texts[texts.length-1]+=text;};
 p.onclosetag=()=>{const tag=stack.at(-1)!,text=texts.pop()!.trim();
  if(stack.length===3&&tag.local==='language'&&!tag.uri&&text)evidence.languages.add(text);
  if(stack.length===4&&stack[2].local==='item'&&tag.local==='category'&&!tag.uri){
   const attr=(name:string)=>{const value=tag.attributes[name];return typeof value==='string'?value:value?.value??'';};
   const domain=attr('domain'),slug=attr('nicename');
   if((domain==='category'||domain==='post_tag')&&slug){const key=(domain==='post_tag'?'tag':domain)+'\0'+slug;const labels=evidence.labels.get(key)??new Set<string>();labels.add(text);evidence.labels.set(key,labels);}
  }stack.pop();};p.onerror=()=>{throw Error('Malformed WordPress XML');};
 try{p.write(xml).close();}catch(e){if(e instanceof Error&&e.message.startsWith('Line:'))throw Error('Malformed WordPress XML');throw e;}
 if(!root||channels!==1||!wxr)throw Error('Choose a standard WordPress WXR export with one channel');
 return {items,evidence};
}
export async function analyzeWordPress(bytes:Uint8Array){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>maxBytes)throw Error('Choose a WordPress XML export up to 1 MiB');
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{throw Error('Use a UTF-8 WordPress export');}
 const {items:itemCount,evidence}=validateXML(xml),version='1.0.1';
 let data;try{data=await parseWxrString(xml);}catch{throw Error('WordPress export could not be parsed');}
 if(data.posts.length+data.attachments.length!==itemCount)throw Error('Export items could not be accounted for; no partial staging was accepted');
 const ids=new Set<number>();for(const item of [...data.posts,...data.attachments]){if(item.id===undefined||!Number.isSafeInteger(item.id)||item.id<1||ids.has(item.id))throw Error('Every exported item needs a unique positive WordPress ID');ids.add(item.id);}
 const articles=data.posts.map(post=>{
  const reasons:string[]=[],warnings=['Compare the converted draft with the original before importing.','Source metadata is retained privately; authors, dates and custom fields are not mapped to native fields. Supported categories and tags require the separate mapping shown in the review.'];
  if(!['post','page'].includes(post.postType??''))reasons.push('unsupported_post_type');
  if(post.postPassword)reasons.push('password_protected_content');
  if(!['publish','draft','pending','private','future'].includes(post.status??''))reasons.push('unsupported_source_status');
  const taxonomyPlan=wordpressTaxonomyPlan(data,post,evidence);reasons.push(...taxonomyPlan.issues);
  const html=post.content??'';
  const provenance={sourceHTML:html,author:post.creator??'',sourceURL:post.link??'',sourceStatus:post.status??'',sourceDate:post.postDate??'',sourceSlug:post.postName??'',excerpt:post.excerpt??'',categories:post.categories,tags:post.tags};
  try{canonicalImportProvenance(provenance);}catch{reasons.push('source_provenance_exceeds_review_limit');}
  if(/<(?:img|video|audio|source|iframe|embed|object)\b|<!--\s*wp:(?:image|gallery|media-text|cover|video|audio|embed)\b/i.test(html))reasons.push('media_requires_reviewed_local_import');
  if(/<script\b|<style\b|<form\b|\son[a-z]+\s*=/i.test(html))reasons.push('active_content_requires_manual_conversion');
  if(/\[[a-z][a-z0-9_-]*(?:\s[^\]]*)?\]/i.test(html))reasons.push('shortcode_requires_manual_conversion');
  let candidate=null;
  if(!reasons.length){try{const converted=gutenbergToPortableText(html,{mediaMap:new Map()}).map((block,i)=>{if(block._type!=='block')return block;const definitions=block.markDefs??[],keys=new Map(definitions.map((d,j)=>[d._key,'wp-link-'+j]));return {...block,_key:'wp-block-'+i,markDefs:definitions.map(d=>({...d,_key:keys.get(d._key)})),children:block.children.map((span,j)=>({...span,_key:'wp-text-'+j,marks:(span.marks??[]).map(mark=>keys.get(mark)??mark)}))};});candidate=cmsRichDraftBody(post.title,converted,post.postType==='post'?wordpressExcerpt(post.excerpt??''):undefined);}catch{reasons.push('converted_content_outside_supported_article_shape');}}
  return {sourceId:post.id!,collection:post.postType==='page'?'pages' as const:post.postType==='post'?'posts' as const:null,title:post.title??'',sourceStatus:post.status??'',sourceHTML:html,sourceAuthor:post.creator??null,sourceURL:post.link??null,sourceDate:post.postDate??null,sourceSlug:post.postName??null,sourceExcerpt:post.excerpt??'',taxonomyPlan,categories:post.categories,tags:post.tags,customFieldCount:post.meta.size,translationGroup:post.translationGroup??null,locale:post.locale??null,status:candidate?'needs_review':'needs_changes',reasons,warnings,candidate};
 });
 return {contract:'whumpo-wordpress-stage',version:1,converter:{name:'emdash',version},source:{digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))),v=>v.toString(16).padStart(2,'0')).join(''),bytes:bytes.length,items:itemCount},site:{title:data.site.title??'',url:data.site.baseSiteUrl??data.site.link??null},articles,attachments:data.attachments.map(a=>({sourceId:a.id,title:a.title??'',url:a.url??null,status:'not_fetched'})),summary:{articles:articles.length,reviewable:articles.filter(a=>a.candidate).length,needsChanges:articles.filter(a=>!a.candidate).length,attachments:data.attachments.length},exclusions:['No CMS writes or publication','No media fetched','No themes or plugins executed','No authors or accounts provisioned','No redirects created'],sourceRetained:false};
}

export type WordPressReport=Awaited<ReturnType<typeof analyzeWordPress>>;

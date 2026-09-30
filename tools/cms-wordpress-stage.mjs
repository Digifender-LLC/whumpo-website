// Offline, private WordPress staging. No inference, network fetch or native CMS write.
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,realpath,mkdir,writeFile,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const maxBytes=1024*1024,maxItems=100;
let loaded;
async function dependencies(){
 if(!loaded)loaded=(async()=>{
  const packagePath=await realpath('integrations/emdash/node_modules/emdash/package.json'),require=createRequire(packagePath);
  const version=JSON.parse(await readFile(packagePath,'utf8')).version;if(version!=='1.0.1')throw Error('Review the WordPress converter before changing its pinned version');
  const bundled=await build({entryPoints:[join(dirname(packagePath),'src/cli/wxr/parser.ts')],bundle:true,platform:'node',format:'esm',write:false});
  const parser=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
  const converter=await import(pathToFileURL(require.resolve('@emdash-cms/gutenberg-to-portable-text')).href);
  const shape=await build({stdin:{resolveDir:process.cwd(),contents:"export {cmsRichDraftBody} from './src/cms-content-shape';export {renderCMSRichText} from './src/cms-rich-text';"},bundle:true,platform:'node',format:'esm',write:false});
  const {cmsRichDraftBody,renderCMSRichText}=await import('data:text/javascript;base64,'+Buffer.from(shape.outputFiles[0].text).toString('base64'));
  return {parse:parser.parseWxrString,convert:converter.gutenbergToPortableText,shape:cmsRichDraftBody,render:renderCMSRichText,sax:require('sax'),version};
 })();return loaded;
}
function validateXML(xml,sax){
 if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml))throw Error('DTD and entity declarations are not accepted');
 const p=sax.parser(true,{xmlns:true}),stack=[];let items=0,channels=0,wxr=false,root=false;
 p.onopentag=n=>{stack.push(n);if(stack.length>40)throw Error('WordPress XML nesting exceeds the staging limit');
  if(stack.length===1){if(n.local!=='rss'||n.uri)throw Error('Choose a WordPress RSS export');root=true;}
  if(stack.length===2&&n.local==='channel'&&!n.uri)channels++;
  if(stack.length===3&&n.local==='item'&&!n.uri&&++items>maxItems)throw Error('Split this export into batches of at most 100 items');
  if(n.local==='wxr_version'&&/^https?:\/\/wordpress\.org\/export\/1\.[012]\/$/.test(n.uri)&&n.prefix==='wp'&&stack.length===3)wxr=true;
  // The pinned upstream importer addresses these by their standard prefix.
  if(n.prefix==='wp'&&!/^https?:\/\/wordpress\.org\/export\/1\.[012]\/$/.test(n.uri))throw Error('Invalid WordPress namespace');
 };
 p.onclosetag=()=>stack.pop();p.onerror=()=>{throw Error('Malformed WordPress XML');};
 try{p.write(xml).close();}catch(e){if(e.message.startsWith('Line:'))throw Error('Malformed WordPress XML');throw e;}
 if(!root||channels!==1||!wxr)throw Error('Choose a standard WordPress WXR export with one channel');
 return items;
}
export async function analyzeWordPress(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>maxBytes)throw Error('Choose a WordPress XML export up to 1 MiB');
 let xml;try{xml=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Use a UTF-8 WordPress export');}
 const {parse,convert,shape,sax,version}=await dependencies(),itemCount=validateXML(xml,sax);
 let data;try{data=await parse(xml);}catch{throw Error('WordPress export could not be parsed');}
 if(data.posts.length+data.attachments.length!==itemCount)throw Error('Export items could not be accounted for; no partial staging was accepted');
 const ids=new Set();for(const item of [...data.posts,...data.attachments]){if(!Number.isSafeInteger(item.id)||item.id<1||ids.has(item.id))throw Error('Every exported item needs a unique positive WordPress ID');ids.add(item.id);}
 const articles=data.posts.map(post=>{
  const reasons=[],warnings=['Compare the converted draft with the original before importing.','Source metadata is retained privately; authors, dates, categories, tags and custom fields are not mapped to native fields yet.'];
  if(!['post','page'].includes(post.postType))reasons.push('unsupported_post_type');
  if(post.postPassword)reasons.push('password_protected_content');
  if(!['publish','draft','pending','private','future'].includes(post.status))reasons.push('unsupported_source_status');
  const html=post.content??'';
  if(/<(?:img|video|audio|source|iframe|embed|object)\b|<!--\s*wp:(?:image|gallery|media-text|cover|video|audio|embed)\b/i.test(html))reasons.push('media_requires_reviewed_local_import');
  if(/<script\b|<style\b|<form\b|\son[a-z]+\s*=/i.test(html))reasons.push('active_content_requires_manual_conversion');
  if(/\[[a-z][a-z0-9_-]*(?:\s[^\]]*)?\]/i.test(html))reasons.push('shortcode_requires_manual_conversion');
  let candidate=null;
  if(!reasons.length){try{const converted=convert(html,{mediaMap:new Map()}).map((block,i)=>{if(block._type!=='block')return block;const definitions=block.markDefs??[],keys=new Map(definitions.map((d,j)=>[d._key,'wp-link-'+j]));return {...block,_key:'wp-block-'+i,markDefs:definitions.map(d=>({...d,_key:keys.get(d._key)})),children:block.children.map((span,j)=>({...span,_key:'wp-text-'+j,marks:(span.marks??[]).map(mark=>keys.get(mark)??mark)}))};});candidate=shape(post.title,converted);}catch{reasons.push('converted_content_outside_supported_article_shape');}}
  return {sourceId:post.id,collection:post.postType==='page'?'pages':post.postType==='post'?'posts':null,title:post.title??'',sourceStatus:post.status,sourceHTML:html,sourceAuthor:post.creator??null,sourceURL:post.link??null,sourceDate:post.postDate??null,sourceSlug:post.postName??null,categories:post.categories,tags:post.tags,customFieldCount:post.meta.size,translationGroup:post.translationGroup??null,locale:post.locale??null,status:candidate?'needs_review':'needs_changes',reasons,warnings,candidate};
 });
 return {contract:'whumpo-wordpress-stage',version:1,converter:{name:'emdash',version},source:{digest:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,items:itemCount},site:{title:data.site.title??'',url:data.site.baseSiteUrl??data.site.link??null},articles,attachments:data.attachments.map(a=>({sourceId:a.id,title:a.title??'',url:a.url??null,status:'not_fetched'})),summary:{articles:articles.length,reviewable:articles.filter(a=>a.candidate).length,needsChanges:articles.filter(a=>!a.candidate).length,attachments:data.attachments.length},exclusions:['No CMS writes or publication','No media fetched','No themes or plugins executed','No authors or accounts provisioned','No redirects created'],sourceRetained:true};
}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function wordpressStageHTML(report){
 const {render}=await dependencies();
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>WordPress migration review — Whumpo</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f8fafc;color:#0f2d5b;max-width:960px;margin:auto;padding:24px}article{background:white;border:1px solid #d5e3ed;border-radius:16px;padding:20px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}h1{line-height:1.2}li{margin:8px 0}.status{font-weight:700}a{pointer-events:none}section{border-top:1px solid #d5e3ed;padding-top:12px}</style></head><body><h1>Review your WordPress content</h1><p>This private report has not imported or published anything. Compare each proposed draft with its original content before approving a later import.</p><p>${escapeHTML(report.summary.reviewable)} articles ready for review · ${escapeHTML(report.summary.needsChanges)} need changes · ${escapeHTML(report.summary.attachments)} attachments not fetched.</p><p>Source SHA-256: <code>${escapeHTML(report.source.digest)}</code></p>${report.articles.map(a=>`<article><h2>${escapeHTML(a.title)}</h2><p>Source item ${escapeHTML(a.sourceId)} · ${escapeHTML(a.sourceStatus)} · Author: ${escapeHTML(a.sourceAuthor??'not supplied')}</p><p class="status">${a.candidate?'Draft candidate — review required':'Changes required'}</p><ul>${[...a.reasons,...a.warnings].map(w=>`<li>${escapeHTML(w)}</li>`).join('')}</ul>${a.candidate?`<section><h3>Proposed private draft</h3>${render(a.candidate.data.content).replace(/<a\b[^>]*>/g,'<span>').replace(/<\/a>/g,'</span>')}</section>`:''}<details><summary>Original article HTML (displayed as text)</summary><pre>${escapeHTML(a.sourceHTML)}</pre></details></article>`).join('')}<h2>Media</h2><p>Files have not been downloaded. Media ownership, destination, size and source safety require a separate review.</p><ul>${report.attachments.map(a=>`<li>${escapeHTML(a.title)} — ${escapeHTML(a.url??'source URL missing')}</li>`).join('')}</ul><p>Keep this folder private: its original export may contain personal information, draft content and custom fields. Themes, plugins, accounts, redirects and historical metadata have not been installed.</p></body></html>`;
}
export async function stageWordPress(path,root=resolve('.secrets/cms-wordpress-staging')){
 const file=await open(path,'r');let bytes;try{const buffer=Buffer.alloc(maxBytes+1);let used=0;while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}bytes=buffer.subarray(0,used);}finally{await file.close();}
 const report=await analyzeWordPress(bytes),reviewHTML=await wordpressStageHTML(report),stageId=randomUUID(),directory=join(root,stageId);
 await mkdir(root,{recursive:true,mode:0o700});await mkdir(directory,{mode:0o700});
 try{await writeFile(join(directory,'source.xml'),bytes,{mode:0o600,flag:'wx'});await writeFile(join(directory,'review.html'),reviewHTML,{mode:0o600,flag:'wx'});await writeFile(join(directory,'report.json'),JSON.stringify({...report,stageId,createdAt:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});}catch(e){await rm(directory,{recursive:true,force:true});throw e;}
 return {stageId,directory,summary:report.summary};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 if(process.argv.length!==3){console.error('Usage: pnpm stage:wordpress /absolute/path/export.xml');process.exitCode=1;}
 else try{const result=await stageWordPress(process.argv[2]);console.log(JSON.stringify(result));}catch{console.error('WordPress staging failed. Check UTF-8 WXR format, unique item IDs, 1 MiB/100-item limits and local file access. No CMS changes were made.');process.exitCode=1;}
}

// Offline artifact wrapper for the same bounded analyzer used by the Worker.
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {open,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const maxBytes=1048576;
let loaded;
async function dependencies(){
 if(!loaded)loaded=(async()=>{
  const result=await build({stdin:{resolveDir:process.cwd(),contents:"export {analyzeWordPress} from './src/cms-wordpress-analysis';export {renderCMSRichText as render} from './src/cms-rich-text';"},bundle:true,platform:'node',format:'esm',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 })();return loaded;
}
export async function analyzeWordPress(bytes){return (await dependencies()).analyzeWordPress(bytes);}
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function wordpressStageHTML(report){
 const {render}=await dependencies();
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>WordPress migration review — Whumpo</title><style>body{font:16px/1.6 system-ui,sans-serif;background:#f8fafc;color:#0f2d5b;max-width:960px;margin:auto;padding:24px}article{background:white;border:1px solid #d5e3ed;border-radius:16px;padding:20px;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}h1{line-height:1.2}li{margin:8px 0}.status{font-weight:700}a{pointer-events:none}section{border-top:1px solid #d5e3ed;padding-top:12px}</style></head><body><h1>Review your WordPress content</h1><p>This private report has not imported or published anything. Compare each proposed draft with its original content before approving a later import.</p><p>${escapeHTML(report.summary.reviewable)} articles ready for review · ${escapeHTML(report.summary.needsChanges)} need changes · ${escapeHTML(report.summary.attachments)} attachments not fetched.</p><p>Source SHA-256: <code>${escapeHTML(report.source.digest)}</code></p>${report.articles.map(a=>`<article><h2>${escapeHTML(a.title)}</h2><p>Source item ${escapeHTML(a.sourceId)} · ${escapeHTML(a.sourceStatus)} · Author: ${escapeHTML(a.sourceAuthor??'not supplied')}</p><p class="status">${a.candidate?'Draft candidate — review required':'Changes required'}</p><ul>${[...a.reasons,...a.warnings].map(w=>`<li>${escapeHTML(w)}</li>`).join('')}</ul>${a.candidate?`<section><h3>Proposed private draft</h3>${render(a.candidate.data.content).replace(/<a\b[^>]*>/g,'<span>').replace(/<\/a>/g,'</span>')}</section>`:''}<details><summary>Original article HTML (displayed as text)</summary><pre>${escapeHTML(a.sourceHTML)}</pre></details></article>`).join('')}<h2>Media</h2><p>Files have not been downloaded. Media ownership, destination, size and source safety require a separate review.</p><ul>${report.attachments.map(a=>`<li>${escapeHTML(a.title)} — ${escapeHTML(a.url??'source URL missing')}</li>`).join('')}</ul><p>Keep this folder private: its original export may contain personal information, draft content and custom fields. Themes, plugins, accounts, redirects and historical metadata have not been installed.</p></body></html>`;
}
export async function stageWordPress(path,root=resolve('.secrets/cms-wordpress-staging')){
 const file=await open(path,'r');let bytes;try{const buffer=Buffer.alloc(maxBytes+1);let used=0;while(used<buffer.length){const {bytesRead}=await file.read(buffer,used,buffer.length-used,null);if(!bytesRead)break;used+=bytesRead;}bytes=buffer.subarray(0,used);}finally{await file.close();}
 const report=await analyzeWordPress(bytes),reviewHTML=await wordpressStageHTML(report),stageId=randomUUID(),directory=join(root,stageId);
 await mkdir(root,{recursive:true,mode:0o700});await mkdir(directory,{mode:0o700});
 try{await writeFile(join(directory,'source.xml'),bytes,{mode:0o600,flag:'wx'});await writeFile(join(directory,'review.html'),reviewHTML,{mode:0o600,flag:'wx'});await writeFile(join(directory,'report.json'),JSON.stringify({...report,sourceRetained:true,stageId,createdAt:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});}catch(e){await rm(directory,{recursive:true,force:true});throw e;}
 return {stageId,directory,summary:report.summary};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
 if(process.argv.length!==3){console.error('Usage: pnpm stage:wordpress /absolute/path/export.xml');process.exitCode=1;}
 else try{const result=await stageWordPress(process.argv[2]);console.log(JSON.stringify(result));}catch{console.error('WordPress staging failed. Check UTF-8 WXR format, unique item IDs, 1 MiB/100-item limits and local file access. No CMS changes were made.');process.exitCode=1;}
}

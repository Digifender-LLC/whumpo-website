import {cmsRichDraftBody} from './cms-content-shape';
import {cmsImageReferences} from './cms-image-block';
import {cmsConnection,requireStructuredCMS} from './cms-status';
import {createCMSDraft} from './cms-content';
import {CMSProjectError} from './cms-error';
import {renderCMSRichText} from './cms-rich-text';
import {previewHeaders} from './components';
import {escapeCMS as escapeHTML} from './cms-rich-text';
type Review={id:string;user_id:string;project_id:string;source_digest:string;source_id:number;collection:string;body:string;provenance:string;status:'pending'|'approved'|'imported'|'superseded';created_at:string;expires_at:string};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export type CMSImportCandidate={sourceDigest:string;sourceId:number;collection:'posts'|'pages';title:string;content:unknown;provenance:{sourceHTML:string;author:string;sourceURL:string;sourceStatus:string;sourceDate:string;sourceSlug:string}};
function canonical(candidate:CMSImportCandidate){
 if(!candidate||Object.keys(candidate).some(k=>!['sourceDigest','sourceId','collection','title','content','provenance'].includes(k))||!/^[0-9a-f]{64}$/.test(candidate.sourceDigest)||!Number.isSafeInteger(candidate.sourceId)||candidate.sourceId<1||!['posts','pages'].includes(candidate.collection))throw new CMSProjectError(400,'Choose a staged WordPress article with its source identity');
 let body:string;try{if(cmsImageReferences(candidate.content).length)throw Error('Import media separately before adding images');body=JSON.stringify(cmsRichDraftBody(candidate.title,candidate.content));}catch{throw new CMSProjectError(400,'This import candidate needs changes before it can become a supported draft');}
 const p=candidate.provenance,fields=['sourceHTML','author','sourceURL','sourceStatus','sourceDate','sourceSlug'] as const;
 if(!p||Object.keys(p).some(k=>!fields.includes(k as typeof fields[number]))||fields.some(k=>typeof p[k]!=='string'||p[k].length>(k==='sourceHTML'?24000:k==='sourceURL'?2000:500)))throw new CMSProjectError(400,'Source attribution and original article text are required');
 const provenance=JSON.stringify(Object.fromEntries(fields.map(k=>[k,p[k]])));if(new TextEncoder().encode(provenance).length>32768)throw new CMSProjectError(400,'Source metadata exceeds the import review limit');
 return {body,provenance};
}
export async function readCMSImport(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT r.* FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Review>();if(!row)throw new CMSProjectError(404,'Import review not found');return row;}
export async function prepareCMSImport(db:D1Database,user:string,project:string,id:string,candidate:CMSImportCandidate,env:Record<string,unknown>){
 if(!uuid.test(id))throw new CMSProjectError(400,'Choose a valid import request ID');
 await cmsConnection(db,user,project,env);const {body,provenance}=canonical(candidate);
 let row=await db.prepare(`SELECT id FROM cms_import_reviews WHERE id=? OR (project_id=? AND source_digest=? AND source_id=? AND status<>'superseded') ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).bind(id,project,candidate.sourceDigest,candidate.sourceId,id).first<{id:string}>();
 if(row&&row.id!==id){const existing=await readCMSImport(db,user,row.id);if(existing.status==='pending'&&existing.expires_at<=new Date().toISOString())row=null;}
 if(!row){await requireStructuredCMS(db,user,project,env);try{await db.prepare('INSERT INTO cms_import_reviews(id,user_id,project_id,source_digest,source_id,collection,body,provenance) VALUES(?,?,?,?,?,?,?,?)').bind(id,user,project,candidate.sourceDigest,candidate.sourceId,candidate.collection,body,provenance).run();}catch{/* Resolve exact or competing source reservations. */}row=await db.prepare("SELECT id FROM cms_import_reviews WHERE project_id=? AND source_digest=? AND source_id=? AND status<>'superseded'").bind(project,candidate.sourceDigest,candidate.sourceId).first<{id:string}>();}
 if(!row)throw new CMSProjectError(409,'Import review capacity is full or unavailable');
 const saved=await readCMSImport(db,user,row.id);if(saved.project_id!==project||saved.source_digest!==candidate.sourceDigest||saved.source_id!==candidate.sourceId||saved.collection!==candidate.collection||saved.body!==body||saved.provenance!==provenance)throw new CMSProjectError(409,'This source article already has a different saved review. Inspect it before changing the import.');return saved;
}
/** Only an explicit owner confirmation may call this; never model-produced approval. */
export async function confirmCMSImport(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSImport(db,user,id);if(row.status==='imported')return row;if(row.status==='superseded')throw new CMSProjectError(409,'This expired review was replaced. Open the current import review.');
 await cmsConnection(db,user,row.project_id,env);
 if(row.status==='pending'){await requireStructuredCMS(db,user,row.project_id,env);try{await db.prepare("UPDATE cms_import_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}row=await readCMSImport(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'Import review expired or draft capacity is unavailable; no import was started');}
 const {data}=JSON.parse(row.body);await createCMSDraft(db,user,row.project_id,row.id,row.collection,data.title,data.content,env,'structured');
 try{await db.prepare("UPDATE cms_import_reviews SET status='imported' WHERE id=? AND status='approved'").bind(id).run();}catch{}
 row=await readCMSImport(db,user,id);if(row.status!=='imported')throw new CMSProjectError(503,'Import receipt needs recovery. Retry this same review; do not create a replacement.');return row;
}
export async function cmsImportPage(db:D1Database,user:string,id:string){
 const row=await readCMSImport(db,user,id),p=JSON.parse(row.provenance),body=JSON.parse(row.body);
 const content=renderCMSRichText(body.data.content).replace(/<a\b[^>]*>/g,'<span>').replace(/<\/a>/g,'</span>');
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review WordPress draft</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#0f2d5b;background:#f8fafc;max-width:860px;margin:auto;padding:24px;overflow-wrap:anywhere}h1{line-height:1.2}h2{margin-top:32px}pre{white-space:pre-wrap;background:white;border:1px solid #d5e3ed;border-radius:12px;padding:16px;font-size:13px}</style><body><h1>${escapeHTML(body.data.title)}</h1><p>Import a private ${escapeHTML(row.collection==='posts'?'post':'page')}. Nothing will be published.</p><p>Source author: ${escapeHTML(p.author||'not supplied')} · Original status: ${escapeHTML(p.sourceStatus)}</p><p>Source metadata is retained in this review. Authors, historical dates, slugs, redirects, themes and plugins are not installed. Review the original against the conversion before confirming.</p><p>Original date: ${escapeHTML(p.sourceDate||'not supplied')} · Slug: ${escapeHTML(p.sourceSlug||'not supplied')}</p><p>Original URL (not fetched): ${escapeHTML(p.sourceURL||'not supplied')}</p><h2>Proposed draft</h2>${content}<h2>Original article HTML (text only)</h2><pre>${escapeHTML(p.sourceHTML)}</pre><p>Source export SHA-256: ${escapeHTML(row.source_digest)} · Item ${row.source_id}</p></body></html>`,{headers:previewHeaders});
}

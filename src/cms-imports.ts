import {importTaxonomyPlan,type ImportTerm} from './cms-import-taxonomy-plan';
import {requireCMSImportTaxonomies,completeMappedCMSImport} from './cms-import-taxonomies';
import {canonicalImportProvenance,type ImportProvenance} from './cms-import-provenance';
import {captureCMSWordPressSource} from './cms-wordpress-sources';
import {cmsRichDraftBody} from './cms-content-shape';
import {cmsImageReferences} from './cms-image-block';
import {cmsConnection,requireStructuredCMS,requireCMSExcerpts} from './cms-status';
import {createCMSDraft} from './cms-content';
import {CMSProjectError} from './cms-error';
import {renderCMSRichText} from './cms-rich-text';
import {previewHeaders} from './components';
import {escapeCMS as escapeHTML} from './cms-rich-text';
type Review={taxonomy_plan:string;source_upload_id:string|null;id:string;user_id:string;project_id:string;source_digest:string;source_id:number;collection:string;body:string;provenance:string;status:'pending'|'approved'|'imported'|'superseded';created_at:string;expires_at:string};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export type CMSImportCandidate={sourceDigest:string;sourceId:number;collection:'posts'|'pages';title:string;content:unknown;excerpt?:string;provenance:ImportProvenance;taxonomyPlan?:ImportTerm[]};
function canonical(candidate:CMSImportCandidate){
 if(!candidate||Object.keys(candidate).some(k=>!['sourceDigest','sourceId','collection','title','content','excerpt','provenance','taxonomyPlan'].includes(k))||!/^[0-9a-f]{64}$/.test(candidate.sourceDigest)||!Number.isSafeInteger(candidate.sourceId)||candidate.sourceId<1||!['posts','pages'].includes(candidate.collection))throw new CMSProjectError(400,'Choose a staged WordPress article with its source identity');
 if(candidate.excerpt!==undefined&&candidate.collection!=='posts')throw new CMSProjectError(400,'Excerpts can only be imported into posts');
 let body:string;try{if(cmsImageReferences(candidate.content).length)throw Error('Import media separately before adding images');body=JSON.stringify(cmsRichDraftBody(candidate.title,candidate.content,candidate.excerpt));}catch{throw new CMSProjectError(400,'This import candidate needs changes before it can become a supported draft');}
 let provenance:string;try{provenance=canonicalImportProvenance(candidate.provenance);}catch{throw new CMSProjectError(400,'Source attribution or metadata exceeds the import review limits');}
 let taxonomyPlan:string;try{taxonomyPlan=JSON.stringify(importTaxonomyPlan(candidate.taxonomyPlan??[]));if(taxonomyPlan!=='[]'&&candidate.collection!=='posts')throw Error();}catch{throw new CMSProjectError(400,'Category and tag mappings need changes before review');}
 return {body,provenance,taxonomyPlan};
}
export async function readCMSImport(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT r.* FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Review>();if(!row)throw new CMSProjectError(404,'Import review not found');return row;}
export async function prepareCMSImport(db:D1Database,user:string,project:string,id:string,candidate:CMSImportCandidate,env:Record<string,unknown>,sourceUploadId?:string){
 if(!uuid.test(id))throw new CMSProjectError(400,'Choose a valid import request ID');
 await cmsConnection(db,user,project,env);const {body,provenance,taxonomyPlan}=canonical(candidate);
 if(taxonomyPlan!=='[]'&&!sourceUploadId)throw new CMSProjectError(400,'Category and tag mapping requires the retained WordPress source');
 if(sourceUploadId){const files=env.FILES as R2Bucket|undefined;if(!files)throw new CMSProjectError(503,'Source storage is unavailable');const {source}=await captureCMSWordPressSource(db,files,user,sourceUploadId);if(source.projectId!==project||source.digest!==candidate.sourceDigest)throw new CMSProjectError(409,'Import source does not match this review');}
 let row=await db.prepare(`SELECT id FROM cms_import_reviews WHERE id=? OR (project_id=? AND source_digest=? AND source_id=? AND status<>'superseded') ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).bind(id,project,candidate.sourceDigest,candidate.sourceId,id).first<{id:string}>();
 if(row&&row.id!==id){const existing=await readCMSImport(db,user,row.id);if(existing.status==='pending'&&existing.expires_at<=new Date().toISOString())row=null;}
 if(!row&&taxonomyPlan!=='[]')await requireCMSImportTaxonomies(db,user,project,env);
 if(!row&&candidate.excerpt!==undefined)await requireCMSExcerpts(db,user,project,env);
 if(!row){await requireStructuredCMS(db,user,project,env);try{await db.prepare('INSERT INTO cms_import_reviews(id,user_id,project_id,source_digest,source_id,collection,body,provenance,source_upload_id,taxonomy_plan) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,user,project,candidate.sourceDigest,candidate.sourceId,candidate.collection,body,provenance,sourceUploadId??null,taxonomyPlan).run();}catch{/* Resolve exact or competing source reservations. */}row=await db.prepare("SELECT id FROM cms_import_reviews WHERE project_id=? AND source_digest=? AND source_id=? AND status<>'superseded'").bind(project,candidate.sourceDigest,candidate.sourceId).first<{id:string}>();}
 if(!row)throw new CMSProjectError(409,'Import review capacity is full or unavailable');
 const saved=await readCMSImport(db,user,row.id);if(saved.source_upload_id!==(sourceUploadId??null)||saved.project_id!==project||saved.source_digest!==candidate.sourceDigest||saved.source_id!==candidate.sourceId||saved.collection!==candidate.collection||saved.body!==body||saved.provenance!==provenance||saved.taxonomy_plan!==taxonomyPlan)throw new CMSProjectError(409,'This source article already has a different saved review. Inspect it before changing the import.');return saved;
}
/** Only an explicit owner confirmation may call this; never model-produced approval. */
export async function confirmCMSImport(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSImport(db,user,id);if(row.status==='imported')return row;if(row.status==='superseded')throw new CMSProjectError(409,'This expired review was replaced. Open the current import review.');
 await cmsConnection(db,user,row.project_id,env);
 if(row.status==='pending'&&row.source_upload_id){const files=env.FILES as R2Bucket|undefined;if(!files)throw new CMSProjectError(503,'Source storage is unavailable');await captureCMSWordPressSource(db,files,user,row.source_upload_id);}
 if(row.status==='pending'){if(row.taxonomy_plan!=='[]')await requireCMSImportTaxonomies(db,user,row.project_id,env);if(JSON.parse(row.body).data.excerpt!==undefined)await requireCMSExcerpts(db,user,row.project_id,env);await requireStructuredCMS(db,user,row.project_id,env);try{await db.prepare("UPDATE cms_import_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}row=await readCMSImport(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'Import review expired or draft capacity is unavailable; no import was started');}
 if(row.taxonomy_plan!=='[]'){await completeMappedCMSImport(db,user,id,env);return readCMSImport(db,user,id);}
 const {data}=JSON.parse(row.body);await createCMSDraft(db,user,row.project_id,row.id,row.collection,data.title,data.content,env,'structured',data.excerpt);
 try{await db.prepare("UPDATE cms_import_reviews SET status='imported' WHERE id=? AND status='approved'").bind(id).run();}catch{}
 row=await readCMSImport(db,user,id);if(row.status!=='imported')throw new CMSProjectError(503,'Import receipt needs recovery. Retry this same review; do not create a replacement.');return row;
}
export async function cmsImportPage(db:D1Database,user:string,id:string){
 const row=await readCMSImport(db,user,id),p=JSON.parse(row.provenance),body=JSON.parse(row.body),terms=importTaxonomyPlan(JSON.parse(row.taxonomy_plan));
 const content=renderCMSRichText(body.data.content).replace(/<a\b[^>]*>/g,'<span>').replace(/<\/a>/g,'</span>');
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review WordPress draft</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#0f2d5b;background:#f8fafc;max-width:860px;margin:auto;padding:24px;overflow-wrap:anywhere}h1{line-height:1.2}h2{margin-top:32px}pre{white-space:pre-wrap;background:white;border:1px solid #d5e3ed;border-radius:12px;padding:16px;font-size:13px}</style><body><h1>${escapeHTML(body.data.title)}</h1><p>Import a private ${escapeHTML(row.collection==='posts'?'post':'page')}. Nothing will be published.</p><p>Source author: ${escapeHTML(p.author||'not supplied')} · Original status: ${escapeHTML(p.sourceStatus)}</p><p>Source metadata is retained in this review. Authors, historical dates, slugs, redirects, themes and plugins are not installed. Review the original against the conversion before confirming.</p><p>Original date: ${escapeHTML(p.sourceDate||'not supplied')} · Slug: ${escapeHTML(p.sourceSlug||'not supplied')}</p><p>Original URL (not fetched): ${escapeHTML(p.sourceURL||'not supplied')}</p><h2>Original excerpt and taxonomy</h2><p>Original source values retained privately for comparison. ${terms.length?'The proposed mapping below will create or reuse exact matching native categories and tags. Conflicting existing terms will stop the import.':'Categories and tags are not installed as native taxonomies by this review.'} Only an excerpt explicitly shown under Proposed draft is mapped into the post.</p><pre>${escapeHTML(p.excerpt??'No excerpt retained in this review.')}</pre><p>Categories: ${escapeHTML(p.categories?.join(', ')||'none retained')}</p><p>Tags: ${escapeHTML(p.tags?.join(', ')||'none retained')}</p><h2>Proposed draft</h2>${terms.length?'<h3>Categories and tags</h3><p>These terms will be attached to the private post before it becomes available for editing. Nothing will be published. Existing labels and hierarchy will not be overwritten.</p><ul>'+terms.map(t=>'<li>'+escapeHTML(t.taxonomy==='categories'?'Category':'Tag')+': '+escapeHTML(t.label)+' ('+escapeHTML(t.slug)+')</li>').join('')+'</ul>':''}${body.data.excerpt===undefined?'':'<h3>Native post excerpt</h3><p>'+escapeHTML(body.data.excerpt)+'</p>'}${content}<h2>Original article HTML (text only)</h2><pre>${escapeHTML(p.sourceHTML)}</pre><p>Source export SHA-256: ${escapeHTML(row.source_digest)} · Item ${row.source_id}</p></body></html>`,{headers:previewHeaders});
}

import {launchConfig,siteConfig,photoConfig,previewHeaders,componentCatalog} from './components';
import {hashToken} from './security';
export class DiffError extends Error {constructor(public status:number,message:string){super(message);}}
type Version={id:string;component_id:string;config_json:string;html:string;digest:string;created_at:string};
type Metadata=Omit<Version,'config_json'|'html'>;
type Change={label:string;before:string|null;after:string|null};
export type VersionDiff={project:{id:string;name:string};kind:'comparison'|'publish'|'restore'|'unpublish';baseline:'live'|'selected'|'empty';before:Metadata|null;after:Metadata|null;changes:Change[];htmlChanged:boolean;reviewId?:string;expiresAt?:string;publicationRevision:number|null};
type Snapshot={project_id:string;name:string;kind:VersionDiff['kind'];baseline:VersionDiff['baseline'];before_json:string;after_json:string;current_revision:number|null;review_id?:string;status?:string;expires_at?:string;expected_revision?:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Two artifacts and the publication/review identity are read in one database snapshot.
const artifacts=`SELECT c.*,json_object('id',b.id,'component_id',b.component_id,'config_json',b.config_json,'html',b.html,'digest',b.digest,'created_at',b.created_at) AS before_json,json_object('id',t.id,'component_id',t.component_id,'config_json',t.config_json,'html',t.html,'digest',t.digest,'created_at',t.created_at) AS after_json FROM chosen c LEFT JOIN site_versions b ON b.id=c.baseline_id AND b.project_id=c.project_id LEFT JOIN site_versions t ON t.id=c.target_id AND t.project_id=c.project_id`;
function fields(v:Version|null){
 const result=new Map<string,string>();if(!v)return result;
 let value:unknown;try{value=JSON.parse(v.config_json);}catch{throw new DiffError(503,'This saved configuration cannot be compared.');}
 try{
  const c=v.component_id==='launch-page@1'?launchConfig(value):v.component_id==='site-page@1'?siteConfig(value):v.component_id==='photo-page@1'?photoConfig(value):null;
  if(!c)throw Error('Unsupported component');
  result.set('Layout',`${componentCatalog.find(c=>c.id===v.component_id)!.name} (version 1)`);result.set('Site name',c.name);result.set('Introduction',c.description);result.set('Theme',c.theme);
  if(v.component_id!=='launch-page@1'){const details=v.component_id==='photo-page@1'?photoConfig(value):siteConfig(value);result.set('Headline',details.headline);result.set('About heading',details.aboutTitle);result.set('About text',details.aboutText);details.sections.forEach((section,i)=>{result.set(`Section ${i+1} heading`,section.heading);result.set(`Section ${i+1} text`,section.text);});}
  if(v.component_id==='photo-page@1')photoConfig(value).photos.forEach((photo,i)=>result.set('Photo '+photo.id,`Position ${i+1}\nDescription: ${photo.alt}`));
 }catch{throw new DiffError(503,'This saved component cannot be compared.');}
 return result;
}
async function version(raw:string):Promise<Version|null>{const parsed=JSON.parse(raw) as Version;if(parsed.id===null)return null;if(await hashToken(parsed.html)!==parsed.digest)throw new DiffError(503,'Saved content failed its integrity check.');return parsed;}
const metadata=(v:Version|null):Metadata|null=>v?{id:v.id,component_id:v.component_id,digest:v.digest,created_at:v.created_at}:null;
async function compare(row:Snapshot):Promise<VersionDiff>{
 const [before,after]=await Promise.all([version(row.before_json),version(row.after_json)]);
 const old=fields(before),next=fields(after),changes:Change[]=[];
 for(const label of new Set([...old.keys(),...next.keys()])){const previous=old.get(label)??null,current=next.get(label)??null;if(previous!==current)changes.push({label,before:previous,after:current});}
 return {project:{id:row.project_id,name:row.name},kind:row.kind,baseline:row.baseline,before:metadata(before),after:metadata(after),changes,htmlChanged:before?.digest!==after?.digest,publicationRevision:row.current_revision,...(row.review_id?{reviewId:row.review_id,expiresAt:row.expires_at}: {})};
}
export async function compareVersions(db:D1Database,userId:string,targetId:string,baseId?:string):Promise<VersionDiff>{
 if(!uuid.test(targetId)||(baseId!==undefined&&baseId!=='none'&&!uuid.test(baseId)))throw new DiffError(400,'Use /diff VERSION_ID, optionally followed by a baseline version ID or none.');
 const row=await db.prepare(`WITH chosen AS(SELECT t.project_id,p.name,t.id AS target_id,CASE WHEN ?='none' THEN NULL WHEN ? IS NOT NULL THEN ? ELSE s.version_id END AS baseline_id,CASE WHEN ?='none' THEN 'empty' WHEN ? IS NOT NULL THEN 'selected' ELSE 'live' END AS baseline,'comparison' AS kind,s.revision AS current_revision FROM site_versions t JOIN projects p ON p.id=t.project_id LEFT JOIN publications s ON s.project_id=p.id WHERE t.id=? AND p.owner_user_id=?) ${artifacts}`).bind(baseId??null,baseId??null,baseId??null,baseId??null,baseId??null,targetId,userId).first<Snapshot&{baseline_id:string|null}>();
 if(!row||row.baseline_id&&JSON.parse(row.before_json).id===null)throw new DiffError(404,'Choose saved versions belonging to the same project in your account.');
 return compare(row);
}
export async function compareReview(db:D1Database,userId:string,reviewId:string):Promise<VersionDiff>{
 if(!uuid.test(reviewId))throw new DiffError(404,'Publication review not found.');
 const row=await db.prepare(`WITH chosen AS(SELECT a.project_id,p.name,a.version_id AS target_id,s.version_id AS baseline_id,'live' AS baseline,a.kind,s.revision AS current_revision,a.expected_revision,a.id AS review_id,a.status,a.expires_at FROM publication_actions a JOIN projects p ON p.id=a.project_id JOIN publications s ON s.project_id=p.id WHERE a.id=? AND a.user_id=? AND p.owner_user_id=?) ${artifacts}`).bind(reviewId,userId,userId).first<Snapshot>();
 if(!row)throw new DiffError(404,'Publication review not found.');
 if(row.status!=='pending'||row.expires_at!<=new Date().toISOString()||row.current_revision!==row.expected_revision)throw new DiffError(409,'This review changed or expired. Prepare a fresh publication review.');
 if(row.kind!=='unpublish'&&JSON.parse(row.after_json).id===null)throw new DiffError(409,'The reviewed version is no longer available.');
 return compare(row);
}
/** Bounded server-derived chat receipt, not a model-written claim about what changed. */
export function describeDiff(diff:VersionDiff){
 const short=(text:string|null)=>text===null?'[Not included]':text.length>180?text.slice(0,180)+'… [excerpt]':text||'[Empty text]';
 const shown=diff.changes.slice(0,12);
 return `Changes for “${diff.project.name}”\nBefore: ${diff.before?.id??'No published content'}\nAfter: ${diff.after?.id??'Unpublished'}\nBaseline: ${diff.baseline==='selected'?'selected saved version':diff.baseline==='empty'?'empty page':'current live version at the time of this comparison'}\n\n`+(shown.length?shown.map(c=>`${c.label}\nBefore: ${short(c.before)}\nAfter: ${short(c.after)}`).join('\n\n'):'No configuration changes.')+(diff.changes.length>shown.length?`\n\n${diff.changes.length-shown.length} more changed fields. Open the private comparison for all values.`:'')+`\n\n${diff.htmlChanged?'Saved page source differs.':'Saved page source is identical.'} ${diff.changes.length} changed field(s). This reads saved content only; nothing was published or changed. Open the private comparison link below for full values. Photo comparisons show references, order and descriptions, not pixel differences.`;
}
export function comparisonReceipt(db:D1Database,userId:string,turnId:string,diff:VersionDiff){
 if(!diff.after)throw new DiffError(400,'Choose a saved target version.');
 return {reply:describeDiff(diff),statements:[db.prepare('INSERT INTO chat_comparisons(turn_id,version_id,baseline_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,diff.after.id,diff.before?.id??null,turnId,userId)]};
}
export async function prepareComparison(db:D1Database,userId:string,turnId:string,id:string,base?:string){try{return comparisonReceipt(db,userId,turnId,await compareVersions(db,userId,id,base));}catch(cause){if(cause instanceof DiffError)return {reply:cause.message,statements:[] as D1PreparedStatement[]};throw cause;}}
export async function diffCommand(db:D1Database,userId:string,turnId:string,command:string){const [verb,id,base,...extra]=command.split(/\s+/);if(verb!=='/diff')return;if(!id||extra.length)return {reply:'Use /diff VERSION_ID, optionally followed by a baseline version ID or none. Find IDs with /versions.',statements:[] as D1PreparedStatement[]};return prepareComparison(db,userId,turnId,id,base);}

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function diffPage(diff:VersionDiff){
 const date=(value:string)=>new Date(value).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC';
 const info=(v:Metadata|null)=>v?`<p>Saved ${esc(date(v.created_at))}</p><a href="/api/site-versions/${v.id}/preview">Open private preview</a><details><summary>Version details</summary><p class="version">${esc(v.id)}</p><p class="version">SHA-256: ${esc(v.digest)}</p></details>`:'<p>No published content</p>';
 const value=(s:string|null)=>s===null?'<em>Not included</em>':s===''?'<em>Empty text</em>':`<pre>${esc(s)}</pre>`;
 const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Website changes · Whumpo</title><style>*{box-sizing:border-box}body{margin:0;color:#172321;background:#f4f7f3;font:16px/1.6 Arial,sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font:44px/1.15 Georgia,serif;margin:12px 0}h1,h2,p,a,pre{overflow-wrap:anywhere}h2{font-size:19px}a{color:#174d3b}.intro{max-width:800px}.versions{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:28px 0}.versions section{background:white;padding:20px;border:1px solid #d5e0d4;border-radius:12px;min-width:0}details{margin-top:16px}summary{cursor:pointer}.version{font:14px monospace}table{border-collapse:collapse;width:100%;background:white;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:16px;border:1px solid #d5e0d4;overflow-wrap:anywhere}th{background:#e5eee5}pre{white-space:pre-wrap;margin:0;font:inherit}td:first-child{font-weight:600}.note{font-size:14px;color:#4d6258}.status{padding:16px;background:#e5eee5;border-radius:10px}@media(max-width:650px){main{padding:24px 16px}h1{font-size:34px}.versions{grid-template-columns:1fr}thead{display:none}tr{display:block;margin-bottom:18px}td{display:block;width:100%}td::before{display:block;color:#4d6258;font-size:12px;font-weight:bold;content:attr(data-label)}td:first-child{background:#e5eee5}}</style></head><body><main><a href="/workspace/">Back to workspace</a><h1>Review website changes</h1><p class="intro">${esc(diff.project.name)} · ${diff.kind==='comparison'?'Private saved-version comparison':esc(diff.kind)+' review'}</p><p class="status">${diff.changes.length} changed field(s). ${diff.htmlChanged?'Saved page source differs.':'Saved page source is identical.'} Viewing this page does not authorize publication.</p>${diff.reviewId?`<p class="note">Review expires ${esc(date(diff.expiresAt!))}. Confirm separately in your workspace. If the live site changes, prepare a fresh review.</p>`:`<p class="note">Baseline: ${diff.baseline==='selected'?'selected saved version':diff.baseline==='empty'?'empty page':'live version when this page was opened'}. This is a snapshot, not an approval.</p>`}<div class="versions"><section><h2>Before</h2>${info(diff.before)}</section><section><h2>After${diff.kind==='unpublish'?' unpublishing':''}</h2>${info(diff.after)}</section></div>${diff.changes.length?`<table><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${diff.changes.map(c=>`<tr><td data-label="Field">${esc(c.label)}</td><td data-label="Before">${value(c.before)}</td><td data-label="After">${value(c.after)}</td></tr>`).join('')}</tbody></table>`:'<p>No saved configuration fields changed.</p>'}<p class="note">Text and section positions are compared exactly. Photos show reference, order and description changes; use the private previews to inspect images. This comparison does not cover inbox messages, DNS or account settings. A publication change disables an enabled contact form until you review it again.</p></main></body></html>`;
 return new Response(html,{headers:{...previewHeaders,'content-security-policy':previewHeaders['content-security-policy'].replace('sandbox; ','')}});
}

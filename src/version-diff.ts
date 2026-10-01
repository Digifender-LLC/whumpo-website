import {requireSpecificationAvailable} from './specification-safety';
import {launchConfig,siteConfig,photoConfig,componentCatalog} from './components';
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
async function version(db:D1Database,raw:string):Promise<Version|null>{const parsed=JSON.parse(raw) as Version;if(parsed.id===null)return null;await requireSpecificationAvailable(db,parsed.id);if(await hashToken(parsed.html)!==parsed.digest)throw new DiffError(503,'Saved content failed its integrity check.');return parsed;}
const metadata=(v:Version|null):Metadata|null=>v?{id:v.id,component_id:v.component_id,digest:v.digest,created_at:v.created_at}:null;
async function compare(db:D1Database,row:Snapshot):Promise<VersionDiff>{
 const [before,after]=await Promise.all([version(db,row.before_json),version(db,row.after_json)]);
 const old=fields(before),next=fields(after),changes:Change[]=[];
 for(const label of new Set([...old.keys(),...next.keys()])){const previous=old.get(label)??null,current=next.get(label)??null;if(previous!==current)changes.push({label,before:previous,after:current});}
 return {project:{id:row.project_id,name:row.name},kind:row.kind,baseline:row.baseline,before:metadata(before),after:metadata(after),changes,htmlChanged:before?.digest!==after?.digest,publicationRevision:row.current_revision,...(row.review_id?{reviewId:row.review_id,expiresAt:row.expires_at}: {})};
}
export async function compareVersions(db:D1Database,userId:string,targetId:string,baseId?:string):Promise<VersionDiff>{
 if(!uuid.test(targetId)||(baseId!==undefined&&baseId!=='none'&&!uuid.test(baseId)))throw new DiffError(400,"Choose the saved version to compare, with an optional baseline version or no baseline.");
 const row=await db.prepare(`WITH chosen AS(SELECT t.project_id,p.name,t.id AS target_id,CASE WHEN ?='none' THEN NULL WHEN ? IS NOT NULL THEN ? ELSE s.version_id END AS baseline_id,CASE WHEN ?='none' THEN 'empty' WHEN ? IS NOT NULL THEN 'selected' ELSE 'live' END AS baseline,'comparison' AS kind,s.revision AS current_revision FROM site_versions t JOIN projects p ON p.id=t.project_id LEFT JOIN publications s ON s.project_id=p.id WHERE t.id=? AND p.owner_user_id=?) ${artifacts}`).bind(baseId??null,baseId??null,baseId??null,baseId??null,baseId??null,targetId,userId).first<Snapshot&{baseline_id:string|null}>();
 if(!row||row.baseline_id&&JSON.parse(row.before_json).id===null)throw new DiffError(404,'Choose saved versions belonging to the same project in your account.');
 return compare(db,row);
}
export async function compareReview(db:D1Database,userId:string,reviewId:string):Promise<VersionDiff>{
 if(!uuid.test(reviewId))throw new DiffError(404,'Publication review not found.');
 const row=await db.prepare(`WITH chosen AS(SELECT a.project_id,p.name,a.version_id AS target_id,s.version_id AS baseline_id,'live' AS baseline,a.kind,s.revision AS current_revision,a.expected_revision,a.id AS review_id,a.status,a.expires_at FROM publication_actions a JOIN projects p ON p.id=a.project_id JOIN publications s ON s.project_id=p.id WHERE a.id=? AND a.user_id=? AND p.owner_user_id=?) ${artifacts}`).bind(reviewId,userId,userId).first<Snapshot>();
 if(!row)throw new DiffError(404,'Publication review not found.');
 if(row.status!=='pending'||row.expires_at!<=new Date().toISOString()||row.current_revision!==row.expected_revision)throw new DiffError(409,'This review changed or expired. Prepare a fresh publication review.');
 if(row.kind!=='unpublish'&&JSON.parse(row.after_json).id===null)throw new DiffError(409,'The reviewed version is no longer available.');
 return compare(db,row);
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
export async function diffCommand(db:D1Database,userId:string,turnId:string,command:string){const [verb,id,base,...extra]=command.split(/\s+/);if(verb!=='/diff')return;if(!id||extra.length)return {reply:"Choose the saved version to compare, with an optional baseline version or no baseline.",statements:[] as D1PreparedStatement[]};return prepareComparison(db,userId,turnId,id,base);}

export {diffPage,comparisonErrorResponse} from './comparison-page';

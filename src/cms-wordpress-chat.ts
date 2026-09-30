import {inspectCMSWordPress,analyzeCMSWordPress} from './cms-wordpress-api';
import {listCMSWordPressSources} from './cms-wordpress-sources';
import {prepareCMSWordPressImport,prepareCMSWordPressMediaImport} from './cms-wordpress-import';
import {readCMSImport,confirmCMSImport} from './cms-imports';
import {CMSProjectError} from './cms-error';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const operations=['listWordPressSources','inspectWordPressSource','reviewWordPressImport','readWordPressImport'] as const;
const label=(value:string)=>JSON.stringify(value.slice(0,100));
export function describeWordPressImport(row:Awaited<ReturnType<typeof readCMSImport>>){
 const title=JSON.parse(row.body).data.title,terms=JSON.parse(row.taxonomy_plan) as {taxonomy:string;label:string;slug:string}[];
 if(row.status==='imported')return `WordPress article imported as a private draft: ${label(title)}\nProject: ${row.project_id}\nContent request: ${row.id}\nNothing was published. Use /cms-read ${row.project_id} ${row.id} to inspect it.`;
 if(row.status==='superseded')return 'This expired import review was replaced. Open the current review in the publishing desk.';
 if(row.status==='pending'&&row.expires_at<=new Date().toISOString())return 'This import review expired without importing. Prepare a new review of the same source article; the old record is retained.';
 return `${row.status==='approved'?'The approved import needs receipt recovery.':'Review this WordPress import before approving it.'}\nTitle: ${label(title)}\nProject: ${row.project_id}\nSource item: ${row.source_id}\nReview: ${row.id}\nThe exact reviewed content becomes a private draft. Any post excerpt shown in the proposed draft is imported. ${terms.length?'Reviewed categories and tags will be created or reused only if their labels and settings match, then attached before the draft becomes available.\n'+terms.map(t=>`${t.taxonomy==='categories'?'Category':'Tag'}: ${label(t.label)} (${label(t.slug)})`).join('\n'):'Categories and tags are retained as source metadata only in this review.'} ${JSON.parse(row.media_plan).length?'The reviewed local images and their source captions are included. No source image URLs are fetched.':'Media are not installed by this review.'} Authors, historic dates, redirects, themes and plugins are not installed. Nothing is published.\nSend /confirm-cms-import ${row.id} to import this exact private draft.`;
}
/** Intentionally omits approval: model tools may inspect and prepare, never confirm. */
export function cmsWordPressAction(db:D1Database,user:string,action:Record<string,unknown>,id:string,env:Record<string,unknown>):Promise<string>|undefined{
 if(!operations.includes(action.operation as typeof operations[number]))return;
 return (async()=>{
  const op=action.operation,keys=op==='readWordPressImport'?['kind','operation','reviewId']:['kind','operation','projectId',...(op==='listWordPressSources'?[]:['sourceId']),...(op==='reviewWordPressImport'?['sourceItemId','mediaIds']:[])];
  if(Object.keys(action).some(k=>!keys.includes(k)))throw new CMSProjectError(400,'Unsupported WordPress import fields');
  if(op==='readWordPressImport'){if(typeof action.reviewId!=='string'||!uuid.test(action.reviewId))throw new CMSProjectError(400,'Choose an import review');const row=await readCMSImport(db,user,action.reviewId);if(!row.source_upload_id)throw new CMSProjectError(404,'Source-bound review not found');return describeWordPressImport(row);}
  const project=action.projectId;if(typeof project!=='string'||!uuid.test(project))throw new CMSProjectError(400,'Choose an owned publishing space');
  if(op==='listWordPressSources'){const sources=await listCMSWordPressSources(db,user,project,env);return sources.length?'Saved WordPress exports\n'+sources.map(s=>`${label(s.filename)} · ${s.state}\nSource: ${s.id}`).join('\n\n'):'No WordPress exports saved yet. Upload an XML export in the publishing desk; do not paste its contents or credentials into Chat.';}
  const source=action.sourceId;if(typeof source!=='string'||!uuid.test(source))throw new CMSProjectError(400,'Choose a saved source upload');
  const files=env.FILES as R2Bucket|undefined;if(!files)throw new CMSProjectError(503,'Source storage unavailable');
  if(op==='inspectWordPressSource'){const {report}=await inspectCMSWordPress(db,files,user,project,source);return `WordPress conversion report: ${report.summary.reviewable} articles can be reviewed; ${report.summary.needsChanges} need changes; ${report.summary.attachments} attachments were not fetched.\n`+report.articles.slice(0,20).map(a=>`Item ${a.sourceId}: ${label(a.title)} · ${a.status}${a.reasons.length?' · '+a.reasons.join(', '):''}`).join('\n')+(report.articles.length>20?'\nMore articles are available in the publishing desk.':'')+'\nOriginal HTML, export bytes, author details and source URLs are excluded from Chat. No article was imported or published.';}
  if(typeof action.sourceItemId!=='number'||!Number.isSafeInteger(action.sourceItemId)||action.sourceItemId<1)throw new CMSProjectError(400,'Choose a source item number from its report');
  if(action.mediaIds!==undefined){if(!Array.isArray(action.mediaIds)||!action.mediaIds.length||action.mediaIds.length>4||action.mediaIds.some(value=>typeof value!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)))throw new CMSProjectError(400,'Choose up to four confirmed local image IDs in source image order');return describeWordPressImport(await prepareCMSWordPressMediaImport(db,files,user,project,source,action.sourceItemId,id,action.mediaIds.map((mediaId,position)=>({position,mediaId})),env));}
  return describeWordPressImport(await prepareCMSWordPressImport(db,files,user,project,source,action.sourceItemId,id,env,analyzeCMSWordPress));
 })();
}
export function cmsWordPressCommand(db:D1Database,user:string,turn:string,content:string,env:Record<string,unknown>){
 const match=content.match(/^\/(wordpress-sources|wordpress-inspect|import-wordpress|cms-import-review|confirm-cms-import)(?:\s+([\s\S]+))?$/i);if(!match)return;
 return async()=>{try{
  const verb=match[1].toLowerCase(),sections=(match[2]??'').trim().split('|'),parts=sections[0].trim().split(/\s+/);
  if(sections.length>2||sections.length>1&&verb!=='import-wordpress')throw new CMSProjectError(400,'Only /import-wordpress accepts local image IDs after |');
  const mediaIds=sections.length===2?sections[1].trim().split(/\s+/):undefined;
  if(verb==='confirm-cms-import'){if(parts.length!==1||!uuid.test(parts[0]))throw new CMSProjectError(400,'Use /confirm-cms-import REVIEW_ID');const row=await readCMSImport(db,user,parts[0]);if(!row.source_upload_id)throw new CMSProjectError(404,'Source-bound review not found');return describeWordPressImport(await confirmCMSImport(db,user,parts[0],env));}
  const count=verb==='wordpress-sources'||verb==='cms-import-review'?1:verb==='wordpress-inspect'?2:3;
  if(parts.length!==count||!uuid.test(parts[0])||count>1&&!uuid.test(parts[1])||count===3&&!/^[1-9]\d{0,15}$/.test(parts[2]))throw new CMSProjectError(400,'Use /wordpress-sources PROJECT_ID, /wordpress-inspect PROJECT_ID SOURCE_ID, /import-wordpress PROJECT_ID SOURCE_ID ITEM_NUMBER, or /cms-import-review REVIEW_ID');
  const operation=verb==='wordpress-sources'?'listWordPressSources':verb==='wordpress-inspect'?'inspectWordPressSource':verb==='cms-import-review'?'readWordPressImport':'reviewWordPressImport';
  return (await cmsWordPressAction(db,user,{kind:'cms',operation,...(verb==='cms-import-review'?{reviewId:parts[0]}:{projectId:parts[0],...(count>1?{sourceId:parts[1]}:{}),...(count===3?{sourceItemId:Number(parts[2]),...(mediaIds?{mediaIds}:{})}:{})})},turn,env))!;
 }catch(e){return e instanceof CMSProjectError?e.message:'The WordPress request could not be completed. Inspect the saved source or review before trying a replacement.';}};
}
export async function cmsWordPressLinks(db:D1Database,user:string){return (await db.prepare("SELECT t.id turn_id,r.id,r.project_id,r.status,r.expires_at, instr(t.assistant_text,'Send /confirm-cms-import '||r.id||' to import this exact private draft.')>0 can_confirm FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id JOIN chat_turns t ON t.user_id=r.user_id AND (t.id=r.id OR lower(trim(t.user_text))='/cms-import-review '||r.id OR lower(trim(t.user_text))='/confirm-cms-import '||r.id) WHERE r.user_id=? AND p.owner_user_id=r.user_id AND r.source_upload_id IS NOT NULL AND t.status='completed' ORDER BY t.revision DESC LIMIT 100").bind(user).all<{turn_id:string;id:string;project_id:string;status:string;expires_at:string;can_confirm:number}>()).results;}

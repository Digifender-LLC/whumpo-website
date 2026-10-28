import {reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {captureCMSArticleImages,type CMSArticleImage} from './cms-article-images';
import {freezeCMSPublicationMedia,inlineCMSPublicationImages} from './cms-publication-media';
import {readCMSDraft} from './cms-content';
import {renderCMSDraft} from './cms-preview';
import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
import {hashToken} from './security';
import {requireApprovedCMSMedia} from './cms-media-safety';
import {previewHeaders} from './components';
type Review={media_manifest:string;id:string;draft_request_id:string;user_id:string;project_id:string;collection:string;item_id:string;revision:string;snapshot:string;preview_html:string;public_html:string;digest:string;status:string;withdrawn:number;replaces_publication_id:string|null;expires_at:string};
export const cmsPublicURL=(r:Pick<Review,'project_id'|'collection'|'item_id'>)=>`https://${r.project_id}.whumpo.site/cms/${r.collection}/${r.item_id}`;
export async function readCMSPublication(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT r.* FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Review>();if(!row)throw new CMSProjectError(404,'CMS publication review not found');return row;}
export async function prepareCMSPublication(db:D1Database,user:string,project:string,draft:string,id:string,env:Record<string,unknown>){
 if(!/^[0-9a-f-]{36}$/.test(id))throw new CMSProjectError(400,'Invalid review ID');
 const old=await db.prepare('SELECT id FROM cms_publication_reviews WHERE id=?').bind(id).first();
 if(old){const row=await readCMSPublication(db,user,id);if(row.project_id!==project||row.draft_request_id!==draft)throw new CMSProjectError(409,'Review ID already used');await recoverImages(db,user,row,env);return row;}
 const snap=await readCMSDraft(db,user,project,draft,env);if(typeof snap.revision!=='string'||!snap.revision)throw new CMSProjectError(409,'CMS revision unavailable');
 const base=await db.prepare("SELECT id FROM cms_publication_reviews WHERE project_id=? AND collection=? AND item_id=? AND status='published' AND withdrawn=0").bind(project,snap.collection,snap.item.id).first<{id:string}>();
 if(snap.item.status==='published'&&(!base||!snap.item.draftRevisionId||!snap.item.liveData))throw new CMSProjectError(409,'Read and stage changes to the current live article before preparing its replacement.');
 if(snap.item.status==='draft'&&base)throw new CMSProjectError(409,'Native CMS and public article state need reconciliation before publication.');
 if(new TextEncoder().encode(JSON.stringify(snap)).length>16384)throw new CMSProjectError(409,'This article exceeds the current publication snapshot limit');
 const images=await captureCMSArticleImages(db,user,project,snap.item.data?.content,env),manifest=images.map(({bytes,...metadata})=>metadata);
 // Publication reviews may only freeze currently cleared exact media; held media keep the draft private.
 await requireApprovedCMSMedia(db,user,project,manifest);
 const resolveImage=(image:{asset:{_ref:string}})=>{const found=manifest.find(m=>m.mediaId===image.asset._ref);if(!found)throw new CMSProjectError(409,'Article image could not be captured');return {src:`/cms/media/${id}/${found.digest}.jpg`,width:found.width,height:found.height};};
 const privateHTML=renderCMSDraft(snap,false,resolveImage),publicHTML=renderCMSDraft(snap,true,resolveImage),digest=await hashToken(publicHTML);
 try{await db.prepare('INSERT INTO cms_publication_reviews(id,draft_request_id,user_id,project_id,collection,item_id,revision,snapshot,preview_html,public_html,digest,replaces_publication_id,media_manifest) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,draft,user,project,snap.collection,snap.item.id,snap.revision,JSON.stringify(snap),privateHTML,publicHTML,digest,base?.id??null,JSON.stringify(manifest)).run();}catch{}
 const row=await readCMSPublication(db,user,id);if(row.project_id!==project||row.draft_request_id!==draft)throw new CMSProjectError(409,'Review ID already used');await recoverImages(db,user,row,env,images);return row;
}
async function recoverImages(db:D1Database,user:string,row:Review,env:Record<string,unknown>,captured?:CMSArticleImage[]){
 if(!JSON.parse(row.media_manifest??'[]').length)return;
 const files=env.FILES as R2Bucket|undefined;if(!files)throw new CMSProjectError(503,'Article image storage is unavailable');
 try{await freezeCMSPublicationMedia(db,files,user,row.id,captured??[]);}
 catch(error){
  if(error instanceof CMSProjectError&&error.status===423)throw error;
  if(!(error instanceof CMSProjectError)||error.status!==409||captured)throw new CMSProjectError(503,'Publication images need recovery. Ask to recover saved publication review '+row.id);
  const images=await captureCMSArticleImages(db,user,row.project_id,JSON.parse(row.snapshot).item.data.content,env);
  await freezeCMSPublicationMedia(db,files,user,row.id,images);
 }
}
export async function confirmCMSPublication(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSPublication(db,user,id);if(row.status==='published')return row;
 await recoverImages(db,user,row,env);
 const {service,config}=await cmsConnection(db,user,row.project_id,env);
 if(row.status==='pending'){
  const current=await readCMSDraft(db,user,row.project_id,row.draft_request_id,env);
  if(current.item.status!==(row.replaces_publication_id?'published':'draft')||current.revision!==row.revision||JSON.stringify(current.item.data)!==JSON.stringify(JSON.parse(row.snapshot).item.data))throw new CMSProjectError(409,'CMS draft changed. Read it and prepare a new publication review.');
  try{await db.prepare("UPDATE cms_publication_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}
  row=await readCMSPublication(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'CMS publication review expired, its live version changed, or another publication/unpublish needs recovery');
 }
 if(row.status==='approved'){
  try{const data=await callCMS(service,config,`/_emdash/api/content/${row.collection}/${row.item_id}/publish`,row.id,{_rev:row.revision});
   if(data?.item?.id!==row.item_id||data.item.status!=='published'||JSON.stringify(data.item.data)!==JSON.stringify(JSON.parse(row.snapshot).item.data))throw Error('Published content mismatch');
   await db.prepare("UPDATE cms_publication_reviews SET status='published' WHERE id=? AND status='approved'").bind(id).run();
  }catch{}
  row=await readCMSPublication(db,user,id);
 }
 if(row.status!=='published')throw new CMSProjectError(503,"Publication outcome is unresolved. Reopen saved publication review "+id+' to recover this exact approved request; do not prepare a replacement.');return row;
}
export function describeCMSPublication(r:Review){return r.withdrawn?`This historical publication is no longer current. Its content and history are retained. Publication: ${r.id}`:r.status==='published'?`CMS article published: ${cmsPublicURL(r)}\nReview: ${r.id}`:`Review CMS publication\nProject: ${r.project_id}\nTitle: ${JSON.parse(r.snapshot).item.data.title}\nDestination: ${cmsPublicURL(r)}\n${r.replaces_publication_id?'Replaces publication: '+r.replaces_publication_id+' (the current article stays live until confirmation succeeds)\n':''}Revision: ${r.revision}\nArticle SHA-256: ${r.digest}\nFrozen images: ${JSON.parse(r.media_manifest??'[]').length}\nPublish this exact native EmDash revision and make the reviewed article publicly accessible at the destination above.\nExpires: ${r.expires_at}\nUse the confirmation button for publication ${r.id} to publish this exact article.`;}
export async function cmsPublicationPage(db:D1Database,user:string,id:string,files?:R2Bucket){const row=await readCMSPublication(db,user,id);if(await hashToken(row.public_html)!==row.digest)throw new CMSProjectError(503,'Publication preview could not be verified');const images=JSON.parse(row.media_manifest??'[]').length>0;if(images&&!files)throw new CMSProjectError(503,'Article image storage is unavailable');const html=images?await inlineCMSPublicationImages(db,files!,user,id,row.public_html):row.public_html;return new Response(html,{headers:{...previewHeaders,'content-security-policy':previewHeaders['content-security-policy']+(images?'; img-src data:':''),'x-robots-tag':'noindex, nofollow'}});}
export function cmsPublicationCommand(db:D1Database,user:string,turn:string,content:string,env:Record<string,unknown>){const match=content.match(/^\/(publish-cms|cms-publication|confirm-cms-publish|cms-publications|recover-cms-publish)(?:\s+([\s\S]+))?$/i);if(!match)return;return async()=>{try{const parts=(match[2]??'').trim().split(/\s+/),verb=match[1].toLowerCase();if(verb==='cms-publications'){if(parts.length!==1)throw new CMSProjectError(400,"Choose the publishing space whose publication history you want to read.");return JSON.stringify(await listCMSPublications(db,user,parts[0]),null,2);}if(verb==='publish-cms'){if(parts.length!==2)throw new CMSProjectError(400,"Choose the project and saved article for its publication review.");return describeCMSPublication(await prepareCMSPublication(db,user,parts[0],parts[1],turn,env));}if(parts.length!==1)throw new CMSProjectError(400,'Choose a publication review ID');if(verb==='confirm-cms-publish'&&!await reviewedReply(db,user,'cmsPublish',parts[0]))throw new CMSProjectError(409,reviewChangedMessage);if(verb==='recover-cms-publish'){const saved=await readCMSPublication(db,user,parts[0]);return describeCMSPublication(await prepareCMSPublication(db,user,saved.project_id,saved.draft_request_id,saved.id,env));}return describeCMSPublication(await(verb==='confirm-cms-publish'?confirmCMSPublication(db,user,parts[0],env):readCMSPublication(db,user,parts[0])));}catch(e){return e instanceof CMSProjectError?e.message:'CMS publication could not be confirmed. Read the existing review before another attempt.';}};}
export async function cmsPublicationLinks(db:D1Database,user:string){return (await db.prepare("SELECT t.id AS turn_id,r.id,r.status,r.withdrawn,r.expires_at,r.project_id,r.collection,r.item_id FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id JOIN chat_turns t ON t.user_id=r.user_id AND (t.id=r.id OR (json_extract(t.action_json,'$.type')='confirm' AND json_extract(t.action_json,'$.kind')='cmsPublish' AND json_extract(t.action_json,'$.reviewId')=r.id)) WHERE r.user_id=? AND p.owner_user_id=r.user_id AND t.status='completed' AND instr(t.assistant_text,'Use the confirmation button for publication '||r.id||' to publish this exact article.')>0 ORDER BY t.revision DESC LIMIT 100").bind(user).all()).results;}

export async function listCMSPublications(db:D1Database,user:string,project:string){
 if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new CMSProjectError(404,'Project not found');
 return (await db.prepare("SELECT id,draft_request_id,collection,item_id,status,withdrawn,replaces_publication_id,json_extract(snapshot,'$.item.data.title') AS title,created_at FROM cms_publication_reviews WHERE project_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 100").bind(project,user).all()).results;
}

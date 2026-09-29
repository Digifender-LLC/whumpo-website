import {readCMSDraft} from './cms-content';
import {renderCMSDraft} from './cms-preview';
import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
import {hashToken} from './security';
import {previewHeaders} from './components';
type Review={id:string;draft_request_id:string;user_id:string;project_id:string;collection:string;item_id:string;revision:string;snapshot:string;preview_html:string;public_html:string;digest:string;status:string;withdrawn:number;expires_at:string};
export const cmsPublicURL=(r:Pick<Review,'project_id'|'collection'|'item_id'>)=>`https://sites.digifender.com/s/${r.project_id}/cms/${r.collection}/${r.item_id}`;
export async function readCMSPublication(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT r.* FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Review>();if(!row)throw new CMSProjectError(404,'CMS publication review not found');return row;}
export async function prepareCMSPublication(db:D1Database,user:string,project:string,draft:string,id:string,env:Record<string,unknown>){
 if(!/^[0-9a-f-]{36}$/.test(id))throw new CMSProjectError(400,'Invalid review ID');
 const old=await db.prepare('SELECT id FROM cms_publication_reviews WHERE id=?').bind(id).first();
 if(old){const row=await readCMSPublication(db,user,id);if(row.project_id!==project||row.draft_request_id!==draft)throw new CMSProjectError(409,'Review ID already used');return row;}
 const snap=await readCMSDraft(db,user,project,draft,env);if(typeof snap.revision!=='string'||!snap.revision)throw new CMSProjectError(409,'CMS revision unavailable');
 const privateHTML=renderCMSDraft(snap),publicHTML=renderCMSDraft(snap,true),digest=await hashToken(publicHTML);
 try{await db.prepare('INSERT INTO cms_publication_reviews(id,draft_request_id,user_id,project_id,collection,item_id,revision,snapshot,preview_html,public_html,digest) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,draft,user,project,snap.collection,snap.item.id,snap.revision,JSON.stringify(snap),privateHTML,publicHTML,digest).run();}catch{}
 const row=await readCMSPublication(db,user,id);if(row.project_id!==project||row.draft_request_id!==draft)throw new CMSProjectError(409,'Review ID already used');return row;
}
export async function confirmCMSPublication(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSPublication(db,user,id);if(row.status==='published')return row;
 const {service,config}=await cmsConnection(db,user,row.project_id,env);
 if(row.status==='pending'){
  const current=await readCMSDraft(db,user,row.project_id,row.draft_request_id,env);
  if(current.item.status!=='draft'||current.revision!==row.revision||JSON.stringify(current.item.data)!==JSON.stringify(JSON.parse(row.snapshot).item.data))throw new CMSProjectError(409,'CMS draft changed. Read it and prepare a new publication review.');
  try{await db.prepare("UPDATE cms_publication_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}
  row=await readCMSPublication(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'CMS publication review expired or native unpublish recovery is pending');
 }
 if(row.status==='approved'){
  try{const data=await callCMS(service,config,`/_emdash/api/content/${row.collection}/${row.item_id}/publish`,row.id,{_rev:row.revision});
   if(data?.item?.id!==row.item_id||data.item.status!=='published'||JSON.stringify(data.item.data)!==JSON.stringify(JSON.parse(row.snapshot).item.data))throw Error('Published content mismatch');
   await db.prepare("UPDATE cms_publication_reviews SET status='published' WHERE id=? AND status='approved'").bind(id).run();
  }catch{}
  row=await readCMSPublication(db,user,id);
 }
 if(row.status!=='published')throw new CMSProjectError(503,'Publication outcome is unresolved. Use /confirm-cms-publish '+id+' to recover this exact approved request; do not prepare a replacement.');return row;
}
export function describeCMSPublication(r:Review){return r.withdrawn?`This publication was withdrawn. Its content and history are retained. Publication: ${r.id}`:r.status==='published'?`CMS article published: ${cmsPublicURL(r)}\nReview: ${r.id}`:`Review CMS publication\nProject: ${r.project_id}\nTitle: ${JSON.parse(r.snapshot).item.data.title}\nDestination: ${cmsPublicURL(r)}\nRevision: ${r.revision}\nArticle SHA-256: ${r.digest}\nPublish this exact native EmDash revision and make the reviewed article publicly accessible at the destination above.\nExpires: ${r.expires_at}\nSend /confirm-cms-publish ${r.id} to publish this exact article.`;}
export async function cmsPublicationPage(db:D1Database,user:string,id:string){const row=await readCMSPublication(db,user,id);return new Response(row.public_html,{headers:{...previewHeaders,'x-robots-tag':'noindex, nofollow'}});}
export function cmsPublicationCommand(db:D1Database,user:string,turn:string,content:string,env:Record<string,unknown>){const match=content.match(/^\/(publish-cms|cms-publication|confirm-cms-publish|cms-publications)(?:\s+([\s\S]+))?$/i);if(!match)return;return async()=>{try{const parts=(match[2]??'').trim().split(/\s+/),verb=match[1].toLowerCase();if(verb==='cms-publications'){if(parts.length!==1)throw new CMSProjectError(400,'Use /cms-publications PROJECT_ID');return JSON.stringify(await listCMSPublications(db,user,parts[0]),null,2);}if(verb==='publish-cms'){if(parts.length!==2)throw new CMSProjectError(400,'Use /publish-cms PROJECT_ID DRAFT_REQUEST_ID');return describeCMSPublication(await prepareCMSPublication(db,user,parts[0],parts[1],turn,env));}if(parts.length!==1)throw new CMSProjectError(400,'Choose a publication review ID');return describeCMSPublication(await(verb==='confirm-cms-publish'?confirmCMSPublication(db,user,parts[0],env):readCMSPublication(db,user,parts[0])));}catch(e){return e instanceof CMSProjectError?e.message:'CMS publication could not be confirmed. Read the existing review before another attempt.';}};}
export async function cmsPublicationLinks(db:D1Database,user:string){return (await db.prepare("SELECT t.id AS turn_id,r.id,r.status,r.withdrawn,r.expires_at,r.project_id,r.collection,r.item_id FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id JOIN chat_turns t ON t.id=r.id AND t.user_id=r.user_id WHERE r.user_id=? AND p.owner_user_id=r.user_id AND t.status='completed' AND instr(t.assistant_text,'Send /confirm-cms-publish '||r.id||' to publish this exact article.')>0 ORDER BY t.revision DESC LIMIT 100").bind(user).all()).results;}

export async function listCMSPublications(db:D1Database,user:string,project:string){
 if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new CMSProjectError(404,'Project not found');
 return (await db.prepare("SELECT id,draft_request_id,collection,item_id,status,withdrawn,json_extract(snapshot,'$.item.data.title') AS title,created_at FROM cms_publication_reviews WHERE project_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 100").bind(project,user).all()).results;
}

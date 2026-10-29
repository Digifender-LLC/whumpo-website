import {reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {readCMSPublication,cmsPublicURL} from './cms-publication';
import {readCMSDraft} from './cms-content';
import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
import {admitWithTurnover,compactedReview} from './review-turnover';
type Removal={id:string;publication_id:string;user_id:string;revision:string;status:string;expires_at:string};
export async function readCMSUnpublish(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT u.* FROM cms_unpublish_reviews u JOIN cms_publication_reviews r ON r.id=u.publication_id JOIN projects p ON p.id=r.project_id WHERE u.id=? AND u.user_id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user,user).first<Removal>();if(!row)throw await compactedReview(db,'cms_unpublish_reviews',id,user,(s,m)=>new CMSProjectError(s,m))??new CMSProjectError(404,'CMS unpublish review not found');return row;}
export async function prepareCMSUnpublish(db:D1Database,user:string,publication:string,id:string,env:Record<string,unknown>){
 if(!/^[0-9a-f-]{36}$/.test(id))throw new CMSProjectError(400,'Invalid review ID');
 if(await db.prepare('SELECT id FROM cms_unpublish_reviews WHERE id=?').bind(id).first()){const row=await readCMSUnpublish(db,user,id);if(row.publication_id!==publication)throw new CMSProjectError(409,'Review ID already used');return row;}
 const gone=await compactedReview(db,'cms_unpublish_reviews',id,user,(s,m)=>new CMSProjectError(s,m));if(gone)throw gone;
 const published=await readCMSPublication(db,user,publication);if(published.status!=='published'||published.withdrawn)throw new CMSProjectError(409,'This publication is not currently public');
 const current=await readCMSDraft(db,user,published.project_id,published.draft_request_id,env);if(current.item.status!=='published'||typeof current.revision!=='string')throw new CMSProjectError(409,'Native CMS publication state could not be verified');
 try{await admitWithTurnover(db,'cms_unpublish_reviews',{user},db.prepare('INSERT INTO cms_unpublish_reviews(id,publication_id,user_id,revision) VALUES(?,?,?,?)').bind(id,publication,user,current.revision));}catch{}
 return readCMSUnpublish(db,user,id);
}
export async function confirmCMSUnpublish(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSUnpublish(db,user,id);if(row.status==='complete')return row;
 const published=await readCMSPublication(db,user,row.publication_id);
 if(row.status==='pending'){
  try{await db.prepare("UPDATE cms_unpublish_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}
  row=await readCMSUnpublish(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'Unpublish review expired, this publication is no longer current, or an approved replacement needs recovery');
 }
 // Approval atomically hides the exact public snapshot before external work. No uncertain reply re-exposes it.
 if(row.status==='approved'){
  try{const {service,config}=await cmsConnection(db,user,published.project_id,env),data=await callCMS(service,config,`/_emdash/api/content/${published.collection}/${published.item_id}/unpublish`,row.id,{_rev:row.revision});
   if(data?.item?.id!==published.item_id||data.item.status!=='draft')throw Error('CMS unpublish not verified');
   await db.prepare("UPDATE cms_unpublish_reviews SET status='complete' WHERE id=? AND status='approved'").bind(id).run();
  }catch{}
  row=await readCMSUnpublish(db,user,id);
 }
 if(row.status!=='complete')throw new CMSProjectError(503,"The public article is offline. Native CMS unpublish is unresolved; reopen saved withdrawal review "+id+' to recover this exact request.');return row;
}
export async function describeCMSUnpublish(db:D1Database,user:string,row:Removal){const pub=await readCMSPublication(db,user,row.publication_id);return row.status==='complete'?`Unpublish completed for this publication. Content and publication history are retained.\nPublication: ${pub.id}\nAsk to inspect the saved article.`:row.status==='approved'?`The public article is offline. Native CMS unpublish needs recovery. Reopen withdrawal review ${row.id} and use its confirmation control to recover this exact request.`:`Review CMS unpublish\nPublication: ${pub.id}\nArticle: ${cmsPublicURL(pub)}\nNative revision: ${row.revision}\nConfirmation removes this exact article from public serving immediately, then returns the native content to draft. Content and history are retained. Copies previously saved by visitors cannot be recalled.\nExpires: ${row.expires_at}\nUse the confirmation button for withdrawal ${row.id} to take this exact article offline.`;}
export function cmsUnpublishCommand(db:D1Database,user:string,turn:string,content:string,env:Record<string,unknown>){const m=content.match(/^\/(unpublish-cms|cms-unpublish-review|confirm-cms-unpublish)\s+([0-9a-f-]{36})$/i);if(!m)return;return async()=>{try{const verb=m[1].toLowerCase();if(verb==='confirm-cms-unpublish'&&!await reviewedReply(db,user,'cmsUnpublish',m[2]))throw new CMSProjectError(409,reviewChangedMessage);return describeCMSUnpublish(db,user,await(verb==='unpublish-cms'?prepareCMSUnpublish(db,user,m[2],turn,env):verb==='confirm-cms-unpublish'?confirmCMSUnpublish(db,user,m[2],env):readCMSUnpublish(db,user,m[2])));}catch(e){return e instanceof CMSProjectError?e.message:'CMS unpublish could not be confirmed. Inspect the existing review before another attempt.';}};}
export async function cmsUnpublishLinks(db:D1Database,user:string){return (await db.prepare("SELECT t.id AS turn_id,u.id,u.status,u.expires_at,r.withdrawn FROM cms_unpublish_reviews u JOIN cms_publication_reviews r ON r.id=u.publication_id JOIN projects p ON p.id=r.project_id JOIN chat_turns t ON t.id=u.id AND t.user_id=u.user_id WHERE u.user_id=? AND p.owner_user_id=u.user_id AND t.status='completed' AND instr(t.assistant_text,'Use the confirmation button for withdrawal '||u.id||' to take this exact article offline.')>0 ORDER BY t.revision DESC LIMIT 100").bind(user).all()).results;}

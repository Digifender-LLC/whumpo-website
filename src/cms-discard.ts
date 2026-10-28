import {reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {readCMSPublication} from './cms-publication';
import {readCMSDraft} from './cms-content';
import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
type Review={id:string;publication_id:string;user_id:string;revision:string;snapshot:string;status:string;expires_at:string};
export async function readCMSDiscard(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT d.* FROM cms_discard_reviews d JOIN cms_publication_reviews p ON p.id=d.publication_id JOIN projects project ON project.id=p.project_id WHERE d.id=? AND d.user_id=? AND p.user_id=? AND project.owner_user_id=?').bind(id,user,user,user).first<Review>();
 if(!row)throw new CMSProjectError(404,'CMS discard review not found');return row;
}
export async function prepareCMSDiscard(db:D1Database,user:string,publication:string,id:string,env:Record<string,unknown>){
 if(!/^[0-9a-f-]{36}$/.test(id))throw new CMSProjectError(400,'Invalid review ID');
 if(await db.prepare('SELECT id FROM cms_discard_reviews WHERE id=?').bind(id).first()){const row=await readCMSDiscard(db,user,id);if(row.publication_id!==publication)throw new CMSProjectError(409,'Review ID already used');return row;}
 const pub=await readCMSPublication(db,user,publication);if(pub.status!=='published'||pub.withdrawn)throw new CMSProjectError(409,'Choose the current live publication');
 const snap=await readCMSDraft(db,user,pub.project_id,pub.draft_request_id,env);
 if(snap.item.status!=='published'||!snap.item.draftRevisionId||!snap.item.liveData||typeof snap.revision!=='string')throw new CMSProjectError(409,'This live article has no staged changes to discard');
 if(JSON.stringify(snap.item.liveData)!==JSON.stringify(JSON.parse(pub.snapshot).item.data))throw new CMSProjectError(409,'Native live content needs reconciliation before discarding changes');
 try{await db.prepare('INSERT INTO cms_discard_reviews(id,publication_id,user_id,revision,snapshot) VALUES(?,?,?,?,?)').bind(id,publication,user,snap.revision,JSON.stringify(snap)).run();}catch{}
 return readCMSDiscard(db,user,id);
}
export async function confirmCMSDiscard(db:D1Database,user:string,id:string,env:Record<string,unknown>){
 let row=await readCMSDiscard(db,user,id);if(row.status==='complete')return row;
 const pub=await readCMSPublication(db,user,row.publication_id),{service,config}=await cmsConnection(db,user,pub.project_id,env);
 if(row.status==='pending'){
  const snap=await readCMSDraft(db,user,pub.project_id,pub.draft_request_id,env);
  if(snap.revision!==row.revision||snap.item.status!=='published'||!snap.item.draftRevisionId)throw new CMSProjectError(409,'The staged draft changed. Read it and prepare a new discard review.');
  try{await db.prepare("UPDATE cms_discard_reviews SET status='approved' WHERE id=? AND status='pending'").bind(id).run();}catch{}
  row=await readCMSDiscard(db,user,id);if(row.status==='pending')throw new CMSProjectError(409,'Discard review expired, its publication changed, or another operation needs recovery');
 }
 try{
  const data=await callCMS(service,config,`/_emdash/api/content/${pub.collection}/${pub.item_id}/discard-draft`,id,{_rev:row.revision});
  if(data?.item?.id!==pub.item_id||data.item.status!=='published'||data.item.draftRevisionId||JSON.stringify(data.item.data)!==JSON.stringify(JSON.parse(row.snapshot).item.liveData))throw Error('Discard result mismatch');
  await db.prepare("UPDATE cms_discard_reviews SET status='complete' WHERE id=? AND status='approved'").bind(id).run();
 }catch{}
 row=await readCMSDiscard(db,user,id);if(row.status!=='complete')throw new CMSProjectError(503,"Discard outcome is unresolved. The public article is unchanged. Reopen the saved discard review "+id+' to recover this exact request.');return row;
}
export function describeCMSDiscard(row:Review){
 if(row.status==='complete')return `Staged changes were discarded for this review. The published article was unchanged. Read the article again for current draft state.\nReview: ${row.id}`;
 const snap=JSON.parse(row.snapshot);
 return `Review discarding staged CMS changes\nPublication: ${row.publication_id}\nStaged title: ${snap.item.data.title}\nStaged body to discard: ${(snap.item.data.content??[]).map((b:any)=>(b.children??[]).map((c:any)=>c.text??'').join('')).join('\n')}\nPublished title kept: ${snap.item.liveData.title}\nRevision: ${row.revision}\nThis removes the staged revision from the current article and returns editing to the published content. The public article stays unchanged.\nExpires: ${row.expires_at}\nUse the confirmation button for discard review ${row.id} to discard these exact staged changes.`;
}
export function cmsDiscardCommand(db:D1Database,user:string,turn:string,text:string,env:Record<string,unknown>){const m=text.match(/^\/(discard-cms|cms-discard-review|confirm-cms-discard)\s+([0-9a-f-]{36})$/i);if(!m)return;return async()=>{try{if(m[1].toLowerCase()==='confirm-cms-discard'&&!await reviewedReply(db,user,'cmsDiscard',m[2]))throw new CMSProjectError(409,reviewChangedMessage);return describeCMSDiscard(await(m[1].toLowerCase()==='discard-cms'?prepareCMSDiscard(db,user,m[2],turn,env):m[1].toLowerCase()==='cms-discard-review'?readCMSDiscard(db,user,m[2]):confirmCMSDiscard(db,user,m[2],env)));}catch(e){return e instanceof CMSProjectError?e.message:'CMS discard could not be confirmed. Inspect the existing review before retrying.';}};}
export async function cmsDiscardLinks(db:D1Database,user:string){return (await db.prepare("SELECT t.id AS turn_id,d.id,d.status,d.expires_at,p.withdrawn FROM cms_discard_reviews d JOIN cms_publication_reviews p ON p.id=d.publication_id JOIN projects project ON project.id=p.project_id JOIN chat_turns t ON t.id=d.id AND t.user_id=d.user_id WHERE d.user_id=? AND project.owner_user_id=d.user_id AND t.status='completed' AND instr(t.assistant_text,'Use the confirmation button for discard review '||d.id||' to discard these exact staged changes.')>0 ORDER BY t.revision DESC LIMIT 100").bind(user).all()).results;}

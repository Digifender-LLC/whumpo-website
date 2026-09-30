import {cmsImageReferences} from './cms-image-block';
import {captureCMSArticleImages} from './cms-article-images';
import {validateCMSRichContent} from './cms-rich-text';
import {editableCMS} from './cms-plain-text';
import {cmsConnection,requireStructuredCMS,requireCMSImages} from './cms-status';
import {callCMS,CMSBridgeError} from './cms-bridge';
import {cmsEditBody,cmsStagedEditBody,cmsRichEditBody} from './cms-content-shape';
import {readCMSDraft,type ContentFormat} from './cms-content';
import {CMSProjectError} from './cms-projects';
type Row={id:string;draft_request_id:string;body:string;result:string|null;content_format:ContentFormat};
export async function editCMSDraft(db:D1Database,user:string,project:string,id:string,draftId:string,title:unknown,text:unknown,revision:unknown,env:Record<string,unknown>,format:ContentFormat='plain'){
 const {service,config}=await cmsConnection(db,user,project,env);
 if(!/^[0-9a-f-]{36}$/.test(id))throw new CMSProjectError(400,'Choose a valid edit request ID');
 const draft=await db.prepare('SELECT collection,item_id FROM cms_draft_requests WHERE id=? AND user_id=? AND project_id=?').bind(draftId,user,project).first<{collection:string;item_id:string}>();
 if(!draft?.item_id)throw new CMSProjectError(404,'CMS draft not found');
 const read=()=>db.prepare('SELECT * FROM cms_edit_requests WHERE id=?').bind(id).first<Row>();let row=await read();const recovering=!!row;
 // Preserve pre-staging operation bodies exactly when recovering historical receipts.
 let body:string;try{body=JSON.stringify((format==='structured'?cmsRichEditBody:row&&JSON.parse(row.body).status==='draft'?cmsEditBody:cmsStagedEditBody)(title,text,revision));}catch(e){throw new CMSProjectError(400,(e as Error).message);}
 if(!row){
  if(format==='structured'&&cmsImageReferences(text).length){await requireCMSImages(db,user,project,env);await captureCMSArticleImages(db,user,project,text,env);}
  if(format==='structured')await requireStructuredCMS(db,user,project,env);
  const current=await readCMSDraft(db,user,project,draftId,env);
  if(!['draft','published'].includes(current.item.status)||current.revision!==revision)throw new CMSProjectError(409,'Content changed or cannot be edited. Read it again before preparing an edit.');
  if(format==='structured'){try{validateCMSRichContent(current.item.data?.content);}catch{throw new CMSProjectError(409,'This article contains unsupported formatting. Download it before editing; no content was changed.');}}
  if(format==='plain'&&!editableCMS(current))throw new CMSProjectError(409,'This article has formatting or content that a plain-text edit would remove. Its saved content is unchanged. Preview or download it in the publishing desk; a rich-text editor is needed to change it safely.');
  try{await db.prepare('INSERT INTO cms_edit_requests(id,draft_request_id,body,content_format) VALUES(?,?,?,?)').bind(id,draftId,body,format).run();}catch{}row=await read();
 }
 if(!row)throw new CMSProjectError(409,'CMS edit request capacity is full or unavailable');
 if(row.draft_request_id!==draftId||row.body!==body||row.content_format!==format)throw new CMSProjectError(409,'CMS edit request ID already used');
 if(!row.result){
  if(format==='structured'&&cmsImageReferences(text).length)await requireCMSImages(db,user,project,env);
  if(format==='structured')await requireStructuredCMS(db,user,project,env);
  // A historical unresolved request can still be undispatched. Do not flatten a
  // rich revision that is still current; changed revisions can only recover
  // their original native receipt or fail the existing revision precondition.
  if(recovering){const current=await readCMSDraft(db,user,project,draftId,env);
  if(current.revision===revision&&format==='structured'){try{validateCMSRichContent(current.item.data?.content);}catch{throw new CMSProjectError(409,'Current content has unsupported formatting; this saved request cannot replace it safely.');}}
  if(current.revision===revision&&format==='plain'&&!editableCMS(current))throw new CMSProjectError(409,'This saved plain-text request would remove current article formatting. Content is unchanged; use the publishing desk to preview or download it.');}
  try{const data=await callCMS(service,config,'/_emdash/api/content/'+draft.collection+'/'+draft.item_id,id,JSON.parse(body),'PUT');
   if(data?.item?.id!==draft.item_id||!['draft','published'].includes(data.item.status)||(data.item.status==='published'&&(!data.item.draftRevisionId||!data.item.liveData))||typeof data._rev!=='string'||data._rev.length>256)throw Error('Invalid edit receipt');
   const result=JSON.stringify({editRequestId:id,requestId:draftId,projectId:project,itemId:draft.item_id,status:data.item.status,staged:true,publicationChanged:false,revision:data._rev});
   await db.prepare('UPDATE cms_edit_requests SET result=? WHERE id=? AND result IS NULL').bind(result,id).run();
  }catch(error){if(error instanceof CMSBridgeError&&error.status===409)throw new CMSProjectError(409,error.message+' Edit request: '+id);}
  row=await read();
 }
 if(!row?.result)throw new CMSProjectError(503,'CMS edit outcome is unresolved. Use /cms-retry-edit '+project+' '+id+' to recover this exact request.');
 return JSON.parse(row.result);
}
export async function cmsEditAction(db:D1Database,user:string,action:Record<string,unknown>,id:string,env:Record<string,unknown>){
 const project=action.projectId,draftId=action.requestId;
 if(typeof project!=='string'||typeof draftId!=='string')throw new CMSProjectError(400,'Choose project and request IDs');
 await cmsConnection(db,user,project,env);
 const keys=['editDraft','editStructuredDraft'].includes(String(action.operation))?['kind','operation','projectId','requestId','title',action.operation==='editStructuredDraft'?'content':'text','revision']:['kind','operation','projectId','requestId'];
 if(Object.keys(action).some(k=>!keys.includes(k)))throw new CMSProjectError(400,'Unsupported CMS edit fields');
 if(action.operation==='editStructuredDraft')return editCMSDraft(db,user,project,id,draftId,action.title,action.content,action.revision,env,'structured');
 if(action.operation==='editDraft')return editCMSDraft(db,user,project,id,draftId,action.title,action.text,action.revision,env);
 if(action.operation==='listEdits'){
  if(!await db.prepare('SELECT id FROM cms_draft_requests WHERE id=? AND user_id=? AND project_id=?').bind(draftId,user,project).first())throw new CMSProjectError(404,'CMS draft not found');
  return (await db.prepare('SELECT id,result,created_at FROM cms_edit_requests WHERE draft_request_id=? ORDER BY created_at DESC,id LIMIT 90').bind(draftId).all()).results;
 }
 if(action.operation==='retryEdit'){
  const row=await db.prepare('SELECT e.* FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id WHERE e.id=? AND d.project_id=? AND d.user_id=?').bind(draftId,project,user).first<Row>();
  if(!row)throw new CMSProjectError(404,'CMS edit request not found');const body=JSON.parse(row.body);
  return editCMSDraft(db,user,project,row.id,row.draft_request_id,body.data.title,row.content_format==='structured'?body.data.content:body.data.content[0].children[0].text,body._rev,env,row.content_format);
 }
 throw new CMSProjectError(400,'Unsupported CMS edit operation');
}

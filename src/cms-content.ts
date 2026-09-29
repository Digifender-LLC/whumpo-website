import {prepareCMSUnpublish,describeCMSUnpublish} from './cms-unpublish';
import {prepareCMSPublication,describeCMSPublication,readCMSPublication,listCMSPublications} from './cms-publication';
import {prepareCMSPreview} from './cms-preview';
import {cmsEditAction} from './cms-edits';
import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {cmsDraftBody,cmsItemId} from './cms-content-shape';
import {CMSProjectError} from './cms-projects';
type Environment=Record<string,unknown>;
type Draft={id:string;project_id:string;user_id:string;collection:string;body:string;item_id:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function listCMSDrafts(db:D1Database,user:string,project:string,env:Environment){
 await cmsConnection(db,user,project,env);
 const {results}=await db.prepare('SELECT id,collection,item_id,created_at FROM cms_draft_requests WHERE project_id=? AND user_id=? ORDER BY created_at DESC,id LIMIT 90').bind(project,user).all();return results;
}
export async function createCMSDraft(db:D1Database,user:string,project:string,id:string,collection:string,title:unknown,text:unknown,env:Environment){
 const {service,config}=await cmsConnection(db,user,project,env);
 if(!uuid.test(id)||!['posts','pages'].includes(collection))throw new CMSProjectError(400,'Choose posts or pages and a valid request ID');
 let body:string;try{body=JSON.stringify(cmsDraftBody(title,text));}catch(e){throw new CMSProjectError(400,(e as Error).message);}
 const read=()=>db.prepare('SELECT * FROM cms_draft_requests WHERE id=?').bind(id).first<Draft>();
 let row=await read();
 if(!row){try{await db.prepare('INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body) VALUES(?,?,?,?,?)').bind(id,project,user,collection,body).run();}catch{}row=await read();}
 if(!row)throw new CMSProjectError(409,'CMS draft request capacity is full or unavailable');
 if(row.user_id!==user||row.project_id!==project||row.collection!==collection||row.body!==body)throw new CMSProjectError(409,'CMS draft request ID already used');
 if(!row.item_id){
  // Exact retries use the same CMS gateway reservation; an unknown write is never dispatched twice.
  try{const result=await callCMS(service,config,'/_emdash/api/content/'+collection,id,JSON.parse(body));
   if(!cmsItemId.test(result?.item?.id??'')||result.item.status!=='draft')throw Error('Invalid draft receipt');
   await db.prepare('UPDATE cms_draft_requests SET item_id=? WHERE id=? AND item_id IS NULL').bind(result.item.id,id).run();
  }catch{/* Preserve the exact intent for receipt recovery. */}
  row=await read();
 }
 if(!row?.item_id)throw new CMSProjectError(503,'CMS draft outcome is unresolved. Retry this exact request ID; do not prepare a replacement. Request: '+id);
 return {requestId:id,projectId:project,collection,itemId:row.item_id,status:'draft'};
}
export async function readCMSDraft(db:D1Database,user:string,project:string,id:string,env:Environment){
 const {service,config}=await cmsConnection(db,user,project,env);
 const row=await db.prepare('SELECT * FROM cms_draft_requests WHERE id=? AND project_id=? AND user_id=?').bind(id,project,user).first<Draft>();
 if(!row?.item_id)throw new CMSProjectError(404,'A saved CMS draft was not found for this request');
 try{const data=await callCMS(service,config,'/_emdash/api/content/'+row.collection+'/'+row.item_id,crypto.randomUUID());if(data?.item?.id!==row.item_id)throw Error('CMS item mismatch');return {requestId:id,projectId:project,collection:row.collection,revision:data._rev,item:data.item};}catch{throw new CMSProjectError(503,'CMS draft could not be read');}
}
export async function cmsContentAction(db:D1Database,user:string,action:Record<string,unknown>,id:string,env:Environment){
 if(['editDraft','listEdits','retryEdit'].includes(String(action.operation)))return cmsEditAction(db,user,action,id,env);
 const project=action.projectId;if(typeof project!=='string'||!uuid.test(project))throw new CMSProjectError(400,'Choose an owned CMS project ID');
 const allowed=action.operation==='draft'?['kind','operation','projectId','collection','title','text']:['listDrafts','listPublications'].includes(String(action.operation))?['kind','operation','projectId']:['kind','operation','projectId','requestId'];
 if(Object.keys(action).some(k=>!allowed.includes(k)))throw new CMSProjectError(400,'Unsupported CMS draft fields');
 if(action.operation==='draft')return createCMSDraft(db,user,project,id,String(action.collection),action.title,action.text,env);
 if(action.operation==='listPublications')return listCMSPublications(db,user,project);
 if(action.operation==='listDrafts')return listCMSDrafts(db,user,project,env);
 if(typeof action.requestId!=='string'||!uuid.test(action.requestId))throw new CMSProjectError(400,'Choose a CMS draft request ID');
 if(action.operation==='reviewUnpublish'){const publication=await readCMSPublication(db,user,action.requestId);if(publication.project_id!==project)throw new CMSProjectError(404,'Publication not found for this project');return describeCMSUnpublish(db,user,await prepareCMSUnpublish(db,user,action.requestId,id,env));}
 if(action.operation==='reviewPublication')return describeCMSPublication(await prepareCMSPublication(db,user,project,action.requestId,id,env));
 if(action.operation==='previewDraft')return prepareCMSPreview(db,user,project,action.requestId,id,env);
 if(action.operation==='readDraft')return readCMSDraft(db,user,project,action.requestId,env);
 if(action.operation==='retryDraft'){
  await cmsConnection(db,user,project,env);
  const row=await db.prepare('SELECT * FROM cms_draft_requests WHERE id=? AND project_id=? AND user_id=?').bind(action.requestId,project,user).first<Draft>();
  if(!row)throw new CMSProjectError(404,'CMS draft request not found');
  const body=JSON.parse(row.body);return createCMSDraft(db,user,project,row.id,row.collection,body.data.title,body.data.content[0].children[0].text,env);
 }
 throw new CMSProjectError(400,'Unsupported CMS content operation');
}
export type CMSContent=(action:Record<string,unknown>,requestId:string)=>Promise<unknown>;
export function cmsContentCommand(content:string,requestId:string,execute?:CMSContent){
 const match=content.match(/^\/(cms-draft|cms-drafts|cms-read|cms-retry|cms-edit|cms-edits|cms-retry-edit|cms-preview)(?:\s+([\s\S]+))?$/i);if(!match)return;
 return async()=>{
  try{
   if(!execute)throw new CMSProjectError(503,'CMS content connection is not configured');
   const rest=match[2]?.trim()??'',verb=match[1].toLowerCase();let action:Record<string,unknown>;
   if(verb==='cms-edit'){
    const parts=rest.split('|').map(s=>s.trim()),head=parts.shift()?.split(/\s+/);if(parts.length!==2||head?.length!==3)throw new CMSProjectError(400,'Use /cms-edit PROJECT_ID DRAFT_REQUEST_ID REVISION | title | full body text');
    action={operation:'editDraft',projectId:head[0],requestId:head[1],revision:head[2],title:parts[0],text:parts[1]};
   }else if(verb==='cms-draft'){
    const parts=rest.split('|').map(s=>s.trim()),head=parts.shift()?.split(/\s+/);if(parts.length!==2||head?.length!==2)throw new CMSProjectError(400,'Use /cms-draft PROJECT_ID posts|pages | title | body text');
    action={operation:'draft',projectId:head[0],collection:head[1],title:parts[0],text:parts[1]};
   }else{const parts=rest.split(/\s+/);if(parts.length!==(verb==='cms-drafts'?1:2))throw new CMSProjectError(400,'Use /'+verb+' PROJECT_ID'+(verb==='cms-drafts'?'':' REQUEST_ID'));action={operation:verb==='cms-drafts'?'listDrafts':verb==='cms-preview'?'previewDraft':verb==='cms-read'?'readDraft':verb==='cms-edits'?'listEdits':verb==='cms-retry-edit'?'retryEdit':'retryDraft',projectId:parts[0],...(parts[1]?{requestId:parts[1]}:{})};}
   return describeCMSContent(await execute(action,requestId));
  }catch(error){return error instanceof CMSProjectError?error.message:'CMS draft operation could not be confirmed. Inspect the saved request before creating another.';}
 };
}
export function describeCMSContent(result:unknown){return typeof result==='string'?result:'Private EmDash content result (saved operation receipts describe the operation at that time; use /cms-read for current content):\n'+JSON.stringify(result,null,2);}

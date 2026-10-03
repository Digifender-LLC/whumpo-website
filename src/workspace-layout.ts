import {assertFeature,featurePredicate} from './feature-admission';
import {assertWorkspace} from './workspace-identity/admission';
import {canonicalJSON} from './project-specification/v2/json';
import {hashToken} from './security';
import {defaultLayout,parseLayout,parseLayoutChange,WorkspaceViewError,uuid} from './workspace-view-contract';
export {defaultLayout,parseLayout} from './workspace-view-contract';
export type {WorkspaceLayout,WidgetKind} from './workspace-view-contract';
const changed=()=>new WorkspaceViewError(409,'workspace_layout_changed','Your workspace changed. Read the current layout before asking for this change again.');
const guard=(db:D1Database,sql:string,params:unknown[])=>db.prepare(`INSERT INTO workspace_layout_checks(denied) SELECT 1 WHERE NOT (${sql})`).bind(...params);
export async function readLayout(db:D1Database,user:string){
 await assertWorkspace(db,user);
 const row=await db.prepare('SELECT revision,layout_json FROM workspace_preferences WHERE user_id=?').bind(user).first<{revision:number;layout_json:string}>();
 return {revision:row?.revision??0,layout:parseLayout(row?JSON.parse(row.layout_json):defaultLayout)};
}
type ReceiptRow={request_id:string;request_hash:string;request_json:string;from_revision:number;to_revision:number;previous_json:string;layout_json:string;origin_turn_id:string|null;created_at:string};
const receiptData=(r:ReceiptRow)=>({version:1 as const,requestId:r.request_id,operation:parseLayoutChange(JSON.parse(r.request_json)).operation,previousRevision:r.from_revision,revision:r.to_revision,layout:parseLayout(JSON.parse(r.layout_json)),createdAt:r.created_at});
async function receiptRow(db:D1Database,user:string,id:string){return db.prepare('SELECT * FROM workspace_layout_receipts WHERE user_id=? AND request_id=?').bind(user,id).first<ReceiptRow>();}
export async function readLayoutReceipt(db:D1Database,user:string,id:unknown){await assertWorkspace(db,user);if(!uuid(id))throw new WorkspaceViewError(400,'invalid_request','Use the exact saved request ID.');const r=await receiptRow(db,user,id);if(!r)throw new WorkspaceViewError(404,'receipt_missing','No saved layout change was found for this request.');return receiptData(r);}
export async function readLayoutHistory(db:D1Database,user:string){
 await assertWorkspace(db,user);const {results}=await db.prepare('SELECT request_id,request_json,from_revision,to_revision,created_at FROM workspace_layout_receipts WHERE user_id=? ORDER BY to_revision DESC LIMIT 20').bind(user).all<Pick<ReceiptRow,'request_id'|'request_json'|'from_revision'|'to_revision'|'created_at'>>();
 return {version:1,items:results.map(r=>({requestId:r.request_id,operation:parseLayoutChange(JSON.parse(r.request_json)).operation,previousRevision:r.from_revision,revision:r.to_revision,createdAt:r.created_at}))};
}
/** Prepare only. The caller commits these statements WITH the Chat result. */
export async function prepareLayoutChange(db:D1Database,user:string,input:unknown,originTurnId:string|null=null){
 await assertWorkspace(db,user);const request=parseLayoutChange(input),requestHash=await hashToken(canonicalJSON(request));
 if(originTurnId!==null&&(!uuid(originTurnId)||originTurnId!==request.requestId))throw changed();
 const previous=await receiptRow(db,user,request.requestId);
 if(previous){if(previous.request_hash!==requestHash||previous.origin_turn_id!==originTurnId)throw new WorkspaceViewError(409,'request_conflict','This request already describes another workspace change.');return {receipt:receiptData(previous),statements:[] as D1PreparedStatement[],replayed:true};}
 const gate={userId:user,projectId:null,featureId:'core.editing' as const,operation:'prepare' as const};await assertFeature(db,gate);
 const feature=featurePredicate(db,gate);
 const current=await readLayout(db,user);if(request.expectedRevision!==current.revision)throw changed();
 let next=structuredClone(current.layout);
 if(request.operation==='undo'){
  const target=await db.prepare('SELECT * FROM workspace_layout_receipts WHERE user_id=? AND to_revision=?').bind(user,request.receiptRevision).first<ReceiptRow>();if(!target||target.to_revision!==current.revision||canonicalJSON(parseLayout(JSON.parse(target.layout_json)))!==canonicalJSON(current.layout))throw changed();
  next=parseLayout(JSON.parse(target.previous_json));
 }else if(request.operation==='setDashboard')next.dashboard=request.view;
 else if(request.operation==='createPage'){
  if(next.tabs.some(t=>t.id===request.page.id)||next.tabs.length>=8)throw changed();next.tabs.push(request.page);
 }else{
  const index=next.tabs.findIndex(t=>t.id===request.pageId);if(index<0)throw new WorkspaceViewError(404,'page_missing','That workspace page is no longer available.');
  if(request.operation==='removePage')next.tabs.splice(index,1);
  else if(request.operation==='renamePage')next.tabs[index].label=request.label;
  else {if(request.view.projectId!==next.tabs[index].view.projectId)throw new WorkspaceViewError(400,'page_scope','Create a separate page for a different project.');next.tabs[index].view=request.view;}
 }
 next=parseLayout(next);const beforeJSON=canonicalJSON(current.layout),afterJSON=canonicalJSON(next),now=new Date().toISOString();
 if(beforeJSON===afterJSON)throw new WorkspaceViewError(409,'no_change','That view already has these settings.');
 // Only introduced/changed project views need fresh eligibility. Removing a
 // stale page remains possible; unrelated stale pages are preserved as unavailable.
 const checked=next.tabs.filter(t=>request.operation==='undo'||canonicalJSON(t)!==canonicalJSON(current.layout.tabs.find(p=>p.id===t.id)??null));
 const projects=[...new Set(checked.map(t=>t.view.projectId).filter((id):id is string=>id!==null))];
 for(const id of projects)if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(id,user).first())throw new WorkspaceViewError(404,'project_missing','The page project is no longer available.');
 const statements=[
  guard(db,feature.sql,feature.params),
  db.prepare('INSERT OR IGNORE INTO workspace_preferences(user_id,revision,layout_json,updated_at) VALUES(?,0,?,?)').bind(user,canonicalJSON(defaultLayout),now),
  guard(db,'EXISTS(SELECT 1 FROM workspace_preferences WHERE user_id=? AND revision=? AND layout_json=?)',[user,current.revision,beforeJSON]),
  ...projects.map(id=>guard(db,'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)',[id,user])),
  ...(originTurnId?[guard(db,"EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND mode='ai' AND status='pending' AND input_tokens IS NULL)",[originTurnId,user])]:[]),
  db.prepare('INSERT INTO workspace_layout_receipts(request_id,user_id,request_hash,request_json,from_revision,to_revision,previous_json,layout_json,origin_turn_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(request.requestId,user,requestHash,canonicalJSON(request),current.revision,current.revision+1,beforeJSON,afterJSON,originTurnId,now),
  db.prepare('UPDATE workspace_preferences SET revision=revision+1,layout_json=?,updated_at=? WHERE user_id=? AND revision=?').bind(afterJSON,now,user,current.revision),
 ];
 return {receipt:{version:1 as const,requestId:request.requestId,operation:request.operation,previousRevision:current.revision,revision:current.revision+1,layout:next,createdAt:now},statements,replayed:false};
}
export async function mutateLayout(db:D1Database,user:string,input:unknown){
 const prepared=await prepareLayoutChange(db,user,input);if(prepared.replayed)return prepared.receipt;
 try{await db.batch(prepared.statements);}catch(error){
  // An accepted lost acknowledgment is read back, never redispatched.
  const r=await receiptRow(db,user,prepared.receipt.requestId);if(r){const request=parseLayoutChange(input);if(r.request_hash===await hashToken(canonicalJSON(request))&&r.origin_turn_id===null)return receiptData(r);}
  if(String(error).includes('workspace_layout_changed'))throw changed();throw error;
 }
 return readLayoutReceipt(db,user,prepared.receipt.requestId);
}
export async function workspaceAction(db:D1Database,user:string,turnId:string,action:Record<string,unknown>){
 if(action.kind!=='workspace')throw new WorkspaceViewError(400,'invalid_action','Choose a current workspace action.');
 if(action.operation==='read'&&Object.keys(action).sort().join(',')==='kind,operation'){
  const history=await readLayoutHistory(db,user);
  return {reply:'Current workspace layout and recent changes.',inspection:JSON.stringify({type:'workspace_layout',data:{...await readLayout(db,user),history:{...history,items:history.items.slice(0,5)}}}),statements:[] as D1PreparedStatement[]};
 }
 const {kind,...data}=action;if(Object.hasOwn(data,'requestId'))throw new WorkspaceViewError(400,'invalid_action','The workspace request ID is supplied by Chat.');
 const prepared=await prepareLayoutChange(db,user,{...data,requestId:turnId},turnId);
 return {reply:'Your workspace change is saved (revision '+prepared.receipt.revision+'). Your account controls remain available.',statements:prepared.statements};
}

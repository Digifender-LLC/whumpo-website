import {chatControl,type ChatControl} from '../chat-controls';
import {readSavedChatTurn} from '../chat';
import {readWorkspaceReviews,filterWorkspaceReviewAccess} from '../workspace-reviews';
import {specificationReviewDetails} from '../project-specification/store';
import {compareReview} from '../version-diff';
import {readApplicationReview} from '../app-activation';
import type {ApplicationReviewPresentation} from '../application-review-shape';
import type {AppRestorePresentation} from '../app-restore-review-shape';
import {MobileError,type MobileClient} from './protocol';

type NativeControl=Extract<ChatControl,{type:'specificationApply'|'appRestore'|'confirm'}>;
type ReviewKind='specification'|'site'|'application'|'app-restore';
type Artifact={kind:'application-source';source:string;digest:string};
export type NativeReview={kind:ReviewKind;reviewId:string;project:{id:string;name:string}|null;state:'pending'|'applied'|'expired'|'superseded'|'unavailable';expiresAt:string;canApprove:boolean;control:NativeControl|null;requiresFreshPasskey:boolean;disclosure:{title:string;lines:string[]};preview:{path:string}|null;artifact:Artifact|null;unavailableReason:'client_update_required'|'expired'|'stale'|'not_current'|null};
export function nativeControl(value:unknown){
 const parsed=chatControl(value);if(!parsed)throw new MobileError('unsupported_control');
 const c=parsed.action;
 if(!(c.type==='specificationApply'||c.type==='appRestore'||c.type==='confirm'&&(c.kind==='site'||c.kind==='application')))throw new MobileError('unsupported_control');
 if(Object.keys(value as object).length!==Object.keys(c).length)throw new MobileError('unsupported_control');
 return {...parsed,action:c,capability:c.type==='specificationApply'?'specification.apply':c.type==='appRestore'?'app.restore':c.kind==='site'?'site.confirm':'application.confirm'};
}
function present(client:MobileClient,data:Omit<NativeReview,'canApprove'|'unavailableReason'>):NativeReview{
 const supported=!!data.control&&client.controls.includes(nativeControl(data.control).capability),pending=data.state==='pending';
 return {...data,control:pending&&supported?data.control:null,canApprove:pending&&supported,unavailableReason:!pending?data.state==='expired'?'expired':'not_current':supported?null:'client_update_required'};
}
export async function specificationReview(db:D1Database,user:string,id:string,client:MobileClient){
 const d=await specificationReviewDetails(db,user,id);
 return present(client,{kind:'specification',reviewId:id,project:d.project,state:'pending',expiresAt:d.expiresAt,control:{type:'specificationApply',reviewId:d.review.id,proposalDigest:d.review.proposalDigest,expectedRevision:d.review.expectedRevision},requiresFreshPasskey:true,
  disclosure:{title:'Save this private website version',lines:['Review the full private comparison and preview before saving.','Approval saves the exact reviewed specification and creates a private website version.','Publishing requires its own review. Visitor data, permissions, connections and the live website are unchanged.']},preview:{path:`/api/specification-reviews/${id}/diff`},artifact:null});
}
/** Only shared, receipt-validated Chat projections may supply app/site controls. */
export async function reviewForTurn(db:D1Database,user:string,t:Record<string,unknown>,client:MobileClient):Promise<NativeReview|null>{
 try{
  const spec=t.specification_review as {id?:string}|undefined;
  if(spec?.id)return await specificationReview(db,user,spec.id,client);
  if(typeof t.confirmation_id==='string'){
   const d=await compareReview(db,user,t.confirmation_id);
   if(d.kind==='unpublish'||!d.expiresAt)return null;
   return present(client,{kind:'site',reviewId:t.confirmation_id,project:d.project,state:'pending',expiresAt:d.expiresAt,control:{type:'confirm',kind:'site',reviewId:t.confirmation_id},requiresFreshPasskey:false,
    disclosure:{title:d.kind==='restore'?'Publish the reviewed saved website':'Publish this website version',lines:['Review the full private comparison and preview before publishing.','Approval changes the public website to the exact saved version in this review.','A newer publication or expired review requires a new review.']},preview:{path:`/api/publication-reviews/${t.confirmation_id}/diff`},artifact:null});
  }
  const app=t.application_review as ApplicationReviewPresentation|undefined;
  if(app&&app.operation==='enable'){
   const r=await readApplicationReview(db,user,app.id);
   if(r.source!==app.source||r.digest!==app.digest||new TextEncoder().encode(r.source).length>8192)return null;
   const state=app.state==='ready'?'pending':app.state==='changed'?'superseded':app.state;
   return present(client,{kind:'application',reviewId:app.id,project:{id:r.project_id,name:app.projectName},state,expiresAt:app.expiresAt,control:{type:'confirm',kind:'application',reviewId:app.id},requiresFreshPasskey:false,
    disclosure:{title:'Authorize this visitor application',lines:[
     'Read the complete saved source and SHA-256 before authorizing this program.',
     'The program receives one authenticated visitor’s private document and input and returns its replacement document and result. Documents are limited to 4 KiB.',
     'No other visitor data, owner workspace data, credentials or network are supplied. State, results and operation history remain in private storage; visitors can export and delete their own account.',
     'Limits: 100 visitors per project, 20 attempts per visitor per day and 100 attempts per project per day. The project’s visitor access module must remain active for sign-in.',
     'Changing code after visitors exist requires a separate migration workflow. A passing example does not prove compatibility for all inputs.',
     'This authorizes the program only. A separate application-page review publishes a visitor page. Reauthorizing hides any existing visitor page until reviewed again.',
     `Program: ${r.version_id}. Test: ${r.run_id}. Base revision: ${r.base_revision}.`
    ]},preview:null,artifact:{kind:'application-source',source:r.source,digest:r.digest}});
  }
  const restore=t.app_restore_review as AppRestorePresentation|undefined;
  if(restore){const state=restore.state==='ready'?'pending':restore.state==='changed'?'superseded':restore.state;return present(client,{kind:'app-restore',reviewId:restore.id,project:{id:restore.projectId,name:restore.projectName},state,expiresAt:restore.expiresAt,control:{type:'appRestore',projectId:restore.projectId,reviewId:restore.id,confirmation:'RESTORE'},requiresFreshPasskey:true,
   disclosure:{title:'Restore this application’s private documents',lines:[`Restore point: ${restore.pointId}, saved ${restore.pointCreatedAt}.`,`Replace the ${restore.documents} reviewed visitor documents with their saved contents. Later private document changes are lost.`,`Program: ${restore.versionId}. The application must remain offline and its program and visitor roster must still match.`,`This restores data only. It does not enable the application or publish a visitor page.`]},preview:null,artifact:null});}
 }catch{/* Missing, changed or withheld domain data cannot offer approval. */}
 return null;
}
export async function reviewForControl(db:D1Database,user:string,control:NativeControl,client:MobileClient){
 if(control.type==='specificationApply'){try{return await specificationReview(db,user,control.reviewId,client);}catch{return null;}}
 const site=control.type==='confirm'&&control.kind==='site';
 const row=site?await db.prepare('SELECT t.id FROM publication_chat_links l JOIN chat_turns t ON t.id=l.turn_id WHERE l.review_id=? AND t.user_id=? ORDER BY t.revision DESC LIMIT 1').bind(control.reviewId,user).first<{id:string}>():await db.prepare('SELECT t.id FROM chat_review_receipts l JOIN chat_turns t ON t.id=l.turn_id AND t.user_id=l.user_id WHERE l.review_id=? AND l.user_id=? AND l.kind=? ORDER BY t.revision DESC LIMIT 1').bind(control.reviewId,user,control.type==='appRestore'?'appRestore':'application').first<{id:string}>();
 if(!row)return null;const turn=await readSavedChatTurn(db,user,row.id);return turn?reviewForTurn(db,user,turn,client):null;
}
export async function nativeReviews(db:D1Database,user:string,client:MobileClient){
 const queue=await filterWorkspaceReviewAccess(db,user,await readWorkspaceReviews(db,user,null)),items:NativeReview[]=[];let unavailable=queue.unavailable;
 for(const item of queue.items){try{items.push(await specificationReview(db,user,item.review.id,client));}catch{unavailable++;}}
 if(items.length<5){
  const rows=await db.prepare(`SELECT t.id FROM chat_turns t WHERE t.user_id=? AND t.status='completed' AND (
   EXISTS(SELECT 1 FROM publication_chat_links l JOIN publication_actions a ON a.id=l.review_id WHERE l.turn_id=t.id AND a.user_id=t.user_id AND a.status='pending' AND a.kind!='unpublish' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   OR EXISTS(SELECT 1 FROM chat_review_receipts l JOIN app_activation_reviews a ON a.id=l.review_id WHERE l.turn_id=t.id AND l.user_id=t.user_id AND l.kind='application' AND a.user_id=t.user_id AND a.enabled=1 AND a.status='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   OR EXISTS(SELECT 1 FROM chat_review_receipts l JOIN app_restore_reviews a ON a.id=l.review_id WHERE l.turn_id=t.id AND l.user_id=t.user_id AND l.kind='appRestore' AND a.user_id=t.user_id AND a.status='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
   ORDER BY t.revision DESC LIMIT 10`).bind(user).all<{id:string}>();
  for(const row of rows.results){const turn=await readSavedChatTurn(db,user,row.id),review=turn?await reviewForTurn(db,user,turn,client):null;if(review?.state==='pending'&&!items.some(r=>r.reviewId===review.reviewId))items.push(review);else if(!review)unavailable++;if(items.length===5)break;}
 }
 return {items,denied:queue.denied,unavailable};
}

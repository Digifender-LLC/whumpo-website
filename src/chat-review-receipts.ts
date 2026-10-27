import {hashToken} from './security';
import {BackendError} from './backend-error';
import {describeBackendPublication,readBackendPublicationReview,readBackendPublication} from './backend-publication';
import {describeBackendForm,readBackendFormReview} from './backend-forms';
type Turn=Record<string,unknown>;
type Kind='githubGrant'|'application'|'appPage'|'appRestore'|'backendPublication'|'backendForm';
type Receipt={kind:Kind;review_id:string};
const prefixes:Record<string,Kind>={'GitHub access review':'githubGrant','Application review':'application','Application page review':'appPage','Application data restore review':'appRestore','Backend publish review':'backendPublication','Backend unpublish review':'backendPublication','Website tool review':'backendForm'};
/** Call only with a validated handler's reply, never a model's answer. */
export async function linkChatReviewReply(db:D1Database,user:string,turn:string,reply:string){
 const match=/^(.+ review) ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\n/.exec(reply);
 if(!match||!Object.hasOwn(prefixes,match[1]))return;
 await db.prepare('INSERT OR IGNORE INTO chat_review_receipts(turn_id,user_id,kind,review_id,reply_digest) SELECT id,user_id,?,?,? FROM chat_turns WHERE id=? AND user_id=?').bind(prefixes[match[1]],match[2],await hashToken(reply),turn,user).run();
}
/** Stored receipt, owned turn, and exact reply bytes must all agree. */
export async function readChatReviewReceipts(db:D1Database,user:string,turns:Turn[]){
 const valid=new Map<string,Receipt>(),candidates=turns.slice(0,100).filter(t=>t.status==='completed');
 for(let offset=0;offset<candidates.length;offset+=50){
  const group=candidates.slice(offset,offset+50);
  const {results}=await db.prepare(`SELECT r.turn_id,r.kind,r.review_id,r.reply_digest FROM chat_review_receipts r JOIN chat_turns t ON t.id=r.turn_id AND t.user_id=r.user_id WHERE r.user_id=? AND r.turn_id IN (${group.map(()=>'?').join(',')})`).bind(user,...group.map(t=>String(t.id))).all<Receipt&{turn_id:string;reply_digest:string}>();
  for(const r of results){const t=group.find(t=>t.id===r.turn_id);if(t&&typeof t.assistant_text==='string'&&await hashToken(t.assistant_text)===r.reply_digest)valid.set(r.turn_id,r);}
 }
 return valid;
}
/** The exact reply a customer reviewed, as stored (turn id and text). */
export type ReviewedReply={turn:string;text:string};
/** The receipt kind and review a UI confirm control targets, or undefined for kinds with no receipt row. */
export function controlReceipt(a:{type:string;kind?:string;operation?:string;reviewId?:string}):{kind:Kind;reviewId:string}|undefined{
 const kind=a.type==='confirm'&&['application','appPage','backendPublication','backendForm'].includes(String(a.kind))?a.kind as Kind:a.type==='githubGrant'&&a.operation==='confirm'?'githubGrant':a.type==='appRestore'?'appRestore':undefined;
 return kind&&a.reviewId?{kind,reviewId:a.reviewId}:undefined;
}
/** Same rule as readChatReviewReceipts: a non-confirm turn whose stored text still hashes to its receipt digest. */
export async function reviewedReply(db:D1Database,user:string,kind:Kind,review:string):Promise<ReviewedReply|undefined>{
 const {results}=await db.prepare("SELECT r.turn_id,r.reply_digest,t.assistant_text FROM chat_review_receipts r JOIN chat_turns t ON t.id=r.turn_id AND t.user_id=r.user_id WHERE r.user_id=? AND r.kind=? AND r.review_id=? AND t.status='completed' AND COALESCE(json_extract(t.action_json,'$.type'),'')!='confirm' ORDER BY t.revision DESC LIMIT 20").bind(user,kind,review).all<{turn_id:string;reply_digest:string;assistant_text:string}>();
 for(const r of results)if(typeof r.assistant_text==='string'&&await hashToken(r.assistant_text)===r.reply_digest)return {turn:r.turn_id,text:r.assistant_text};
}
export const reviewChangedMessage='The reply you reviewed no longer matches this review. Request a fresh review before confirming.';
/** Fail closed: a confirm needs the reviewed reply, which its effect statement then re-checks atomically. */
export async function requireReviewedReply(db:D1Database,user:string,kind:Kind,review:string){
 const reviewed=await reviewedReply(db,user,kind,review);if(!reviewed)throw new BackendError(409,reviewChangedMessage);return reviewed;
}
/** Appended to a confirm's guarded UPDATE so the reviewed text cannot change between check and effect. */
export function reviewedReplyGuard(user:string,reviewed?:ReviewedReply){
 return reviewed?{sql:' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND assistant_text=?)',params:[reviewed.turn,user,reviewed.text]}:{sql:'',params:[] as string[]};
}
/** Backend publication/form approvals previously had only a command interface. */
export async function backendReviewChatActions(db:D1Database,user:string,turns:Turn[],receipts:Map<string,Receipt>){
 for(const turn of turns){delete turn.backend_publication_confirmation_id;delete turn.backend_form_confirmation_id;}
 for(const turn of turns.filter(t=>['backendPublication','backendForm'].includes(receipts.get(String(t.id))?.kind??'')).slice(0,20)){
  const receipt=receipts.get(String(turn.id));
  if(!receipt||!['backendPublication','backendForm'].includes(receipt.kind))continue;
  try{
   if(receipt.kind==='backendPublication'){
    const r=await readBackendPublicationReview(db,user,receipt.review_id),current=await readBackendPublication(db,user,r.project_id);
    if(r.status==='pending'&&r.expires_at>new Date().toISOString()&&r.base_revision===current.revision&&turn.assistant_text===describeBackendPublication(r))turn.backend_publication_confirmation_id=r.id;
   }else{
    const r=await readBackendFormReview(db,user,receipt.review_id);
    const current=await db.prepare('SELECT f.revision,s.revision site_revision,b.review_id backend_publication_id,s.version_id site_version,b.version_id backend_version FROM backend_form_settings f LEFT JOIN publications s ON s.project_id=f.project_id LEFT JOIN backend_publications b ON b.project_id=f.project_id WHERE f.project_id=?').bind(r.project_id).first<{revision:number;site_revision:number;backend_publication_id:string;site_version:string|null;backend_version:string|null}>();
    if(r.status==='pending'&&r.expires_at>new Date().toISOString()&&r.base_revision===current?.revision&&(!r.enabled||current.site_version&&current.backend_version&&r.site_revision===current.site_revision&&r.backend_publication_id===current.backend_publication_id)&&turn.assistant_text===describeBackendForm(r))turn.backend_form_confirmation_id=r.id;
   }
  }catch{/* Changed, missing or invalid owned reviews expose no approval. */}
 }
}

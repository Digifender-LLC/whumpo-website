// WH-084 M2 thin slice: bootstrap, Chat list/turn/send and review list/confirm. Every operation runs the web path unchanged:
// admitWorkspace + workspaceBindings + the existing handler + a trailing assertWorkspace, with the bearer principal. Only the wire shape is new.
import {chatState,readChat,readSavedChatTurn,sendChatControl,sendConversation} from '../chat';
import {chatHistory} from '../chat-history';
import {BillingError} from '../billing';
import {chatControl} from '../chat-controls';
import {configuredAI} from '../ai-chat';
import {onboardingComplete} from '../onboarding';
import {readWorkspaceReviews,filterWorkspaceReviewAccess} from '../workspace-reviews';
import {reviewChangedMessage} from '../chat-review-receipts';
import {IdentityError,type IdentityPrincipal} from '../workspace-identity/authority';
import {admitWorkspace,assertWorkspace,requireFreshWorkspace,workspaceBindings} from '../workspace-identity/admission';
import {mapIdentityError} from './auth';
import {MobileError,declaredControls,fresh,ok,readJson,signin,type MobileEnvironment} from './transport';

export type MobileDeps={chatOptions:(scoped:Env,userId:string)=>unknown};
type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const iso=(s:string)=>new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s)?s:s.replace(' ','T')+'Z').toISOString();

/** The web dispatcher's gate, verbatim: scoped DB and bindings for this principal, the current-identity assert after the handler. */
async function workspace(env:MobileEnvironment,principal:IdentityPrincipal,onboarding:boolean,run:(scoped:Env,user:string)=>Promise<Response>){
 try{
  const scoped=workspaceBindings(env,admitWorkspace(env.DB,principal),principal.accountId);
  if(!await scoped.DB.prepare('SELECT id FROM users WHERE id=?').bind(principal.accountId).first())throw signin();
  if(onboarding&&!await onboardingComplete(scoped.DB,principal.accountId))throw new MobileError('onboarding_required',{next:'browser'});
  const response=await run(scoped,principal.accountId);
  await assertWorkspace(scoped.DB,principal.accountId);
  return response;
 }catch(error){
  // reconcileChat refuses a new send while an earlier reply has no settled receipt (409): to the app that is a reply still being prepared.
  if(error instanceof BillingError&&error.status===409)throw new MobileError('chat_busy');
  throw mapIdentityError(error,signin());
 }
}

// ---- Reviews: a projection of the four admitted kinds. Authority stays with the web validators; `live` comes from them. ----
type Kind='specification'|'site'|'application'|'appRestore';
const capability:Record<Kind,string>={specification:'specification.apply',site:'site.confirm',application:'application.confirm',appRestore:'app.restore'};
/** One literal, owner-scoped statement per kind (the tenant SQL audit reads literals only). */
const head=(db:D1Database,kind:Kind,id:string,user:string)=>kind==='site'?db.prepare("SELECT a.project_id,p.name,a.expires_at,a.status='applied' applied,a.version_id extra FROM publication_actions a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.id=? AND a.user_id=? AND a.kind IN ('publish','restore')").bind(id,user)
 :kind==='specification'?db.prepare("SELECT q.project_id,p.name,q.expires_at,EXISTS(SELECT 1 FROM project_spec_applies x WHERE x.proposal_id=q.id AND x.user_id=q.user_id) applied,q.proposal_digest extra,q.expected_revision,q.diff_json FROM project_spec_proposals q JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id WHERE q.id=? AND q.user_id=?").bind(id,user)
 :kind==='application'?db.prepare("SELECT r.project_id,p.name,r.expires_at,r.status='applied' applied,r.enabled extra FROM app_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?").bind(id,user)
 :db.prepare("SELECT r.project_id,p.name,r.expires_at,r.status='applied' applied,NULL extra FROM app_restore_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?").bind(id,user);
const freshKinds:Kind[]=['specification','appRestore'];
/** A review the owner has, whether pending (`live`, vouched for by the web validator) or already settled; null when it is not theirs or not an admitted kind. */
async function review(db:D1Database,user:string,kind:Kind,id:string,declared:string[],live:boolean){
 const h=await head(db,kind,id,user).first<Row>();
 if(!h)return null;
 const expired=iso(h.expires_at)<=new Date().toISOString();
 const state=live?'pending':h.applied?'applied':expired?'expired':'unavailable';
 const allowed=declared.includes(capability[kind]),canApprove=live&&allowed;
 const control=!canApprove?null:kind==='specification'?{type:'specificationApply',reviewId:id,proposalDigest:h.extra,expectedRevision:h.expected_revision}
  :kind==='appRestore'?{type:'appRestore',projectId:h.project_id,reviewId:id,confirmation:'RESTORE'}:{type:'confirm',kind,reviewId:id};
 const name=h.name as string;
 const disclosure=kind==='site'?{title:'Publish this website version',lines:['Makes the reviewed version public at the project address.']}
  :kind==='specification'?{title:'Save these private website changes',lines:[...(JSON.parse(h.diff_json) as {label:string}[]).slice(0,6).map(c=>`Updates ${c.label} on ${name}.`),'Saves a private version only; nothing is published.']}
  :kind==='application'?{title:h.extra?'Turn on this application change':'Turn off this application',lines:[h.extra?`Activates the reviewed application change on ${name}.`:`Disables the reviewed application on ${name}.`]}
  :{title:'Restore this application data',lines:[`Restores the reviewed saved application data on ${name}.`]};
 const preview=kind==='site'&&h.extra?{path:`/api/site-versions/${h.extra}/preview`}:kind==='specification'?{path:`/api/specification-reviews/${id}/preview`}:null;
 return {kind,reviewId:id,project:{id:h.project_id,name},state,expiresAt:iso(h.expires_at),canApprove,control,requiresFreshPasskey:freshKinds.includes(kind),disclosure,preview,
  unavailableReason:canApprove?null:live?'client_update_required':state==='expired'?'expired':state==='applied'?'not_current':'stale'};
}
/** Which review a web Chat turn row offers (live) or settled (an admitted control the turn itself carried). */
function turnReview(db:D1Database,user:string,row:Row,declared:string[]){
 if(row.specification_review?.id)return review(db,user,'specification',row.specification_review.id,declared,true);
 if(row.confirmation_id)return review(db,user,'site',row.confirmation_id,declared,true);
 if(row.application_confirmation_id)return review(db,user,'application',row.application_confirmation_id,declared,true);
 if(row.app_restore_review?.state==='ready')return review(db,user,'appRestore',row.app_restore_review.id,declared,true);
 let action:Row|null=null;try{action=row.action_json?JSON.parse(row.action_json):null;}catch{/* an unreadable stored action offers nothing */}
 const kind=!action||!uuid.test(action.reviewId)?null:action.type==='specificationApply'?'specification':action.type==='appRestore'?'appRestore':action.type==='confirm'&&(action.kind==='site'||action.kind==='application')?action.kind as Kind:null;
 return kind?review(db,user,kind,action!.reviewId,declared,false):null;
}
const states=['open','submitted','canceled','superseded','expired'];
async function turn(db:D1Database,user:string,row:Row,declared:string[]){
 let interaction=null;
 if(row.interaction?.id&&states.includes(row.interaction.state))interaction={interactionId:row.interaction.id,state:row.interaction.state};
 else if(row.interaction_id){
  const i=await db.prepare("SELECT id,CASE WHEN state='open' AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired' ELSE state END state FROM chat_interactions WHERE id=? AND user_id=?").bind(row.interaction_id,user).first<Row>();
  if(i&&states.includes(i.state))interaction={interactionId:i.id,state:i.state};
 }
 return {id:row.id,revision:row.revision,status:row.status,mode:row.mode,createdAt:iso(row.created_at),userText:row.user_text,assistantText:row.assistant_text||null,review:await turnReview(db,user,row,declared),interaction};
}

// ---- Operations ----
export const bootstrap=(env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,false,async(scoped,user)=>{
 const complete=await onboardingComplete(scoped.DB,user);
 if(!complete)return ok({onboarding:{complete:false,browserPath:'/workspace/'},chat:null,projectCount:0,pendingReviewCount:0});
 const chat=await readChat(scoped.DB,user,!!configuredAI(scoped)) as Row;
 const pending=await filterWorkspaceReviewAccess(scoped.DB,user,await readWorkspaceReviews(scoped.DB,user,null));
 return ok({onboarding:{complete:true,browserPath:null},chat:{revision:chat.state.revision,mode:chat.mode},projectCount:chat.stats.projects,pendingReviewCount:pending.items.length});
});

const cursorOf=(account:string,before:number)=>btoa(JSON.stringify({a:account,e:'chat',b:before})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function beforeOf(account:string,cursor:string){
 try{const c=JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));if(c.a===account&&c.e==='chat'&&Number.isSafeInteger(c.b)&&c.b>=1)return c.b as number;}catch{/* malformed */}
 throw new MobileError('invalid_cursor');
}
export const chatList=(request:Request,env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,true,async(scoped,user)=>{
 const params=new URL(request.url).searchParams,declared=declaredControls(request);
 for(const k of params.keys())if(!['limit','cursor','q'].includes(k)||params.getAll(k).length!==1)throw new MobileError('unknown_field');
 const limit=Number(params.get('limit')??25),q=(params.get('q')??'').trim(),cursor=params.get('cursor');
 if(!Number.isSafeInteger(limit)||limit<1||limit>50||q.length>100||/[\x00-\x1f\x7f]/.test(q))throw new MobileError('invalid_request');
 const ai=!!configuredAI(scoped);let rows:Row[],more:boolean,revision:number,mode=ai?'ai':'guided';
 if(!cursor&&!q){
  const c=await readChat(scoped.DB,user,ai) as Row;rows=c.turns as Row[];revision=c.state.revision;mode=c.mode;more=rows.length>limit||rows.length>=100;
 }else{
  revision=(await chatState(scoped.DB,user)).revision;
  const before=cursor?beforeOf(user,cursor):revision+1;
  // Older turns come from the read-only history path: old text never recreates approval, so these carry no review.
  const history=await chatHistory(new Request('https://mobile.invalid/history?before='+before+'&q='+encodeURIComponent(q)),scoped.DB,user);
  if(history.status!==200)throw new MobileError('invalid_request');
  const data=await history.json() as {turns:Row[];nextBefore:number|null};rows=data.turns;more=rows.length>limit||data.nextBefore!==null;
 }
 const page=rows.slice(-limit);
 return ok({revision,mode,items:await Promise.all(page.map(r=>turn(scoped.DB,user,r,declared))),nextCursor:more&&page.length?cursorOf(user,page[0].revision):null});
});

export const chatTurn=(request:Request,env:MobileEnvironment,p:IdentityPrincipal,id:string)=>workspace(env,p,true,async(scoped,user)=>{
 const row=await readSavedChatTurn(scoped.DB,user,id);
 if(!row)throw new MobileError('not_found');
 return ok({turn:await turn(scoped.DB,user,row as Row,declaredControls(request))});
});

/** The web send result mapped to the contract: acceptance plus the committed turn, or a contract error. */
async function written(db:D1Database,user:string,requestId:string,result:Row|undefined){
 if(result?.error){
  const m=String(result.error);
  if(m.includes('already used')||m.includes('saved form'))throw new MobileError('request_conflict');
  if(m.includes('still being prepared'))throw new MobileError('chat_busy');
  if(m.includes('conversation changed'))throw new MobileError('stale_revision',{currentRevision:(await chatState(db,user)).revision});
  if(m===reviewChangedMessage)throw new MobileError('review_unavailable');
  throw new MobileError(result.status===429?'rate_limited':result.status===400?'invalid_request':'unavailable');
 }
 const t=await db.prepare('SELECT revision,status FROM chat_turns WHERE id=? AND user_id=?').bind(requestId,user).first<Row>();
 if(!t)throw new MobileError('unavailable');
 return ok({requestId,accepted:true,revision:t.revision,turnStatus:t.status});
}
const requestFields=async(request:Request,keys:string[])=>{
 const d=await readJson(request,keys);
 if(typeof d.requestId!=='string'||!uuid.test(d.requestId)||!Number.isSafeInteger(d.expectedRevision)||(d.expectedRevision as number)<0||(d.expectedRevision as number)>2000)throw new MobileError('invalid_request');
 return {d,id:d.requestId,revision:d.expectedRevision as number};
};
export const sendMessage=async(request:Request,env:MobileEnvironment,p:IdentityPrincipal,deps:MobileDeps)=>{
 const {d,id,revision}=await requestFields(request,['version','requestId','expectedRevision','content']);
 if(typeof d.content!=='string'||!d.content.trim()||d.content.length>1000)throw new MobileError('invalid_request');
 return workspace(env,p,true,async(scoped,user)=>written(scoped.DB,user,id,await sendConversation(scoped.DB,user,{id,revision,content:d.content},configuredAI(scoped),deps.chatOptions(scoped,user) as never) as Row));
};

/** The four admitted controls; anything else the web accepts is `unsupported_control`, never reached. */
function admitted(control:unknown){
 const c=control as Row|null;
 if(!c||typeof c!=='object'||Array.isArray(c))throw new MobileError('invalid_request');
 const cap=c.type==='specificationApply'?'specification.apply':c.type==='appRestore'?'app.restore':c.type==='confirm'&&c.kind==='site'?'site.confirm':c.type==='confirm'&&c.kind==='application'?'application.confirm':null;
 if(!cap)throw new MobileError('unsupported_control');
 const parsed=chatControl(c);
 if(!parsed)throw new MobileError('invalid_request');
 return {cap,parsed};
}
export const confirmReview=async(request:Request,env:MobileEnvironment,p:IdentityPrincipal,deps:MobileDeps)=>{
 const {d,id,revision}=await requestFields(request,['version','requestId','expectedRevision','control']);
 const {cap,parsed}=admitted(d.control);
 if(!declaredControls(request).includes(cap))throw new MobileError('client_update_required');
 return workspace(env,p,true,async(scoped,user)=>{
  if(parsed.recentAuth){
   // A native handoff session is never fresh: the predicate needs a passkey proof under ten minutes old.
   try{await requireFreshWorkspace(scoped.DB,user);}catch(error){throw error instanceof IdentityError?mapIdentityError(error,fresh()):error;}
   if(!(await env.AUTH_LIMITER.limit({key:'app-recovery:'+user})).success)throw new MobileError('rate_limited');
  }
  return written(scoped.DB,user,id,await sendChatControl(scoped.DB,user,{id,revision,action:d.control},configuredAI(scoped),deps.chatOptions(scoped,user) as never) as Row);
 });
};

export const reviewList=(request:Request,env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,true,async(scoped,user)=>{
 const queue=await filterWorkspaceReviewAccess(scoped.DB,user,await readWorkspaceReviews(scoped.DB,user,null)),declared=declaredControls(request);
 const items:unknown[]=[];let unavailable=queue.unavailable;
 for(const item of queue.items){const r=await review(scoped.DB,user,'specification',item.review.id,declared,true);if(r)items.push(r);else unavailable++;}
 return ok({items,denied:queue.denied,unavailable});
});

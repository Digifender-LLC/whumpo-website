// WH-081 offline reference for the frozen /api/mobile/v1 native contract (docs/mobile-api-v1.md).
// It validates request/response/error shapes and the native admission rules against synthetic fixtures. It is not a
// Worker route, bearer resolver, session store or Android code: no Worker imports it, and production adapters (WH-083+)
// must re-derive the principal per request and repeat every authority predicate in the committing statement.
import {createHash} from 'node:crypto';

export class MobileContractError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;this.path=path;}
}
const fail=(code,path)=>{throw new MobileContractError(code,path);};
const check=(ok,code,path)=>{if(!ok)fail(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));

export const contractVersion=1;
export const prefix='/api/mobile/v1';
export const uuidPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

// ---- Tiny closed-schema combinators. Every object rejects unknown and missing keys. -------------------------------
export const T={
 any:()=>()=>{},
 lit:x=>(v,p)=>check(v===x,'invalid_request',p),
 bool:()=>(v,p)=>check(typeof v==='boolean','invalid_request',p),
 int:(min,max)=>(v,p)=>check(Number.isSafeInteger(v)&&v>=min&&v<=max,'invalid_request',p),
 str:(max,re,min=0)=>(v,p)=>check(typeof v==='string'&&v.length>=min&&v.length<=max&&(!re||re.test(v))&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'invalid_request',p),
 uuid:()=>(v,p)=>check(typeof v==='string'&&uuidPattern.test(v),'invalid_request',p),
 iso:()=>(v,p)=>check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&!Number.isNaN(Date.parse(v)),'invalid_request',p),
 en:(...values)=>(v,p)=>check(values.includes(v),'invalid_request',p),
 nul:inner=>(v,p)=>{if(v!==null)inner(v,p);},
 arr:(item,max,min=0)=>(v,p)=>{check(Array.isArray(v)&&v.length>=min&&v.length<=max,'invalid_request',p);v.forEach((x,i)=>item(x,`${p}[${i}]`));},
 obj:(req,opt={})=>(v,p)=>{
  check(plain(v),'invalid_request',p);
  for(const k of Object.keys(v))check(Object.hasOwn(req,k)||Object.hasOwn(opt,k),'unknown_field',`${p}.${k}`);
  for(const k of Object.keys(req))check(Object.hasOwn(v,k),'missing_field',`${p}.${k}`);
  for(const k of Object.keys(req))req[k](v[k],`${p}.${k}`);
  for(const k of Object.keys(opt))if(Object.hasOwn(v,k))opt[k](v[k],`${p}.${k}`);
 },
 json:(maxBytes)=>(v,p)=>{let s;try{s=JSON.stringify(v);}catch{fail('invalid_request',p);}check(typeof s==='string'&&s.length<=maxBytes,'payload_too_large',p);},
};
const {obj,str,int,uuid,iso,en,nul,arr,bool,lit}=T;
const b64url=(min,max)=>str(max,/^[A-Za-z0-9_-]+$/,min);
const opaque=str(256,/^[A-Za-z0-9_-]+$/,1);
const v1=lit(1);

// ---- Error vocabulary (one wire code per condition; HTTP status is fixed per code). --------------------------------
export const errors=Object.freeze({
 invalid_request:400,invalid_cursor:400,unsupported_control:400,unknown_field:400,missing_field:400,
 proof_required:401,identity_incomplete:403,not_found:404,
 onboarding_required:409,identity_changed:409,request_conflict:409,stale_revision:409,chat_busy:409,review_unavailable:409,
 payload_too_large:413,unsupported_media_type:415,client_update_required:426,rate_limited:429,unavailable:503,
});
export const errorBody=obj({version:v1,error:obj({code:en(...Object.keys(errors)),message:str(300,null,1)},{
 minimumBuild:int(1,1e9),contract:int(1,1e6),proof:en('signin','fresh_passkey'),retryAfterSeconds:int(1,3600),currentRevision:int(0,1e9),next:en('browser','update_app')})});

// ---- Client admission. The header selects a contract and capability list; it never grants authority. ---------------
// Capability strings are exact. A client lacking a control capability is never offered that control.
export const controlCapabilities=Object.freeze(['specification.apply','site.confirm','application.confirm','app.restore']);
export const fieldTypes=Object.freeze(['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource']);
// Subset of the WH-105 closed binding registry admitted for native v1. `owned.photos@1`/`project.photos@1` wait for WH-085
// and `site.comparison@1`/`site.preview@1`/view bindings are display-only, which native v1 reads through the browser handoff.
export const interactionBindings=Object.freeze(['answer.value@1','interaction.answers@1','owned.projects@1','site.content@1','agent.task-continue@1','site.content-prepare@1']);
export const clientHeader=obj({contract:T.int(0,1e6),build:int(1,1e9),platform:lit('android'),controls:arr(en(...controlCapabilities),8),
 interaction:obj({versions:arr(int(1,1e6),4,1),fieldTypes:arr(en(...fieldTypes),20),bindings:arr(en(...interactionBindings),64)})});
export function admitClient(header,{minimumBuild}){
 let h=header;
 if(typeof header==='string'){check(/^[\x20-\x7e]{2,4096}$/.test(header),'invalid_request','Whumpo-Client');try{h=JSON.parse(header);}catch{fail('invalid_request','Whumpo-Client');}}
 clientHeader(h,'Whumpo-Client');
 check(h.contract===contractVersion,'client_update_required','contract');
 check(h.build>=minimumBuild,'client_update_required','build');
 check(h.interaction.versions.length===1&&h.interaction.versions[0]===1,'client_update_required','interaction.versions');
 for(const list of [h.controls,h.interaction.fieldTypes,h.interaction.bindings])check(new Set(list).size===list.length,'invalid_request','duplicate');
 return h;
}

// ---- Native review controls: exact copies of src/chat-controls.ts shapes; nothing else is admitted. ------------------
export const reviewKinds=Object.freeze({
 specification:{capability:'specification.apply',type:'specificationApply',freshPasskey:true},
 site:{capability:'site.confirm',type:'confirm',freshPasskey:false,confirmKind:'site'},
 application:{capability:'application.confirm',type:'confirm',freshPasskey:false,confirmKind:'application'},
 'app-restore':{capability:'app.restore',type:'appRestore',freshPasskey:false},
});
const digest64=str(64,/^[0-9a-f]{64}$/,64);
export const control=(v,p='control')=>{
 check(plain(v)&&typeof v.type==='string','invalid_request',p);
 if(v.type==='specificationApply')return obj({type:lit('specificationApply'),reviewId:uuid(),proposalDigest:digest64,expectedRevision:int(0,1e9)})(v,p);
 if(v.type==='confirm'&&v.kind==='site')return obj({type:lit('confirm'),kind:lit('site'),reviewId:uuid()})(v,p);
 if(v.type==='confirm'&&v.kind==='application')return obj({type:lit('confirm'),kind:lit('application'),reviewId:uuid()})(v,p);
 if(v.type==='appRestore')return obj({type:lit('appRestore'),projectId:uuid(),reviewId:uuid(),confirmation:lit('RESTORE')})(v,p);
 // Every other chat control (provider grants, DNS, backups, deletes, unpublish, CMS, shortcuts, review-detail) is excluded.
 fail('unsupported_control',p);
};
export const controlCapability=c=>c.type==='specificationApply'?'specification.apply':c.type==='appRestore'?'app.restore':c.kind==='site'?'site.confirm':'application.confirm';
const previewPath=str(120,/^\/api\/(?:site-versions\/[0-9a-f-]{36}\/preview|specification-reviews\/[0-9a-f-]{36}\/(?:preview|diff)|publication-reviews\/[0-9a-f-]{36}\/diff)$/,1);
export const review=(v,p='review')=>{
 obj({kind:en(...Object.keys(reviewKinds)),reviewId:uuid(),project:nul(obj({id:uuid(),name:str(100,null,1)})),state:en('pending','applied','expired','superseded','unavailable'),
  expiresAt:iso(),canApprove:bool(),control:nul(control),requiresFreshPasskey:bool(),
  disclosure:obj({title:str(120,null,1),lines:arr(str(300,null,1),8,1)}),preview:nul(obj({path:previewPath})),
  unavailableReason:nul(en('client_update_required','expired','stale','not_current'))})(v,p);
 const kind=reviewKinds[v.kind];
 check(v.requiresFreshPasskey===kind.freshPasskey,'invalid_request',p+'.requiresFreshPasskey');
 if(v.canApprove){
  check(v.state==='pending'&&v.control!==null&&v.unavailableReason===null,'invalid_request',p+'.canApprove');
  check(v.control.type===kind.type&&(!kind.confirmKind||v.control.kind===kind.confirmKind)&&v.control.reviewId===v.reviewId,'invalid_request',p+'.control');
 }else check(v.control===null,'invalid_request',p+'.control');
 if(v.state!=='pending')check(!v.canApprove,'invalid_request',p+'.state');
};
/** What a current client must do with a review it was sent. An unlisted capability never enables approval. */
export function presentReview(r,client){
 if(!r.canApprove)return {enabled:false,reason:r.unavailableReason??r.state};
 return client.controls.includes(controlCapability(r.control))?{enabled:true,reason:null}:{enabled:false,reason:'client_update_required'};
}

// ---- Common response parts. --------------------------------------------------------------------------------------
const turn=obj({id:uuid(),revision:int(1,2000),status:en('pending','completed','failed','uncertain'),mode:en('guided','ai'),createdAt:iso(),
 userText:str(1000),assistantText:nul(str(20000)),review:nul(review),interaction:nul(obj({interactionId:uuid(),state:en('open','submitted','canceled','superseded','expired')}))});
const project=obj({id:uuid(),name:str(100,null,1),purpose:str(1000),status:str(40,/^[a-z_-]+$/,1),siteLive:bool(),backendLive:bool(),createdAt:iso(),updatedAt:iso()});
const version=obj({id:uuid(),componentId:str(80,null,1),digest:str(64,/^[0-9a-f]{64}$/,64),createdAt:iso(),preview:obj({path:previewPath})});
const activityItem=obj({id:uuid(),projectId:nul(uuid()),action:str(80,/^[a-z][a-z._-]*$/,1),summary:str(300,null,1),createdAt:iso()});
const photo=obj({id:uuid(),name:str(100,null,1),width:int(1,1600),height:int(1,1600),size:int(1,1048576),status:en('pending','ready'),safetyStatus:en('pending','approved','blocked')});
const sessionInfo=obj({token:str(64,/^[0-9a-f]{64}$/,64),expiresAt:iso(),freshUntil:nul(iso())});
// WebAuthn JSON payloads are bounded opaque objects checked by the server's WebAuthn verifier, never trusted from clients.
const webauthn=T.json(8192);
const safeRedirect=str(200,/^https:\/\/whumpo\.com\/app\/return$/,1);
const pkceChallenge=str(43,/^[A-Za-z0-9_-]{43}$/,43);
const pkceVerifier=str(128,/^[A-Za-z0-9._~-]{43,128}$/,43);
const stateParam=str(128,/^[A-Za-z0-9_-]{16,128}$/,16);

/** Operation registry. `source` names the existing handler an adapter must reuse; `new` marks a genuinely new adapter. */
export const operations=Object.freeze([
 {id:'config.read',method:'GET',path:'/config',auth:'none',wave:'WH-083',source:[],new:'minimum-build and RP configuration',
  query:{},body:null,write:false,idempotency:'none',
  response:obj({version:v1,contract:lit(1),minimumBuild:int(1,1e9),rpId:lit('whumpo.com'),browserReturn:safeRedirect})},
 {id:'session.loginOptions',method:'POST',path:'/session/login/options',auth:'none',wave:'WH-083',source:[['src/workspace-identity/ceremonies.ts','loginOptions']],
  body:obj({version:v1}),write:true,idempotency:'none',response:obj({version:v1,challengeId:uuid(),expiresAt:iso(),options:webauthn})},
 {id:'session.loginVerify',method:'POST',path:'/session/login/verify',auth:'none',wave:'WH-083',source:[['src/workspace-identity/ceremonies.ts','loginVerify']],
  body:obj({version:v1,challengeId:uuid(),credential:webauthn}),write:true,idempotency:'challenge-once',response:obj({version:v1,session:sessionInfo})},
 {id:'session.handoffStart',method:'POST',path:'/session/handoff/start',auth:'none',wave:'WH-083',source:[],new:'native handoff over the WH-113 shared identity flow',
  body:obj({version:v1,purpose:en('signin','signup','recovery'),state:stateParam,codeChallenge:pkceChallenge,codeChallengeMethod:lit('S256'),redirectUri:safeRedirect}),
  write:true,idempotency:'none',response:obj({version:v1,handoffId:uuid(),browserPath:str(200,/^\/workspace\/native\/[A-Za-z0-9_-]{16,128}$/,1),expiresAt:iso()})},
 {id:'session.handoffExchange',method:'POST',path:'/session/handoff/exchange',auth:'none',wave:'WH-083',source:[],new:'one-time code exchange',
  body:obj({version:v1,handoffId:uuid(),code:str(64,/^[0-9a-f]{64}$/,64),state:stateParam,codeVerifier:pkceVerifier}),write:true,idempotency:'code-once',
  response:obj({version:v1,session:sessionInfo})},
 {id:'session.reauthOptions',method:'POST',path:'/session/reauth/options',auth:'bearer',wave:'WH-083',source:[['src/workspace-identity/ceremonies.ts','reauthenticationOptions']],
  body:obj({version:v1}),write:true,idempotency:'none',response:obj({version:v1,challengeId:uuid(),expiresAt:iso(),options:webauthn})},
 {id:'session.reauthVerify',method:'POST',path:'/session/reauth/verify',auth:'bearer',wave:'WH-083',source:[['src/workspace-identity/ceremonies.ts','reauthenticationVerify']],
  body:obj({version:v1,challengeId:uuid(),credential:webauthn}),write:true,idempotency:'challenge-once',response:obj({version:v1,session:obj({expiresAt:iso(),freshUntil:iso()})})},
 {id:'session.read',method:'GET',path:'/session',auth:'bearer',wave:'WH-083',source:[['src/workspace-identity/authority.ts','resolveIdentity']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,session:obj({expiresAt:iso(),freshUntil:nul(iso())}),account:obj({label:str(80,/^[^\s@]{1,3}\*{3}@[^\s@]+$/,1)})})},
 {id:'session.logout',method:'POST',path:'/session/logout',auth:'bearer',wave:'WH-083',source:[['src/workspace-identity/http.ts','logout']],
  body:obj({version:v1}),write:true,idempotency:'natural',response:obj({version:v1,signedOut:lit(true)})},
 {id:'bootstrap.read',method:'GET',path:'/bootstrap',auth:'bearer',wave:'WH-084',source:[['src/onboarding.ts','onboardingComplete'],['src/chat.ts','readChat']],
  query:{},body:null,write:false,idempotency:'none',onboardingGate:false,
  response:obj({version:v1,onboarding:obj({complete:bool(),browserPath:nul(str(80,/^\/workspace\/$/,1))}),chat:nul(obj({revision:int(0,2000),mode:en('guided','ai')})),projectCount:int(0,20),pendingReviewCount:int(0,5)})},
 {id:'chat.read',method:'GET',path:'/chat',auth:'bearer',wave:'WH-084',source:[['src/chat.ts','readChat'],['src/chat-history.ts','chatHistory']],
  query:{limit:int(1,50),cursor:opaque,q:str(100)},body:null,write:false,idempotency:'none',
  response:obj({version:v1,revision:int(0,2000),mode:en('guided','ai'),items:arr(turn,50),nextCursor:nul(opaque)})},
 {id:'chat.turn',method:'GET',path:'/chat/turns/{turnId}',auth:'bearer',wave:'WH-084',source:[['src/chat.ts','readSavedChatTurn']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,turn})},
 {id:'chat.send',method:'POST',path:'/chat/messages',auth:'bearer',wave:'WH-084',source:[['src/chat.ts','sendConversation']],
  body:obj({version:v1,requestId:uuid(),expectedRevision:int(0,2000),content:str(1000,null,1)}),write:true,idempotency:'requestId',
  response:obj({version:v1,requestId:uuid(),accepted:lit(true),revision:int(1,2000),turnStatus:en('pending','completed','failed','uncertain')})},
 {id:'review.list',method:'GET',path:'/reviews',auth:'bearer',wave:'WH-084',source:[['src/workspace-reviews.ts','readWorkspaceReviews']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,items:arr(review,5),denied:int(0,100),unavailable:int(0,100)})},
 {id:'review.confirm',method:'POST',path:'/reviews/confirm',auth:'bearer',wave:'WH-084',source:[['src/chat.ts','sendChatControl'],['src/chat-controls.ts','chatControl']],
  body:obj({version:v1,requestId:uuid(),expectedRevision:int(0,2000),control}),write:true,idempotency:'requestId',
  response:obj({version:v1,requestId:uuid(),accepted:lit(true),revision:int(1,2000),turnStatus:en('pending','completed','failed','uncertain')})},
 {id:'interaction.list',method:'POST',path:'/interactions/list',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','listInteractions']],
  body:obj({version:v1,projectId:nul(uuid()),limit:int(1,20),before:nul(T.json(512))}),write:false,idempotency:'none',response:T.json(65536),passthrough:'chat-interactions.md#wire-objects-and-digest'},
 {id:'interaction.read',method:'POST',path:'/interactions/read',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','readInteraction']],
  body:obj({version:v1,interactionId:uuid(),client:obj({versions:arr(int(1,1e6),4,1),fieldTypes:arr(en(...fieldTypes),20),bindings:arr(en(...interactionBindings),64)})}),
  write:false,idempotency:'none',response:T.json(65536),passthrough:'chat-interactions.md#wire-objects-and-digest'},
 {id:'interaction.resources',method:'POST',path:'/interactions/resources',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','listInteractionResources']],
  body:obj({version:v1,interactionId:uuid(),definitionDigest:digest64,fieldId:str(40,/^[a-z][a-z0-9-]{0,39}$/,1),limit:int(1,20),before:nul(T.json(512))}),write:false,idempotency:'none',response:T.json(65536),passthrough:'chat-interactions.md#wire-objects-and-digest'},
 {id:'interaction.mutate',method:'POST',path:'/interactions/mutate',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','mutateInteraction']],
  body:(v,p)=>{
   obj({version:v1,requestId:uuid(),interactionId:uuid(),definitionDigest:digest64,expectedAnswerRevision:int(0,1e6),operation:en('save-draft','submit','cancel')},{answers:T.json(16384)})(v,p);
   check((v.operation==='cancel')===!Object.hasOwn(v,'answers'),'invalid_request',p+'.answers');
  },write:true,idempotency:'requestId',response:T.json(65536),passthrough:'chat-interactions.md#submission-state-and-operation-identity'},
 {id:'interaction.receipt',method:'POST',path:'/interactions/receipt',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','readInteractionReceipt']],
  body:obj({version:v1,requestId:uuid()}),write:false,idempotency:'none',response:T.json(16384),passthrough:'chat-interactions.md#submission-state-and-operation-identity'},
 {id:'interaction.continue',method:'POST',path:'/interactions/continue',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','continueContentBrief']],
  body:obj({version:v1,submissionId:uuid(),expectedChatRevision:int(0,2000)}),write:true,idempotency:'submissionId',response:T.json(65536),passthrough:'chat-interactions.md#maintained-content-brief-client-handoff--october-2-2026-utc'},
 {id:'interaction.stop',method:'POST',path:'/interactions/stop',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','stopInteractionContinuation']],
  body:obj({version:v1,submissionId:uuid()}),write:true,idempotency:'submissionId',response:T.json(65536),passthrough:'chat-interactions.md#maintained-content-brief-client-handoff--october-2-2026-utc'},
 {id:'interaction.reconcile',method:'POST',path:'/interactions/reconcile',auth:'bearer',wave:'WH-084',source:[['src/chat-interactions/http.ts','reconcileContentBrief']],
  body:obj({version:v1,submissionId:uuid()}),write:true,idempotency:'submissionId',response:T.json(65536),passthrough:'chat-interactions.md#maintained-content-brief-client-handoff--october-2-2026-utc'},
 {id:'project.list',method:'GET',path:'/projects',auth:'bearer',wave:'WH-084',source:[['src/index.ts','project_service_status']],
  query:{limit:int(1,50),cursor:opaque},body:null,write:false,idempotency:'none',response:obj({version:v1,items:arr(project,50),nextCursor:nul(opaque)})},
 {id:'project.read',method:'GET',path:'/projects/{projectId}',auth:'bearer',wave:'WH-084',source:[['src/index.ts','project_service_status'],['src/project-details.ts','readProjectDetails']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,project})},
 {id:'project.versions',method:'GET',path:'/projects/{projectId}/versions',auth:'bearer',wave:'WH-084',source:[['src/index.ts','site_versions']],
  query:{limit:int(1,25)},body:null,write:false,idempotency:'none',response:obj({version:v1,items:arr(version,25)})},
 {id:'activity.list',method:'GET',path:'/activity',auth:'bearer',wave:'WH-084',source:[['src/index.ts','activity_events']],
  query:{limit:int(1,50),cursor:opaque},body:null,write:false,idempotency:'none',response:obj({version:v1,items:arr(activityItem,50),nextCursor:nul(opaque)})},
 {id:'photo.list',method:'GET',path:'/projects/{projectId}/photos',auth:'bearer',wave:'WH-085',source:[['src/files.ts','listPhotos']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,items:arr(photo,100)})},
 {id:'photo.upload',method:'PUT',path:'/projects/{projectId}/photos/{uploadId}',auth:'bearer',wave:'WH-085',source:[['src/files.ts','uploadPhoto']],
  body:null,binary:{contentType:'image/jpeg',maxBytes:1048576,headers:['X-Photo-Name']},write:true,idempotency:'uploadId',response:obj({version:v1,photo})},
 {id:'photo.status',method:'GET',path:'/projects/{projectId}/photos/{uploadId}',auth:'bearer',wave:'WH-085',source:[['src/files.ts','readPhotoUpload']],
  query:{},body:null,write:false,idempotency:'none',response:obj({version:v1,photo})},
 {id:'photo.bytes',method:'GET',path:'/photos/{photoId}',auth:'bearer',wave:'WH-085',source:[['src/files.ts','readPhoto']],
  query:{},body:null,write:false,idempotency:'none',binaryResponse:{contentType:'image/jpeg'},response:null},
 {id:'device.register',method:'PUT',path:'/devices/current',auth:'bearer',wave:'WH-086',source:[],new:'owner/device push registration (FCM)',
  body:obj({version:v1,fcmRegistrationToken:str(4096,/^[A-Za-z0-9_:.-]+$/,16),notificationsEnabled:bool()}),write:true,idempotency:'natural',
  response:obj({version:v1,deviceId:uuid(),preferences:obj({notificationsEnabled:bool()})})},
 {id:'device.remove',method:'DELETE',path:'/devices/current',auth:'bearer',wave:'WH-086',source:[],new:'owner/device push withdrawal',
  body:null,write:true,idempotency:'natural',response:obj({version:v1,removed:lit(true)})},
 {id:'event.read',method:'GET',path:'/events/{eventId}',auth:'bearer',wave:'WH-086',source:[],new:'notification-destination readback from committed receipts',
  query:{},body:null,write:false,idempotency:'none',
  response:obj({version:v1,event:obj({id:uuid(),kind:en('review_pending','operation_completed','attention_required'),destination:nul(obj({type:en('chat-turn','review','project'),id:uuid()})),
   state:en('current','unavailable')})})},
]);
export const operationById=Object.freeze(Object.fromEntries(operations.map(o=>[o.id,o])));

/** FCM data payload: opaque event ID and kind only. No project name, text, source, photo or credential. */
export const pushMessage=obj({v:lit('1'),eventId:uuid(),kind:en('review_pending','operation_completed','attention_required')});

/** Explicitly outside /api/mobile/v1. A request naming one of these is not a v1 operation. */
export const excluded=Object.freeze([
 'cookie-authenticated or Origin-based access to any /api/mobile route','bearer access to any non-mobile /api route','a generic proxy or raw Chat command string',
 'passkey add/remove, recovery-kit prepare/save/rotate, recovery start/secure/complete, signup and invitation (trusted browser)',
 'onboarding answers and completion (trusted browser)','provider connections (GitHub, Cloudflare), DNS, domains and billing/checkout',
 'backups, exports, CMS/WordPress, backend/application publication reviews other than the four admitted controls','unpublish, version/photo delete, take-down shortcuts and review-detail/shortcut controls',
 'custom view components, temporary views, interaction cards, dashboard layout writes','attachment interaction fields, owned.photos@1 and project.photos@1 bindings until WH-085',
 'full offline synchronization or cached workspace snapshots','password, recovery-code or email-link authentication','iOS, customer-generated Android apps and public Play distribution',
]);

// ---- Request validation ------------------------------------------------------------------------------------------
export function pathParams(op,path){
 const re=new RegExp('^'+prefix+op.path.replace(/\{[A-Za-z]+\}/g,'([0-9a-f-]{36})')+'$'),m=re.exec(path);
 check(m!==null,'not_found','path');
 const names=[...op.path.matchAll(/\{([A-Za-z]+)\}/g)].map(x=>x[1]);
 names.forEach((n,i)=>check(uuidPattern.test(m[i+1]),'invalid_request','path.'+n));
 return Object.fromEntries(names.map((n,i)=>[n,m[i+1]]));
}
/** `req` = {headers:{authorization?,cookie?,'whumpo-client'},query,body}. Returns the admitted request or throws a wire code. */
export function validateRequest(opId,req,{minimumBuild=1}={}){
 const op=operationById[opId];check(op,'not_found','operation');
 const h=Object.fromEntries(Object.entries(req.headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
 const client=admitClient(h['whumpo-client'],{minimumBuild});
 // Cookies never cross: a Whumpo cookie on a mobile route is refused, whether or not a bearer is present.
 check(!('cookie' in h),'invalid_request','cookie');
 if(op.auth==='bearer'){
  check(typeof h.authorization==='string'&&/^Bearer [a-f0-9]{64}$/.test(h.authorization),'proof_required','authorization');
 }else check(!('authorization' in h),'invalid_request','authorization');
 const query=req.query??{};
 check(plain(query),'invalid_request','query');
 const allowed=op.query??{};
 for(const k of Object.keys(query))check(Object.hasOwn(allowed,k),'unknown_field','query.'+k);
 for(const k of Object.keys(query))allowed[k](query[k],'query.'+k);
 if(op.body)op.body(req.body,'body');else check(req.body===undefined||req.body===null,'invalid_request','body');
 if(op.id==='interaction.read'||op.id==='interaction.mutate'){
  // The interaction client capability must be the admitted header capability: no field type or binding the client did not declare.
  const cap=op.id==='interaction.read'?req.body.client:null;
  if(cap){check(JSON.stringify(cap)===JSON.stringify(client.interaction),'client_update_required','interaction.client');}
 }
 if(op.id==='review.confirm')check(client.controls.includes(controlCapability(req.body.control)),'client_update_required','control');
 return {op,client};
}
export function validateResponse(opId,body){
 const op=operationById[opId];check(op,'not_found','operation');
 check(op.response!==null,'invalid_request','binary response');
 op.response(body,'response');
}
export function validateError(body){errorBody(body,'error');}
export const pkceChallengeFor=verifier=>createHash('sha256').update(verifier,'ascii').digest('base64url');
export function verifyExchange(start,exchange){
 check(start.state===exchange.state,'invalid_request','state');
 check(pkceChallengeFor(exchange.codeVerifier)===start.codeChallenge,'proof_required','codeVerifier');
}

// ---- Reference session/authority/idempotency semantics (offline models of the documented rules) ----------------------
export const sessionPolicy=Object.freeze({absoluteSeconds:7*86400,freshSeconds:600,challengeSeconds:300,handoffSeconds:300,exchangeSeconds:60});
const ungated=new Set(['config.read','session.loginOptions','session.loginVerify','session.handoffStart','session.handoffExchange','session.read','session.logout','session.reauthOptions','session.reauthVerify','bootstrap.read']);
/** `session` = {client,expiresAt,epoch,proofMethod,proofAt}; `account` = {stage,authEpoch,onboardingComplete}; times are epoch seconds. */
export function authorize({session,account,opId,control=null,now}){
 const op=operationById[opId];check(op,'not_found','operation');
 if(op.auth==='none')return {freshPasskey:false};
 check(session&&session.client==='android','proof_required','session');
 check(now<session.expiresAt,'proof_required','expired');
 // Revoking sessions deletes them and every epoch bump invalidates the rest: a stale session is simply unknown.
 check(session.epoch===account.authEpoch,'proof_required','revoked');
 check(account.stage==='ready','identity_incomplete','stage');
 if(!ungated.has(opId))check(account.onboardingComplete,'onboarding_required','onboarding');
 const fresh=session.proofMethod==='passkey'&&now-session.proofAt<=sessionPolicy.freshSeconds;
 if(control&&reviewKindFor(control).freshPasskey)check(fresh,'proof_required','fresh_passkey');
 return {freshPasskey:fresh};
}
const reviewKindFor=c=>Object.values(reviewKinds).find(k=>k.type===c.type&&(!k.confirmKind||k.confirmKind===c.kind));
/** One-time handoff exchange. The minted session never has a longer life or fresher proof than its source authentication. */
export function exchangeHandoff({start,exchange,state,source,account,now,used=false}){
 check(!used,'proof_required','replay');
 check(now<=state.startedAt+sessionPolicy.handoffSeconds&&now<=state.codeIssuedAt+sessionPolicy.exchangeSeconds,'proof_required','expired');
 verifyExchange(start,exchange);
 check(source&&now<source.expiresAt&&source.epoch===account.authEpoch,'proof_required','source session');
 check(account.stage==='ready','identity_incomplete','stage');
 return {client:'android',expiresAt:Math.min(now+sessionPolicy.absoluteSeconds,source.expiresAt),epoch:account.authEpoch,proofMethod:source.proofMethod,proofAt:source.proofAt};
}
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const requestDigest=body=>createHash('sha256').update(canonical(body)).digest('hex');
/** Same ID + same payload reads the committed result; same ID + changed payload is a conflict. Never a second effect. */
export function replay(store,requestId,body){
 const digest=requestDigest(body),prior=store.get(requestId);
 if(prior===undefined){store.set(requestId,digest);return 'new';}
 check(prior===digest,'request_conflict','requestId');return 'replay';
}

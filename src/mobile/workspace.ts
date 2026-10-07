import {admitWorkspace,workspaceBindings,workspaceTransport,assertWorkspace,requireFreshWorkspace} from '../workspace-identity/admission';
import {IdentityError,type IdentityPrincipal} from '../workspace-identity/authority';
import {onboardingComplete} from '../onboarding';
import {readChat,readSavedChatTurn,sendConversation,sendChatControl} from '../chat';
import {chatHistory} from '../chat-history';
import {configuredAI} from '../ai-chat';
import {cloudflareConfig} from '../cloudflare-connection';
import {githubConfig} from '../github-connection';
import {hostingConfig} from '../domain-hosting';
import {cmsWordPressAction,cmsWordPressCommand} from '../cms-wordpress-chat';
import {cmsDiscardCommand} from '../cms-discard';
import {cmsUnpublishCommand} from '../cms-unpublish';
import {cmsPublicationCommand} from '../cms-publication';
import {cmsContentAction} from '../cms-content';
import {readCMSStatus} from '../cms-status';
import type {DNSChatOptions} from '../dns-chat';
import {nativeInteraction} from './interactions';
import {nativeControl,nativeReviews,reviewForControl,reviewForTurn} from './reviews';
import {pageQuery,tuplePosition} from './pagination';
import {MobileError,minimumBuild,mobileInput,mobileResponse,versioned,type MobileClient} from './protocol';

const uuid='[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}';
const reads=new RegExp(`^/(?:bootstrap|chat|chat/turns/${uuid}|reviews|projects|projects/${uuid}(?:/versions)?|activity)$`);
const writes=/^\/(?:chat\/messages|reviews\/confirm|interactions\/(?:list|read|resources|mutate|receipt|continue|stop|reconcile))$/;
export const mobileWorkspaceOperation=(method:string,path:string)=>method==='GET'?reads.test(path):method==='POST'&&writes.test(path);
const plain=(v:unknown,max:number)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
const id=(v:unknown):v is string=>typeof v==='string'&&new RegExp('^'+uuid+'$').test(v);
const status=(v:unknown)=>['pending','completed','failed','uncertain'].includes(String(v))?String(v):'uncertain';
const project=(p:Record<string,unknown>)=>({id:p.id,name:plain(p.name,100),purpose:plain(p.purpose,1000),status:p.status,siteLive:p.site_live===1,backendLive:p.backend_live===1,createdAt:p.created_at,updatedAt:p.updated_at});
async function turnDTO(db:D1Database,user:string,t:Record<string,unknown>,client:MobileClient,current=true){
 let interaction:null|{interactionId:string;state:string}=null;
 const interactionId=t.interaction_id??(t.interaction as {id?:string}|undefined)?.id;
 if(typeof interactionId==='string'){
  const r=await db.prepare("SELECT id,CASE WHEN state='open' AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired' ELSE state END state FROM chat_interactions WHERE id=? AND user_id=? AND removed_at IS NULL").bind(interactionId,user).first<{id:string;state:string}>();
  if(r)interaction={interactionId:r.id,state:r.state};
 }
 return {id:t.id,revision:t.revision,status:status(t.status),mode:t.mode,createdAt:t.created_at,userText:plain(t.user_text,1000),assistantText:t.assistant_text===null?null:plain(t.assistant_text,20000),review:current?await reviewForTurn(db,user,t,client):null,interaction};
}
function options(env:Env,user:string,ctx:ExecutionContext):DNSChatOptions{
 const db=env.DB,transport=workspaceTransport(db,user),cmsEnv=env as unknown as Record<string,unknown>;
 return {transport,githubTransport:transport,background:promise=>ctx.waitUntil(promise),cmsPublication:(turn,content)=>cmsWordPressCommand(db,user,turn,content,cmsEnv)??cmsDiscardCommand(db,user,turn,content,cmsEnv)??cmsUnpublishCommand(db,user,turn,content,cmsEnv)??cmsPublicationCommand(db,user,turn,content,cmsEnv),cmsContent:(action,id)=>cmsWordPressAction(db,user,action,id,cmsEnv)??cmsContentAction(db,user,action,id,cmsEnv),cms:project=>readCMSStatus(db,user,project,cmsEnv),backendRuntime:env.BACKEND_RUNTIME,config:cloudflareConfig(env),hostingReady:!!hostingConfig(env),hosting:hostingConfig(env),github:githubConfig(env),files:env.FILES,healthChecks:String(env.ENVIRONMENT)!=='local'};
}
/** A closed adapter over current scoped handlers. No web request proxy or native authority store. */
export async function mobileWorkspace(request:Request,environment:Env,p:IdentityPrincipal,client:MobileClient,ctx:ExecutionContext){
 const env=workspaceBindings(environment,admitWorkspace(environment.DB,p),p.accountId),db=env.DB,user=p.accountId,url=new URL(request.url),path=url.pathname.slice('/api/mobile/v1'.length),ai=configuredAI(env),mode=ai?'ai':'guided';
 const done=async(body:Record<string,unknown>)=>{await assertWorkspace(db,user);return mobileResponse(body);};
 const complete=await onboardingComplete(db,user);
 if(path==='/bootstrap'){
  if(url.search)throw new MobileError('invalid_request');
  if(!complete)return done({onboarding:{complete:false,browserPath:'/workspace/'},chat:null,projectCount:0,pendingReviewCount:0});
  const chat=await readChat(db,user,!!ai),reviews=await nativeReviews(db,user,client);
  return done({onboarding:{complete:true,browserPath:null},chat:{revision:(chat.state as {revision:number}).revision,mode},projectCount:(chat.stats as {projects:number}).projects,pendingReviewCount:reviews.items.length});
 }
 if(!complete)throw new MobileError('onboarding_required',{next:'browser'});
 if(request.method==='GET'){
  if(path==='/chat'){
   const page=await pageQuery(url,user,true);
   if(page.position!==null&&(!Number.isSafeInteger(page.position)||Number(page.position)<1||Number(page.position)>2001))throw new MobileError('invalid_cursor');
   const current=await readChat(db,user,!!ai),revision=(current.state as {revision:number}).revision,before=Number(page.position??revision+1);
   const historyURL=new URL('https://whumpo.com/api/chat/history');historyURL.searchParams.set('before',String(before));historyURL.searchParams.set('q',page.query);
   const history=await (await chatHistory(new Request(historyURL),db,user)).json() as {turns:Record<string,unknown>[];nextBefore:number|null};
   const selected=history.turns.slice(-page.limit),recent=new Map(current.turns.map(t=>{const r=t as Record<string,unknown>;return [r.id,r];}));
   const items=[];for(const t of selected){const r=recent.get(t.id),same=r&&r.revision===t.revision&&r.assistant_text===t.assistant_text&&r.status===t.status;items.push(await turnDTO(db,user,same?r:t,client,!!same));}
   return done({revision,mode,items,nextCursor:(history.turns.length>page.limit||history.nextBefore!==null)&&selected.length?page.cursor(selected[0].revision):null});
  }
  if(path.startsWith('/chat/turns/')){
   if(url.search)throw new MobileError('invalid_request');const t=await readSavedChatTurn(db,user,path.split('/').at(-1)!);if(!t)throw new MobileError('not_found');return done({turn:await turnDTO(db,user,t,client)});
  }
  if(path==='/reviews'){if(url.search)throw new MobileError('invalid_request');return done(await nativeReviews(db,user,client));}
  if(path==='/projects'||path==='/activity'||path.endsWith('/versions')){
   if(path.endsWith('/versions')&&([...url.searchParams.keys()].some(k=>k!=='limit')||Number(url.searchParams.get('limit')??25)>25))throw new MobileError('invalid_request');
   const page=await pageQuery(url,user),before=tuplePosition(page.position,path==='/activity'),params=[before?.[0]??null,before?.[0]??null,before?.[0]??null,before?.[1]??null,page.limit+1];let rows:Record<string,unknown>[],items:Record<string,unknown>[],time='created_at';
   if(path==='/projects'){
    rows=(await db.prepare('SELECT id,name,purpose,service_status status,site_live,backend_live,created_at,updated_at FROM project_service_status WHERE owner_user_id=? AND (? IS NULL OR updated_at<? OR (updated_at=? AND id<?)) ORDER BY updated_at DESC,id DESC LIMIT ?').bind(user,...params).all<Record<string,unknown>>()).results;items=rows.slice(0,page.limit).map(project);time='updated_at';
   }else if(path==='/activity'){
    rows=(await db.prepare('SELECT id,project_id,action,summary,created_at FROM activity_events WHERE user_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?').bind(user,...params).all<Record<string,unknown>>()).results;
    items=rows.slice(0,page.limit).map(r=>({id:r.id,projectId:r.project_id,action:r.action,summary:plain(r.summary,300),createdAt:r.created_at}));
   }else{
    const projectId=path.split('/')[2];if(!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(projectId,user).first())throw new MobileError('not_found');
    rows=(await db.prepare('SELECT v.id,v.component_id,v.digest,v.created_at FROM site_versions v JOIN projects p ON p.id=v.project_id AND p.owner_user_id=? WHERE v.project_id=? AND (? IS NULL OR v.created_at<? OR (v.created_at=? AND v.id<?)) ORDER BY v.created_at DESC,v.id DESC LIMIT ?').bind(user,projectId,...params).all<Record<string,unknown>>()).results;
    items=rows.slice(0,page.limit).map(r=>({id:r.id,componentId:r.component_id,digest:r.digest,createdAt:r.created_at,preview:{path:`/api/site-versions/${r.id}/preview`}}));
   }
   if(path.endsWith('/versions'))return done({items});
   const last=rows[Math.min(rows.length,page.limit)-1];return done({items,nextCursor:rows.length>page.limit?page.cursor([last[time],last.id]):null});
  }
  if(url.search)throw new MobileError('invalid_request');
  const r=await db.prepare('SELECT id,name,purpose,service_status status,site_live,backend_live,created_at,updated_at FROM project_service_status WHERE id=? AND owner_user_id=?').bind(path.split('/')[2],user).first<Record<string,unknown>>();if(!r)throw new MobileError('not_found');return done({project:project(r)});
 }
 if(url.search)throw new MobileError('invalid_request');
 const input=await mobileInput(request,path.startsWith('/interactions/')?32768:16384);
 if(path.startsWith('/interactions/')){const result=await nativeInteraction(path.split('/').at(-1)!,input,db,user,client,env,ai,workspaceTransport(db,user),{github:githubConfig(env),config:cloudflareConfig(env)});await assertWorkspace(db,user);return result;}
 const review=path==='/reviews/confirm',d=versioned(input,['requestId','expectedRevision',review?'control':'content'],env);
 if(!id(d.requestId)||!Number.isSafeInteger(d.expectedRevision)||Number(d.expectedRevision)<0||Number(d.expectedRevision)>2000)throw new MobileError('invalid_request');
 const control=review?nativeControl(d.control):null;
 if(control&&!client.controls.includes(control.capability))throw new MobileError('client_update_required',{minimumBuild:minimumBuild(env),contract:1,next:'update_app'});
 if(!review&&(typeof d.content!=='string'||!d.content.trim()||d.content.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(d.content)))throw new MobileError('invalid_request');
 if(control?.recentAuth){if(!(await env.AUTH_LIMITER.limit({key:'native-review:'+user})).success)throw new MobileError('rate_limited',{retryAfterSeconds:60});try{await requireFreshWorkspace(db,user);}catch(error){if(error instanceof IdentityError&&error.code==='proof_required')throw new MobileError('proof_required',{proof:'fresh_passkey'});throw error;}}
 const text=control?control.label:(d.content as string).trim(),action=control?JSON.stringify(control.action):null;
 const prior=await db.prepare('SELECT user_text,action_json,revision,status FROM chat_turns WHERE id=? AND user_id=?').bind(d.requestId,user).first<{user_text:string;action_json:string|null;revision:number;status:string}>();
 if(prior){if(prior.user_text!==text||prior.action_json!==action||prior.revision!==Number(d.expectedRevision)+1)throw new MobileError('request_conflict');return done({requestId:d.requestId,accepted:true,revision:prior.revision,turnStatus:status(prior.status)});}
 if(control){const r=await reviewForControl(db,user,control.action,client);if(!r?.canApprove||JSON.stringify(nativeControl(r.control).action)!==action)throw new MobileError('review_unavailable');}
 const result=await (control?sendChatControl(db,user,{id:d.requestId,revision:d.expectedRevision,action:control.action},ai,options(env,user,ctx)):sendConversation(db,user,{id:d.requestId,revision:d.expectedRevision,content:d.content},ai,options(env,user,ctx)));
 if(result.error){
  if(result.status===400)throw new MobileError('invalid_request');if(result.status===429)throw new MobileError('rate_limited',{retryAfterSeconds:60});if(result.status===503)throw new MobileError('unavailable');
  const revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first<{revision:number}>())?.revision??0;
  if(await db.prepare("SELECT 1 FROM chat_turns WHERE user_id=? AND status='pending'").bind(user).first())throw new MobileError('chat_busy');
  if(revision!==d.expectedRevision)throw new MobileError('stale_revision',{currentRevision:revision});throw new MobileError(control?'review_unavailable':'request_conflict');
 }
 const saved=await db.prepare('SELECT revision,status FROM chat_turns WHERE id=? AND user_id=? AND user_text=? AND action_json IS ?').bind(d.requestId,user,text,action).first<{revision:number;status:string}>();
 if(!saved)throw new MobileError('unavailable');return done({requestId:d.requestId,accepted:true,revision:saved.revision,turnStatus:status(saved.status)});
}

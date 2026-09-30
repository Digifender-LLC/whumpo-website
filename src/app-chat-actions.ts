import {backendFormConfig} from './backend-form-render';
import type {AppPageReviewPresentation} from './app-page-review-shape';
import type {ApplicationReviewPresentation} from './application-review-shape';
import {describeApplicationReview,type readApplicationReview} from './app-activation';
import {describeAppPage,type readAppPageReview} from './app-pages';
import {hashToken} from './security';
type Turn=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Program=Awaited<ReturnType<typeof readApplicationReview>>&{current_revision:number;current_version:string;visitors:number;project_name:string;unexpired:number;current_review:string;active_program:number;has_page:number;has_page_review:number};
type Page=Awaited<ReturnType<typeof readAppPageReview>>&{current_revision:number;current_program:number;program_enabled:number;project_name:string;unexpired:number;live_review:string|null};
/** Presentation and buttons require an exact authoritative receipt; only a current pending review grants a button. */
export async function applicationChatActions(db:D1Database,user:string,turns:Turn[]){
 for(const turn of turns){delete turn.app_page_live_project_id;delete turn.app_page_review;delete turn.application_page_design_project_id;delete turn.application_review;delete turn.application_confirmation_id;delete turn.application_operation;delete turn.app_page_confirmation_id;delete turn.app_page_operation;}
 for(const kind of ['application','app-page'] as const){
  const candidates=turns.slice(0,100).filter(t=>t.status==='completed'&&typeof t.assistant_text==='string'&&t.assistant_text.startsWith(kind==='application'?'Application review ':'Application page review ')).map(turn=>{
   const read=String(turn.user_text).trim().match(new RegExp('^/'+(kind==='application'?'(?:application-(?:review|build)|confirm-application)':'(?:app-page-review|confirm-app-page)')+'\\s+([0-9a-f-]{36})$','i'));
   return {turn,id:read?.[1]??String(turn.id)};
  }).filter(c=>uuid.test(c.id));
  const ids=[...new Set(candidates.map(c=>c.id))];
  for(let offset=0;offset<ids.length;offset+=50){
   const batch=ids.slice(offset,offset+50),placeholders=batch.map(()=>'?').join(',');
   const sql=kind==='application'
    ?`SELECT r.*,a.review_id current_review,a.enabled active_program,EXISTS(SELECT 1 FROM app_live_pages WHERE project_id=r.project_id) has_page,EXISTS(SELECT 1 FROM app_page_reviews pr JOIN app_page_settings ps ON ps.project_id=pr.project_id WHERE pr.project_id=r.project_id AND pr.program_revision=a.revision AND pr.base_revision=ps.revision AND pr.status='pending' AND pr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) has_page_review,p.name project_name,r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') unexpired,v.source,v.digest,a.revision current_revision,a.version_id current_version,(SELECT count(*) FROM app_visitors WHERE project_id=r.project_id) visitors FROM app_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN backend_versions v ON v.id=r.version_id AND v.project_id=r.project_id WHERE r.user_id=? AND r.id IN (${placeholders}) `
    :`SELECT r.*,(SELECT id FROM app_live_pages WHERE project_id=r.project_id) live_review,p.name project_name,r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') unexpired,s.revision current_revision,a.revision current_program,a.enabled program_enabled FROM app_page_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN app_page_settings s ON s.project_id=r.project_id WHERE r.user_id=? AND r.id IN (${placeholders})`;
   const {results}=await db.prepare(sql).bind(user,...batch).all<Program|Page>();
   for(const row of results){
    let description:string,presentation:ApplicationReviewPresentation|undefined,pagePresentation:AppPageReviewPresentation|undefined,ready=true,historical:string|undefined;
    if(kind==='application'){
     const r=row as Program;
     if(await hashToken(r.source)!==r.digest)continue;
     const state:ApplicationReviewPresentation['state']=r.status==='applied'?'applied':!r.unexpired?'expired':r.base_revision!==r.current_revision||r.enabled&&r.visitors>0&&r.current_version!==r.version_id?'changed':'ready';
     ready=state==='ready';
     presentation={id:r.id,projectName:r.project_name,operation:r.enabled?'enable':'disable',state,expiresAt:r.expires_at,source:r.source,digest:r.digest,testId:r.run_id};
     if(r.status==='applied')historical=describeApplicationReview({...r,status:'pending'});
     description=describeApplicationReview(r);
    }else{
     const r=row as Page;
     const state:AppPageReviewPresentation['state']=r.status==='applied'?'applied':!r.unexpired?'expired':r.base_revision!==r.current_revision||r.program_revision!==r.current_program||r.config_json&&!r.program_enabled?'changed':'ready';
     ready=state==='ready';
     let form=null;try{if(r.config_json)form=backendFormConfig(JSON.parse(r.config_json));}catch{continue;}
     pagePresentation={id:r.id,projectId:r.project_id,projectName:r.project_name,state,expiresAt:r.expires_at,form,programRevision:r.program_revision,pageRevision:r.base_revision};
     if(r.status==='applied')historical=describeAppPage({...r,status:'pending'});
     description=describeAppPage(r);
    }
    let offeredDesign=false,offeredPage=false;
    for(const {turn,id} of candidates)if(id===row.id&&(turn.assistant_text===description||historical!==undefined&&turn.assistant_text===historical)){
     if(presentation){turn.application_review=presentation;const r=row as Program;if(!offeredDesign&&r.status==='applied'&&r.enabled&&r.active_program&&r.current_review===r.id&&!r.has_page&&!r.has_page_review){turn.application_page_design_project_id=r.project_id;offeredDesign=true;}}
     if(pagePresentation){turn.app_page_review=pagePresentation;const r=row as Page;if(!offeredPage&&r.status==='applied'&&r.live_review===r.id){turn.app_page_live_project_id=r.project_id;offeredPage=true;}}
     if(!ready)continue;
     const key=kind==='application'?'application':'app_page';
     turn[key+'_confirmation_id']=row.id;
     turn[key+'_operation']=kind==='application'?((row as Program).enabled?'enable':'disable'):((row as Page).config_json?'publish':'unpublish');
    }
   }
  }
 }
}

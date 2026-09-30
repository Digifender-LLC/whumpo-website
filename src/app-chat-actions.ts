import {describeApplicationReview,type readApplicationReview} from './app-activation';
import {describeAppPage,type readAppPageReview} from './app-pages';
import {hashToken} from './security';
type Turn=Record<string,unknown>;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Program=Awaited<ReturnType<typeof readApplicationReview>>&{current_revision:number;current_version:string;visitors:number};
type Page=Awaited<ReturnType<typeof readAppPageReview>>&{current_revision:number;current_program:number;program_enabled:number};
/** Buttons decorate only a complete authoritative review already visible in Chat. */
export async function applicationChatActions(db:D1Database,user:string,turns:Turn[]){
 for(const kind of ['application','app-page'] as const){
  const candidates=turns.slice(0,100).filter(t=>t.status==='completed'&&typeof t.assistant_text==='string'&&t.assistant_text.startsWith(kind==='application'?'Application review ':'Application page review ')).map(turn=>{
   const read=String(turn.user_text).trim().match(new RegExp('^/'+(kind==='application'?'application-(?:review|build)':'app-page-review')+'\\s+([0-9a-f-]{36})$','i'));
   return {turn,id:read?.[1]??String(turn.id)};
  }).filter(c=>uuid.test(c.id));
  const ids=[...new Set(candidates.map(c=>c.id))];
  for(let offset=0;offset<ids.length;offset+=50){
   const batch=ids.slice(offset,offset+50),placeholders=batch.map(()=>'?').join(',');
   const sql=kind==='application'
    ?`SELECT r.*,v.source,v.digest,a.revision current_revision,a.version_id current_version,(SELECT count(*) FROM app_visitors WHERE project_id=r.project_id) visitors FROM app_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN backend_versions v ON v.id=r.version_id AND v.project_id=r.project_id WHERE r.user_id=? AND r.id IN (${placeholders}) AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`
    :`SELECT r.*,s.revision current_revision,a.revision current_program,a.enabled program_enabled FROM app_page_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id JOIN app_page_settings s ON s.project_id=r.project_id WHERE r.user_id=? AND r.id IN (${placeholders}) AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
   const {results}=await db.prepare(sql).bind(user,...batch).all<Program|Page>();
   for(const row of results){
    let description:string;
    if(kind==='application'){
     const r=row as Program;
     if(r.base_revision!==r.current_revision||r.enabled&&r.visitors>0&&r.current_version!==r.version_id||await hashToken(r.source)!==r.digest)continue;
     description=describeApplicationReview(r);
    }else{
     const r=row as Page;if(r.base_revision!==r.current_revision||r.program_revision!==r.current_program||r.config_json&&!r.program_enabled)continue;
     description=describeAppPage(r);
    }
    for(const {turn,id} of candidates)if(id===row.id&&turn.assistant_text===description){
     const key=kind==='application'?'application':'app_page';
     turn[key+'_confirmation_id']=row.id;
     turn[key+'_operation']=kind==='application'?((row as Program).enabled?'enable':'disable'):((row as Page).config_json?'publish':'unpublish');
    }
   }
  }
 }
}

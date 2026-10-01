import {BackendError} from './backend-versions';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Kind='upgrade'|'rollback'|'restore'|'activation'|'page';
type Row={kind:Kind;id:string;project_id:string;project_name:string;state:string;expires_at:string;priority:number};
export function appMaintenanceRequest(content:string){
 const text=content.trim().toLowerCase();
 if(['show unfinished app work','show app maintenance','show pending app work'].includes(text))return {page:1};
 if(!/^\/app-maintenance(?:\s|$)/.test(text))return;
 const parts=text.split(/\s+/).slice(1);
 if(parts.length>2||parts[0]&&parts[0]!=='all'&&!uuid.test(parts[0])||parts[1]&&!/^(?:[1-9]\d?|100)$/.test(parts[1]))return {error:"Choose an application and a maintenance page from 1 to 100."};
 return {projectId:parts[0]&&parts[0]!=='all'?parts[0]:undefined,page:Number(parts[1]??1)};
}
/** Owner-scoped metadata only. Opening the inventory never runs or approves work. */
export async function listAppMaintenance(db:D1Database,user:string,project?:string,page=1){
 if(project!==undefined&&!uuid.test(project)||!Number.isSafeInteger(page)||page<1||page>100)throw new BackendError(400,'Choose a valid application and maintenance page');
 if(project&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new BackendError(404,'Project not found');
 const {results}=await db.prepare(`WITH owned AS (SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?)), work AS (
 SELECT 'upgrade' kind,m.id,m.project_id,p.name project_name,
 CASE WHEN NOT EXISTS(SELECT 1 FROM app_migration_current c WHERE c.id=m.id) THEN 'changed' WHEN EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=m.id AND state='failed') THEN 'failed' WHEN EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=m.id AND state='running') THEN 'uncertain' WHEN EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=m.id AND state='pending') THEN 'preparing' ELSE 'review' END state,m.expires_at
 FROM app_migration_checks m JOIN owned p ON p.id=m.project_id JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id WHERE m.user_id=? AND NOT EXISTS(SELECT 1 FROM app_migration_approvals WHERE id=m.id) AND NOT EXISTS(SELECT 1 FROM app_migration_cancellations WHERE id=m.id)
 UNION ALL SELECT CASE WHEN r.restore_program=1 THEN 'rollback' ELSE 'restore' END,r.id,r.project_id,p.name,'review',r.expires_at FROM app_restore_reviews r JOIN owned p ON p.id=r.project_id JOIN app_spaces a ON a.project_id=r.project_id AND a.owner_user_id=r.user_id WHERE r.user_id=? AND r.status='pending'
 UNION ALL SELECT 'activation',r.id,r.project_id,p.name,'review',r.expires_at FROM app_activation_reviews r JOIN owned p ON p.id=r.project_id WHERE r.user_id=? AND r.status='pending'
 UNION ALL SELECT 'page',r.id,r.project_id,p.name,'review',r.expires_at FROM app_page_reviews r JOIN owned p ON p.id=r.project_id WHERE r.user_id=? AND r.status='pending'
 ) SELECT *,CASE WHEN state IN ('failed','uncertain','changed') THEN 0 ELSE 1 END priority FROM work WHERE expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY priority,expires_at,kind,id LIMIT 21 OFFSET ?`).bind(user,project??null,project??null,user,user,user,user,(page-1)*20).all<Row>();
 const rows=results.slice(0,20).map(r=>{
  const labels:Record<Kind,string>={upgrade:'App upgrade',rollback:'Program and data rollback',restore:'Visitor data restore',activation:'App access change',page:'Visitor page change'};
  if(!Object.hasOwn(labels,r.kind)||!uuid.test(r.id)||!uuid.test(r.project_id))throw new BackendError(503,'Saved application work could not be read');
  return {kind:r.kind,id:r.id,projectId:r.project_id,projectName:r.project_name,label:labels[r.kind],state:r.state,expiresAt:r.expires_at};
 });
 return {rows,page,hasMore:results.length>20};
}
export function describeAppMaintenance(work:Awaited<ReturnType<typeof listAppMaintenance>>,project?:string){
 const states:Record<string,string>={changed:'App or visitor data changed; inspect before preparing a new review',failed:'A check failed; inspect the saved review',uncertain:'Check outcome unknown; do not rerun it with a new request',preparing:'Checks remain; open the review to continue',review:'Open the saved review to check whether it is still available'};
 return 'Unfinished app work — page '+work.page+'\n\n'+(work.rows.length?work.rows.map(r=>`${r.label} · ${JSON.stringify(r.projectName)}\n${states[r.state]}\nExpires: ${r.expiresAt}\nReview: ${r.id}`).join('\n\n'):'No unfinished app maintenance was found on this page.')+(work.hasMore?`\n\nAsk for page ${work.page+1} of unfinished app work${project?' for project '+project:''}.`:'')+'\n\nThis list covers app access, visitor pages, upgrades and data recovery. Completed, cancelled and expired reviews are omitted. Nothing was executed, retried, approved or published. Opening a review rechecks its current authority; appearing here does not make it safe to confirm. Ask to see the saved recovery points for an application.';
}

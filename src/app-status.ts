import {BackendError} from './backend-versions';
import {applicationURL} from './app-pages';
type AppStatus={projectId:string;name:string;configured:number;enabled:number;published:number;day:string;measuredAt:string;visitors:number;revoked:number;attempts:number;complete:number;failed:number;conflict:number;unresolved:number};
/** Aggregate operations only: never read visitor payloads, identities or credentials. */
export async function readAppStatus(db:D1Database,user:string,project:string){
 const row=await db.prepare(`SELECT p.id projectId,p.name,a.project_id IS NOT NULL configured,COALESCE(a.enabled,0) enabled,
 EXISTS(SELECT 1 FROM app_live_pages WHERE project_id=a.project_id) published,
 strftime('%Y-%m-%d','now') day,strftime('%Y-%m-%dT%H:%M:%fZ','now') measuredAt,
 (SELECT count(*) FROM app_visitors WHERE project_id=a.project_id AND revoked=0) visitors,
 (SELECT count(*) FROM app_visitors WHERE project_id=a.project_id AND revoked=1) revoked,
 COALESCE((SELECT attempts FROM app_daily_usage WHERE project_id=a.project_id AND day=strftime('%Y-%m-%d','now')),0) attempts,
 (SELECT count(*) FROM app_runs WHERE project_id=a.project_id AND day=strftime('%Y-%m-%d','now') AND state='complete') complete,
 (SELECT count(*) FROM app_runs WHERE project_id=a.project_id AND day=strftime('%Y-%m-%d','now') AND state='failed') failed,
 (SELECT count(*) FROM app_runs WHERE project_id=a.project_id AND day=strftime('%Y-%m-%d','now') AND state='conflict') conflict,
 (SELECT count(*) FROM app_runs WHERE project_id=a.project_id AND day=strftime('%Y-%m-%d','now') AND state='running') unresolved
 FROM projects p LEFT JOIN app_spaces a ON a.project_id=p.id AND a.owner_user_id=p.owner_user_id
 WHERE p.id=? AND p.owner_user_id=?`).bind(project,user).first<AppStatus>();
 if(!row)throw new BackendError(404,'Project not found');return row;
}
export function describeAppStatus(row:AppStatus){
 const availability=!row.configured?'No application configured yet.':!row.enabled?'Application data access is disabled.':row.published?'Visitor page is published. Invitations and passkeys are required.':'Application approved; visitor page is not published.';
 return `Application status: ${row.name}\n${availability}${row.published?'\nVisitor address: '+applicationURL(row.projectId):''}\nVisitors: ${row.visitors} active, ${row.revoked} revoked. These are registered accounts, not people currently online.\nToday (${row.day}, UTC): ${row.attempts}/100 project execution attempts used. This is the separate test-stage app allowance, not AI credits.\nRetained outcomes today: ${row.complete} completed, ${row.failed} failed, ${row.conflict} conflicted, ${row.unresolved} running or outcome unknown.\nDeleted visitor history is excluded from outcomes; its attempts still count. Other visitor/platform limits can apply.\n${row.unresolved?'Do not replay unknown work with a new request ID. Visitors can check the original receipt.\n':''}Measured: ${row.measuredAt}. This is a saved snapshot, not an uptime probe. No visitor data or credentials are included.\nAsk for a fresh application status or unfinished app reviews. Manage invitations in Dashboard → Visitor access.`;
}

/** Owner-scoped facts shared by existing Dashboard and registered view bindings. */
export async function readProjectStatuses(db:D1Database,user:string,projectId:string|null=null){
 return db.prepare('SELECT id,name,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY updated_at DESC LIMIT 20').bind(user,projectId,projectId).all<{id:string;name:string;status:'draft'|'building'|'live'|'error';site_live:number;backend_live:number;cms_articles:number}>();
}
export async function readWorkspaceActivity(db:D1Database,user:string,projectId:string|null=null){
 return db.prepare("SELECT a.id,a.project_id,a.summary,strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at) AS created_at FROM activity_events a WHERE a.user_id=? AND (? IS NULL OR a.project_id=?) AND (a.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=a.project_id AND p.owner_user_id=?)) ORDER BY a.created_at DESC,a.id DESC LIMIT 20").bind(user,projectId,projectId,user).all<{id:string;project_id:string|null;summary:string;created_at:string}>();
}
export async function readWorkspaceStorage(db:D1Database,user:string,projectId:string|null=null){
 return db.prepare("SELECT f.project_id,COUNT(*) AS files,SUM(f.size) AS bytes FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) AND f.status='ready' GROUP BY f.project_id").bind(user,projectId,projectId).all<{project_id:string;files:number;bytes:number}>();
}

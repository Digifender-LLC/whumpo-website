/** Best-effort aggregate HTML requests, never visitor identities or request metadata. */
export async function recordTraffic(db:D1Database,project:string,now=new Date()){
 await db.prepare('INSERT INTO site_traffic_daily(project_id,day,requests) SELECT id,?,1 FROM projects WHERE id=? ON CONFLICT(project_id,day) DO UPDATE SET requests=requests+1').bind(now.toISOString().slice(0,10),project).run();
}
export async function cleanupTraffic(db:D1Database){
 return db.prepare("DELETE FROM site_traffic_daily WHERE day<date('now','-29 days')").run();
}
export async function readTraffic(db:D1Database,user:string,projectId:string|null=null){
 const [metadata,rows]=await Promise.all([
  db.prepare('SELECT enabled_at FROM site_traffic_metadata WHERE id=1').first<{enabled_at:string}>(),
  db.prepare("SELECT t.project_id,t.day,t.requests FROM site_traffic_daily t JOIN projects p ON p.id=t.project_id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) AND t.day>=date('now','-29 days') AND t.day<=date('now') ORDER BY t.day,t.project_id").bind(user,projectId,projectId).all<{project_id:string;day:string;requests:number}>()
 ]);
 return {enabledAt:metadata?.enabled_at??null,days:30,rows:rows.results,metric:'successful_html_requests' as const};
}
export const trafficNotice='Successful public HTML GET requests only; includes repeat visits, bots and checks. Best-effort counts, not unique visitors or billing measurements. Images, APIs and controlled visitor apps are excluded. No visitor identifiers are stored. The window is the last 30 UTC dates including today; no history before collection began is available.';
export function trafficDescription(traffic:Awaited<ReturnType<typeof readTraffic>>){
 if(!traffic.enabledAt)return 'Traffic information is unavailable. No reliable count can be reported.';
 return `Recorded page requests: ${traffic.rows.reduce((sum,row)=>sum+row.requests,0)} over the last 30 UTC dates (including today).\nCollection enabled: ${traffic.enabledAt}. No earlier history is available.\n${trafficNotice}\n`+traffic.rows.map(row=>`${row.day} · project ${row.project_id}: ${row.requests}`).join('\n');
}

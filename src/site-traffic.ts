import {telemetryText,type TelemetryState,type TrafficTelemetry} from './site-diagnostics-shape';
export {telemetryText};
export type {TelemetryState,TrafficTelemetry};
/** Best-effort aggregate HTML requests, never visitor identities or request metadata (WH-037 budget below). */
// Measurement budget: one aggregate D1 upsert per successful public HTML GET, run after the response through waitUntil.
// At most MAX_IN_FLIGHT run per isolate; the rest are shed and later disclosed as missed measurements, never queued
// without bound and never awaited by the serving path. Each isolate remembers at most MAX_PENDING_GAPS shed/failed
// measurements and flushes at most FLUSH_PER_CALL of them after the next successful write.
export const MAX_IN_FLIGHT=32,MAX_PENDING_GAPS=128,FLUSH_PER_CALL=4,DELAYED_WINDOW_MS=2*3600000,RETENTION_DAYS=30;
let inFlight=0;const pendingGaps=new Map<string,number>();
/** Fixed, case-insensitive automation markers. A missing or unrecognized User-Agent is counted (and disclosed as possibly
 * automated): the header is classified in memory and never stored. Platform health checks identify as `whumpo-site-check`. */
export const automatedClient=/bot|crawl|spider|slurp|monitor|uptime|headless|lighthouse|pingdom|curl|wget|python-requests|go-http-client|facebookexternalhit|embedly|whumpo-site-check/i;
export const platformCheckAgent='whumpo-site-check/1';
export function trafficClass(request:Request):'counted'|'excluded'{
 const agent=(request.headers.get('user-agent')??'').slice(0,300);
 return automatedClient.test(agent)?'excluded':'counted';
}
const dayOf=(now:Date)=>now.toISOString().slice(0,10);
export async function recordTraffic(db:D1Database,project:string,now=new Date()){
 await db.prepare('INSERT INTO site_traffic_daily(project_id,day,requests) SELECT id,?,1 FROM projects WHERE id=? ON CONFLICT(project_id,day) DO UPDATE SET requests=requests+1').bind(dayOf(now),project).run();
}
async function recordQuality(db:D1Database,project:string,day:string,excluded:number,missed:number,now:Date){
 await db.prepare('INSERT INTO site_traffic_quality(project_id,day,excluded_requests,missed_measurements,updated_at) SELECT id,?,?,?,? FROM projects WHERE id=? ON CONFLICT(project_id,day) DO UPDATE SET excluded_requests=excluded_requests+excluded.excluded_requests,missed_measurements=missed_measurements+excluded.missed_measurements,updated_at=excluded.updated_at').bind(day,excluded,missed,now.toISOString(),project).run();
}
function remember(project:string,day:string,count=1){
 const key=project+'|'+day;
 if(pendingGaps.has(key)||pendingGaps.size<MAX_PENDING_GAPS)pendingGaps.set(key,(pendingGaps.get(key)??0)+count);
}
async function flushGaps(db:D1Database,now:Date){
 for(const [key,count] of [...pendingGaps].slice(0,FLUSH_PER_CALL)){
  const [project,day]=key.split('|');pendingGaps.delete(key);
  try{await recordQuality(db,project,day,0,count,now);}catch{remember(project,day,count);return;}
 }
}
/** Never throws and never blocks the response. Counted requests, excluded automation and failures are all aggregate only. */
export async function measureTraffic(db:D1Database,project:string,kind:'counted'|'excluded',now=new Date()){
 const day=dayOf(now);
 if(inFlight>=MAX_IN_FLIGHT){remember(project,day);return;}
 inFlight++;
 try{
  if(kind==='counted')await recordTraffic(db,project,now);else await recordQuality(db,project,day,1,0,now);
  await flushGaps(db,now);
 }catch{
  remember(project,day);console.warn('site.traffic.unavailable');
 }finally{inFlight--;}
}
/** Test-only view of the bounded in-memory backlog. */
export const pendingMeasurementGaps=()=>[...pendingGaps.values()].reduce((a,b)=>a+b,0);
/** Held projects keep older daily counts (WH-132); readers only ever show the 30-day window, so retention is not visible. */
export async function cleanupTraffic(db:D1Database){
 const result=await db.prepare("DELETE FROM site_traffic_daily WHERE day<date('now','-29 days') AND project_id NOT IN (SELECT project_id FROM safety_held_projects)").run();
 await db.prepare("DELETE FROM site_traffic_quality WHERE day<date('now','-29 days') AND project_id NOT IN (SELECT project_id FROM safety_held_projects)").run();
 return result;
}
export function telemetryState(input:{enabledAt:string|null;published:boolean;missed:number;lastGapAt:string|null;windowStart:string;now:Date}):TelemetryState{
 if(!input.enabledAt)return 'unavailable';
 if(!input.published)return 'not_published';
 if(input.missed>0)return input.lastGapAt&&Date.parse(input.lastGapAt)>input.now.getTime()-DELAYED_WINDOW_MS?'delayed':'gaps';
 return input.enabledAt.slice(0,10)>input.windowStart?'partial':'complete';
}
/** Owner-scoped. `now` is injectable so late/missing-data states are testable without sleeping. */
export async function readTraffic(db:D1Database,user:string,projectId:string|null=null,now=new Date()){
 const end=dayOf(now),start=dayOf(new Date(now.getTime()-29*86400000));
 const [metadata,rows,owned,quality]=await Promise.all([
  db.prepare('SELECT enabled_at FROM site_traffic_metadata WHERE id=1').first<{enabled_at:string}>(),
  db.prepare("SELECT t.project_id,t.day,t.requests FROM site_traffic_daily t JOIN projects p ON p.id=t.project_id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) AND t.day>=? AND t.day<=? ORDER BY t.day,t.project_id").bind(user,projectId,projectId,start,end).all<{project_id:string;day:string;requests:number}>(),
  db.prepare('SELECT p.id,s.version_id IS NOT NULL AS published FROM projects p LEFT JOIN publications s ON s.project_id=p.id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) ORDER BY p.created_at DESC,p.id LIMIT 20').bind(user,projectId,projectId).all<{id:string;published:number}>(),
  db.prepare('SELECT q.project_id,SUM(q.excluded_requests) AS excluded,SUM(q.missed_measurements) AS missed,MAX(CASE WHEN q.missed_measurements>0 THEN q.updated_at END) AS last_gap FROM site_traffic_quality q JOIN projects p ON p.id=q.project_id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) AND q.day>=? AND q.day<=? GROUP BY q.project_id').bind(user,projectId,projectId,start,end).all<{project_id:string;excluded:number;missed:number;last_gap:string|null}>()
 ]);
 const enabledAt=metadata?.enabled_at??null,byProject=new Map(quality.results.map(q=>[q.project_id,q]));
 const telemetry:TrafficTelemetry={windowStart:start,windowEnd:end,coveredFrom:enabledAt?(enabledAt.slice(0,10)>start?enabledAt.slice(0,10):start):null,retentionDays:RETENTION_DAYS,currentDayPartial:true,
  projects:owned.results.map(p=>{const q=byProject.get(p.id),missed=q?.missed??0,lastGapAt=q?.last_gap??null;return {projectId:p.id,state:telemetryState({enabledAt,published:p.published===1,missed,lastGapAt,windowStart:start,now}),excludedRequests:q?.excluded??0,missedMeasurements:missed,lastGapAt};})};
 return {enabledAt,days:30 as const,rows:rows.results,metric:'successful_html_requests' as const,telemetry};
}
export const trafficNotice='Successful public HTML GET requests only. Known automated clients and platform checks are excluded and shown separately; other bots, repeat visits and unrecognized checks may still be included. Best-effort counts, not unique visitors or billing measurements. Counting runs after the page is sent, so a count can be late or missing; missed measurements are disclosed, and today is always partial. Images, APIs, errors and controlled visitor apps are excluded. No visitor identifiers are stored. The window is the last 30 UTC dates including today, with 30-day retention; no history before collection began is available.';
export function trafficDescription(traffic:Awaited<ReturnType<typeof readTraffic>>){
 if(!traffic.enabledAt)return 'Traffic information is unavailable. No reliable count can be reported.';
 return `Recorded page requests: ${traffic.rows.reduce((sum,row)=>sum+row.requests,0)} over the last 30 UTC dates (including today).\nCollection enabled: ${traffic.enabledAt}. No earlier history is available.\n${trafficNotice}\n`+traffic.telemetry.projects.map(p=>`Measurement for project ${p.projectId}: ${p.state.replace('_',' ')}. ${telemetryText[p.state]} Excluded automated requests: ${p.excludedRequests}. Missed measurements: ${p.missedMeasurements}.`).join('\n')+'\n'+traffic.rows.map(row=>`${row.day} · project ${row.project_id}: ${row.requests}`).join('\n');
}

import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {maintenanceJobs} from '../src/maintenance.ts';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

import {backlogInventory,operationInventory,platformCounterInventory,counterThresholds} from './maintenance-inventory.mjs';
import {reviewFamilies,eligibleSql} from '../src/review-turnover.generated.ts';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
/** WH-050 F8: each shared platform counter against its ceiling, flagged at 50% (warn) and 80% (act). Pull-based; no alert is delivered. */
export async function counterReport(db,now=Date.now()){
 if(!integer(now))throw Error('Invalid observation time');
 const counters=await Promise.all(Object.entries(platformCounterInventory).map(async([counter,{sql,ceiling,window,enforcedBy,note}])=>{
  try{
   const row=await db.prepare(sql.replaceAll('?1','?')).bind(...Array(sql.split('?1').length-1).fill(new Date(now).toISOString())).first();
   if(!row||!integer(row.used))throw Error('Invalid counter');
   const ratio=row.used/ceiling;
   return {counter,state:ratio>=1?'exhausted':ratio>=counterThresholds.act?'act':ratio>=counterThresholds.warn?'warn':'normal',used:row.used,ceiling,percent:Math.floor(ratio*1000)/10,window,enforcedBy,...(note?{note}:{})};
  }catch{return {counter,state:'unavailable',ceiling,window,enforcedBy};}
 }));
 return {observedAt:new Date(now).toISOString(),thresholds:{warnPercent:counterThresholds.warn*100,actPercent:counterThresholds.act*100},counters,
  attention:counters.some(c=>['act','exhausted','unavailable'].includes(c.state)),
  scope:'Operator-only read of platform totals; no project, account or visitor identifiers. Nothing is delivered: run on the owner-set cadence (runbook G1). Ceilings are local schema limits, not Cloudflare limits or spend.'};
}
/** WH-182: per review family, the rows waiting to be sealed (the schema guard would let them leave) and the sealed receipts held for retry replay. Counts only; no identifiers or payloads. */
export async function reviewReport(db,now=Date.now()){
 if(!integer(now))throw Error('Invalid observation time');
 const families=await Promise.all(Object.entries(reviewFamilies).map(async([family,f])=>{
  try{
   const due=f.unix?"strftime('%Y-%m-%dT%H:%M:%fZ',r.expires_at,'unixepoch')":'r.expires_at';
   const waiting=await db.prepare(`SELECT COUNT(*) AS count,MIN(${due}) AS oldest FROM ${f.table} r WHERE ${eligibleSql(f)}`).first(),sealed=await db.prepare('SELECT COUNT(*) AS count FROM review_receipts WHERE family=?').bind(family).first();
   if(!waiting||!integer(waiting.count)||!sealed||!integer(sealed.count)||(waiting.count>0&&(typeof waiting.oldest!=='string'||!Number.isFinite(Date.parse(waiting.oldest)))))throw Error('Invalid review counts');
   const age=waiting.count?Math.max(0,now-Date.parse(waiting.oldest)):null;
   return {family,state:waiting.count===0?'current':age>=25*3600000?'attention':'pending',waiting:waiting.count,oldestWaitingAgeMs:age,sealedReceipts:sealed.count};
  }catch{return {family,state:'unavailable'};}
 }));
 return {observedAt:new Date(now).toISOString(),families,attention:families.some(f=>['attention','unavailable'].includes(f.state)),scope:'Operator-only counts of review rows awaiting sealed turnover and of sealed receipts; no identifiers, payloads or customer content.'};
}
export async function maintenanceReport(db,now=Date.now()){
 if(!integer(now))throw Error('Invalid observation time');
 const jobs=await Promise.all(Object.entries(maintenanceJobs).map(async([job,interval])=>{
  try{
   const row=await db.prepare('SELECT started_at,finished_at,last_success_at,duration_ms,status,failure_category FROM maintenance_health WHERE job=?').bind(job).first();
   if(!row)return {job,state:'unobserved'};
   if(!integer(row.started_at)||row.started_at>now||![row.finished_at,row.last_success_at,row.duration_ms].every(v=>v===null||integer(v))||!['running','completed','failed','skipped'].includes(row.status))throw Error('Invalid telemetry');
   const overdue=now-row.started_at>interval+3600000;
   const stalled=row.status==='running'&&now-row.started_at>900000;
   return {job,state:stalled?'stalled':overdue?'overdue':row.status,startedAt:row.started_at,finishedAt:row.finished_at,lastSuccessAt:row.last_success_at,durationMs:row.duration_ms,failureCategory:row.status==='failed'?'job_failed':null};
  }catch{return {job,state:'unavailable'};}
 }));
 const backlogs=await Promise.all(Object.entries(backlogInventory).map(async([queue,{sql,threshold}])=>{
  try{
   const query=sql.replaceAll('?1','(SELECT instant FROM observation)');
   const row=await db.prepare(`WITH observation AS (SELECT ? AS instant) SELECT COUNT(*) AS count,MIN(due_at) AS oldest,COUNT(*)-COUNT(due_at) AS unknown_age FROM (${query})`).bind(new Date(now).toISOString()).first();
   if(!row||!integer(row.count)||!integer(row.unknown_age)||row.unknown_age>row.count||(row.count>row.unknown_age&&(typeof row.oldest!=='string'||!Number.isFinite(Date.parse(row.oldest)))))throw Error('Invalid backlog');
   const age=row.oldest===null?null:Math.max(0,now-Date.parse(row.oldest));
   return {queue,state:row.count===0?'empty':row.unknown_age>0||age>=threshold?'attention':'pending',count:row.count,oldestAgeMs:age,unknownAgeCount:row.unknown_age};
  }catch{return {queue,state:'unavailable'};}
 }));
 // Identifiers only, bounded, and never an authorization to retry a provider.
 const operations=await Promise.all(Object.entries(operationInventory).map(async([kind,{table,state,states,time,guide}])=>{
  try{
   const predicate=states.map(s=>"'"+s+"'").join(',');
   const {results}=await db.prepare(`SELECT id,${state} AS state,${time} AS observed_at FROM ${table} WHERE ${state} IN (${predicate}) ORDER BY ${time},id LIMIT 100`).all();
   if(!Array.isArray(results)||results.some(r=>typeof r.id!=='string'||!/^[0-9a-f-]{36}$/.test(r.id)||!states.includes(r.state)||(r.observed_at!==null&&(typeof r.observed_at!=='string'||!Number.isFinite(Date.parse(r.observed_at))))))throw Error('Invalid operations');
   return {kind,state:'available',limit:100,items:results.map(r=>({id:r.id,state:r.state,observedAt:r.observed_at})),timeBasis:time,recoveryGuide:guide};
  }catch{return {kind,state:'unavailable'};}
 }));
 const capacity=await counterReport(db,now),reviews=await reviewReport(db,now);
 return {observedAt:new Date(now).toISOString(),jobs,backlogs,operations,counters:capacity.counters,reviews:reviews.families,attention:reviews.attention||jobs.some(j=>!['completed','skipped','running'].includes(j.state))||backlogs.some(q=>['attention','unavailable'].includes(q.state))||operations.some(o=>o.state==='unavailable')||capacity.attention,scope:'Operator-only read; completion is a scheduler pass, not proof every item succeeded. No repairs, billing changes or provider dispatch.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const counters=process.argv[2]==='--counters';
  if(process.argv.length!==2&&!(counters&&process.argv.length===3))throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials),db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  const report=counters?await counterReport(db):await maintenanceReport(db);console.log(JSON.stringify(report,null,2));if(report.attention)process.exitCode=2;
 }catch{console.error('Maintenance report unavailable. Check operator authorization, configuration and the current schema. No settings changed.');process.exitCode=1;}
}

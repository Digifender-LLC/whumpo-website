import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {maintenanceJobs} from '../src/maintenance.ts';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

import {backlogInventory,operationInventory} from './maintenance-inventory.mjs';

const integer=n=>Number.isSafeInteger(n)&&n>=0;
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
 return {observedAt:new Date(now).toISOString(),jobs,backlogs,operations,attention:jobs.some(j=>!['completed','skipped','running'].includes(j.state))||backlogs.some(q=>['attention','unavailable'].includes(q.state))||operations.some(o=>o.state==='unavailable'),scope:'Operator-only read; completion is a scheduler pass, not proof every item succeeded. No repairs, billing changes or provider dispatch.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials),db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  const report=await maintenanceReport(db);console.log(JSON.stringify(report,null,2));if(report.attention)process.exitCode=2;
 }catch{console.error('Maintenance report unavailable. Check operator authorization, configuration and the current schema. No settings changed.');process.exitCode=1;}
}

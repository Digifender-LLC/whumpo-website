import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
const bundle=await build({entryPoints:['src/index.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');let failTraffic=true;
const db={prepare:q=>{
 const bound=p=>({
  run:async()=>{if(failTraffic&&q.startsWith('DELETE FROM site_traffic_daily'))throw Error('PRIVATE_SCHEDULER_CANARY');const r=sql.prepare(q).run(...p);return {success:true,meta:{changes:r.changes}};},
  first:async()=>sql.prepare(q).get(...p)??null,
  all:async()=>({results:sql.prepare(q).all(...p)}),
 });return {...bound([]),bind:(...p)=>bound(p)};
},batch:async statements=>Promise.all(statements.map(s=>s.run()))};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>assert.fail('Unconfigured empty fixture must not access a provider');
try{
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')).sort())sql.exec(await readFile('migrations/'+name,'utf8'));
 let listCalls=0;
 const env={DB:db,FILES:{list:async()=>{listCalls++;return {objects:[]};},delete:async()=>assert.fail('Empty photo fixture must not delete')}};
 await assert.rejects(worker.scheduled({cron:'17 3 * * *'},env),/Scheduled maintenance or telemetry failed/);
 let report=await maintenanceReport(db);
 assert.equal(report.jobs.find(j=>j.job==='traffic').state,'failed');
 for(const name of ['imports','fair_use','applications','contacts','photos'])assert.equal(report.jobs.find(j=>j.job===name).state,'completed',name);
 for(const name of ['github','cloudflare'])assert.equal(report.jobs.find(j=>j.job===name).state,'skipped',name);
 assert.equal(listCalls,1);assert.ok(!JSON.stringify(report).includes('PRIVATE_SCHEDULER_CANARY'));
 failTraffic=false;await worker.scheduled({cron:'17 3 * * *'},env);
 await worker.scheduled({cron:'47 * * * *'},env);
 report=await maintenanceReport(db);
 assert.equal(report.jobs.find(j=>j.job==='traffic').state,'completed');
 assert.equal(report.jobs.find(j=>j.job==='health').state,'completed');
 assert.equal(report.jobs.find(j=>j.job==='hosting').state,'skipped');
 assert.equal(report.attention,false);assert.equal(listCalls,2);
 console.log('Actual scheduled handler passed: isolated failing daily job, other jobs complete, missing providers skipped, subsequent recovery, hourly dispatch and healthy empty-fixture report; no external fetches.');
}finally{globalThis.fetch=originalFetch;sql.close();}

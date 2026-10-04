import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {currentSchema} from '../tools/current-schema.mjs';
import {runMaintenance,maintenanceJobs} from '../src/maintenance.ts';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
const sql=new DatabaseSync(':memory:');
const prepare=q=>{
 const bound=p=>({run:async()=>sql.prepare(q).run(...p),first:async()=>sql.prepare(q).get(...p)??null,all:async()=>({results:sql.prepare(q).all(...p)})});
 return {...bound([]),bind:(...p)=>bound(p)};
};
const db={prepare};
try{
 sql.exec(await currentSchema());
 const now=Date.now(),clock=()=>now;let calls=0;
 await assert.rejects(runMaintenance(db,[{name:'imports',run:async()=>{throw Error('PRIVATE_SECRET_CANARY');}},{name:'traffic',run:async()=>{calls++;}},{name:'github',enabled:false,run:async()=>assert.fail('disabled job ran')}],clock),/Scheduled maintenance or telemetry failed/);
 assert.equal(calls,1);
 let report=await maintenanceReport(db,now);
 assert.equal(report.jobs.find(j=>j.job==='imports').state,'failed');
 assert.equal(report.jobs.find(j=>j.job==='traffic').state,'completed');
 assert.equal(report.jobs.find(j=>j.job==='github').state,'skipped');
 assert.ok(report.backlogs.every(q=>q.state==='empty'),JSON.stringify(report.backlogs));
 assert.ok(!JSON.stringify(report).includes('PRIVATE_SECRET_CANARY'));
 assert.equal(report.attention,true);assert.equal(report.jobs.length,Object.keys(maintenanceJobs).length);
 await runMaintenance(db,[{name:'imports',run:async()=>{}}],clock);
 assert.equal((await maintenanceReport(db,now)).jobs.find(j=>j.job==='imports').lastSuccessAt,now);
 // Out-of-order overlapping runs preserve newest status and independent success.
 let finish,started;const entered=new Promise(r=>started=r),waiting=new Promise(r=>finish=r);
 const old=runMaintenance(db,[{name:'imports',run:async()=>{started();await waiting;}}],()=>now+1);
 await entered;
 await assert.rejects(runMaintenance(db,[{name:'imports',run:async()=>{throw Error('PRIVATE_SECRET_CANARY');}}],()=>now+2));
 finish();await old;
 report=await maintenanceReport(db,now+3);
 const row=report.jobs.find(j=>j.job==='imports');assert.equal(row.state,'failed');assert.equal(row.startedAt,now+2);assert.equal(row.lastSuccessAt,now+1);
 // Missing telemetry must neither prevent cleanup nor produce a healthy report.
 await assert.rejects(runMaintenance({prepare:()=>{throw Error('PRIVATE_SECRET_CANARY');}},[{name:'contacts',run:async()=>{calls++;}}],clock));assert.equal(calls,2);
 const unavailable=await maintenanceReport({prepare:()=>{throw Error('PRIVATE_SECRET_CANARY');}},now);
 assert.ok(unavailable.jobs.every(j=>j.state==='unavailable'));assert.equal(unavailable.attention,true);assert.ok(!JSON.stringify(unavailable).includes('PRIVATE_SECRET_CANARY'));
 const user=crypto.randomUUID(),op=crypto.randomUUID(),date=new Date(now-1800000).toISOString();
 sql.prepare("INSERT INTO users VALUES(?,?,?)").run(user,'private@example.invalid',date);
 sql.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)").run(op,user,'a'.repeat(64),date,date);
 sql.prepare("INSERT INTO file_cleanup(object_key,created_at) VALUES('PRIVATE_OBJECT_KEY_CANARY',?)").run(new Date(now-91000000).toISOString());
 sql.prepare("UPDATE maintenance_health SET status='running',started_at=?,finished_at=NULL WHERE job='traffic'").run(now-1000000);
 assert.equal((await maintenanceReport(db,now)).jobs.find(j=>j.job==='traffic').state,'stalled');
 sql.prepare("UPDATE maintenance_health SET status='completed' WHERE job='traffic'").run();
 sql.exec('PRAGMA query_only=ON');
 report=await maintenanceReport(db,now);
 assert.equal(report.backlogs.find(q=>q.queue==='standard_ai').state,'attention');
 assert.equal(report.backlogs.find(q=>q.queue==='photos').state,'attention');
 assert.equal(report.operations.find(o=>o.kind==='standard_ai').items[0].id,op);
 assert.ok(!JSON.stringify(report).includes('private@example.invalid'));assert.ok(!JSON.stringify(report).includes('PRIVATE_OBJECT_KEY_CANARY'));
 assert.equal((await maintenanceReport(db,now+2*86400000)).jobs.find(j=>j.job==='traffic').state,'overdue');
 console.log('Maintenance passed: independent failures/skips, overlapping runs, last completion, missing telemetry, read-only backlog age/receipt IDs and private-data exclusion.');
}finally{sql.close();}

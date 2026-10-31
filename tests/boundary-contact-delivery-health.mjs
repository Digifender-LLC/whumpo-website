// WH-004 observation R8 (in-memory SQLite, synthetic binding; no network or email).
// The every-minute dispatch is a runMaintenance job named `job_dispatch`: a healthy run and a failed run each leave a
// maintenance_health row (its own row, never the daily `jobs` prune row), and a failure escapes scheduled() only as the
// sanitized scheduler error, never the raw storage text. Lane isolation stays in dispatchJobs.
// Deliberately not in package.json scripts or any tools/verify.mjs profile.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const binding={send:async()=>{throw Error('No email is sent by this characterization');}};
const env={DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'issue-146',CONTACT_EMAIL:binding};
const health=async()=>(await db.prepare('SELECT job,status FROM maintenance_health ORDER BY job').all()).results.map(r=>({...r}));
try{
 await m.worker.scheduled({cron:'* * * * *'},env);
 assert.deepEqual(await health(),[{job:'job_dispatch',status:'completed'}],'a healthy minute writes its own row');
 await db.prepare("INSERT INTO maintenance_health(job,run_id,started_at,status) VALUES('jobs','stuck',1,'failed')").run();
 await m.worker.scheduled({cron:'* * * * *'},env);
 assert.equal((await db.prepare("SELECT status FROM maintenance_health WHERE job='jobs'").first()).status,'failed','a healthy minute does not touch the daily prune row');
 // A storage failure inside the lanes is recorded as a sanitized failure; the raw text neither escapes nor is stored.
 let broken=false;
 const proxy=new Proxy(db,{get(target,key){if(broken&&key==='prepare'){return sql=>{if(/maintenance_health/.test(sql))return target.prepare(sql);throw Error('PRIVATE_DELIVERY_CANARY storage failure');};}const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 broken=true;
 await assert.rejects(m.worker.scheduled({cron:'* * * * *'},{...env,DB:proxy}),e=>e.message==='Scheduled maintenance or telemetry failed'&&!/PRIVATE_DELIVERY_CANARY/.test(String(e.stack)));
 assert.deepEqual({...await db.prepare("SELECT status,failure_category FROM maintenance_health WHERE job='job_dispatch'").first()},{status:'failed',failure_category:'job_failed'});
 assert.ok(!JSON.stringify((await db.prepare('SELECT * FROM maintenance_health').all()).results).includes('PRIVATE_DELIVERY_CANARY'));
 console.log('Contact delivery health: the every-minute dispatch records job_dispatch health, fails sanitized, and leaves the jobs row alone (R8).');
}finally{await store.close?.();}

// WH-004 observation R8 characterization (in-memory SQLite, synthetic binding; no network or email).
// The every-minute contact-notice drain runs outside runMaintenance(): it writes no maintenance_health row, and a
// failure escapes scheduled() instead of being recorded as a sanitized job failure. Daily jobs, by contrast, record
// a failed status and keep running their siblings. This passes while the behavior is as documented here; the
// mitigation is the outbox backlog monitored by tools/report-maintenance.mjs (contact_notification_queue).
// Not a reproduced defect; deliberately not in package.json scripts or any tools/verify.mjs profile.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const binding={send:async()=>{throw Error('No email is sent by this characterization');}};
const env={DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'issue-146',CONTACT_EMAIL:binding};
const health=async()=>(await db.prepare('SELECT job,status FROM maintenance_health ORDER BY job').all()).results;
try{
 // A healthy drain with nothing queued leaves no operational trace.
 await m.worker.scheduled({cron:'* * * * *'},env);
 assert.deepEqual(await health(),[],'the every-minute drain records no maintenance health');
 // A storage failure inside the drain escapes scheduled() raw and still leaves no health record.
 const broken=new Proxy(db,{get(target,key){if(key==='prepare'||key==='batch')return()=>{throw Error('PRIVATE_DELIVERY_CANARY storage failure');};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 await assert.rejects(m.worker.scheduled({cron:'* * * * *'},{...env,DB:broken}),/PRIVATE_DELIVERY_CANARY/);
 assert.deepEqual(await health(),[]);
 console.log('Contact delivery characterization: the every-minute drain writes no maintenance_health row and a drain failure escapes scheduled() with its raw error (R8; mitigated by outbox backlog monitoring).');
}finally{await store.close?.();}

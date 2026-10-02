import assert from 'node:assert/strict';
import {sqliteD1} from './sqlite-d1.mjs';
import {interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
const {worker}=await currentSiteFixtureHandlers(),fixture=await sqliteD1(),{sql}=fixture;let failTraffic=true;
const db=interceptDatabase(fixture.db,/^DELETE FROM site_traffic_daily/,async()=>{if(failTraffic)throw Error('PRIVATE_SCHEDULER_CANARY');});
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>assert.fail('Unconfigured empty fixture must not access a provider');
try{
 const ready=crypto.randomUUID(),enrolling=crypto.randomUUID(),attempt=crypto.randomUUID(),expired=crypto.randomUUID(),current=crypto.randomUUID(),grant=crypto.randomUUID();
 sql.prepare("INSERT INTO users VALUES(?,?,'2026-10-01'),(?,?,'2026-10-01')").run(ready,'ready@example.invalid',enrolling,'enrolling@example.invalid');
 sql.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)").run(ready,'a'.repeat(64),crypto.randomUUID());
 sql.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id) VALUES(?,1,'enrolling',1,?)").run(enrolling,attempt);
 sql.prepare("INSERT INTO identity_attempts VALUES(?,?,'enrollment','open',0,1,0,unixepoch()-7200)").run(attempt,enrolling);
 sql.prepare("INSERT INTO identity_credentials VALUES('ready-key',?,X'010203',0,'Ready key','active',NULL,unixepoch()-7200,NULL),('pending-key',?,X'010203',0,'Pending key','staged',?,unixepoch()-7200,NULL)").run(ready,enrolling,attempt);
 sql.prepare("INSERT INTO identity_sessions VALUES(?,?,?,1,1,'web','ready-key','passkey',unixepoch()-7200,unixepoch()-7200,unixepoch()-1),(?,?,?,1,1,'web','ready-key','passkey',unixepoch(),unixepoch(),unixepoch()+3600)").run(expired,'b'.repeat(64),ready,current,'c'.repeat(64),ready);
 sql.prepare("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','enrollment',?,'registration',unixepoch()-3600,0,'pending-key',NULL,unixepoch()-3600,unixepoch()-1800)").run(grant,'d'.repeat(64),enrolling,attempt);

 let listCalls=0;
 const env={DB:db,FILES:{list:async()=>{listCalls++;return {objects:[]};},delete:async()=>assert.fail('Empty photo fixture must not delete')}};
 await assert.rejects(worker.scheduled({cron:'17 3 * * *'},env),/Scheduled maintenance or telemetry failed/);
 // The actual scheduler expires authorities, while verified unfinished setup survives.
 assert.equal(sql.prepare('SELECT count(*) n FROM identity_sessions WHERE id=?').get(expired).n,0);
 assert.equal(sql.prepare('SELECT count(*) n FROM identity_sessions WHERE id=?').get(current).n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM identity_grants WHERE id=?').get(grant).n,0);
 assert.equal(sql.prepare('SELECT status FROM identity_attempts WHERE id=?').get(attempt).status,'open');
 assert.equal(sql.prepare("SELECT status FROM identity_credentials WHERE id='pending-key'").get().status,'staged');
 let report=await maintenanceReport(db);
 assert.equal(report.jobs.find(j=>j.job==='traffic').state,'failed');
 for(const name of ['identity','imports','fair_use','applications','contacts','photos'])assert.equal(report.jobs.find(j=>j.job===name).state,'completed',name);
 for(const name of ['github','cloudflare'])assert.equal(report.jobs.find(j=>j.job===name).state,'skipped',name);
 assert.equal(listCalls,1);assert.ok(!JSON.stringify(report).includes('PRIVATE_SCHEDULER_CANARY'));
 failTraffic=false;await worker.scheduled({cron:'17 3 * * *'},env);
 await worker.scheduled({cron:'47 * * * *'},env);
 report=await maintenanceReport(db);
 assert.equal(report.jobs.find(j=>j.job==='traffic').state,'completed');
 assert.equal(report.jobs.find(j=>j.job==='health').state,'completed');
 assert.equal(report.jobs.find(j=>j.job==='hosting').state,'skipped');
 assert.equal(report.attention,false);assert.equal(listCalls,2);
 const late=await maintenanceReport(db,Date.now()+2.5*3600000);
 assert.equal(late.jobs.find(j=>j.job==='identity').state,'overdue','Identity cleanup is scheduled hourly');
 assert.equal(late.jobs.find(j=>j.job==='traffic').state,'completed','Daily jobs have their own deadline');
 console.log('Actual scheduled handler passed: current identity expiry and retained enrollment, isolated failing daily job, other jobs complete, missing providers skipped, subsequent recovery, hourly dispatch and healthy empty-fixture report; no external fetches.');
}finally{globalThis.fetch=originalFetch;await fixture.close();}

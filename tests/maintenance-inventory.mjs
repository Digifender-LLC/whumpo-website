import {sqliteD1} from './sqlite-d1.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import assert from 'node:assert/strict';
import {maintenanceReport,counterReport} from '../tools/report-maintenance.mjs';
import {platformCounterInventory} from '../tools/maintenance-inventory.mjs';
const keyFixture=await sqliteD1(),sql=keyFixture.sql,id=()=>crypto.randomUUID();
const db={prepare:q=>{const bound=p=>({first:async()=>sql.prepare(q).get(...p)??null,all:async()=>({results:sql.prepare(q).all(...p)})});return {...bound([]),bind:(...p)=>bound(p)};}};
try{
 await initializeFixtureKeys(keyFixture.db);
 const owner=id(),project=id(),now=Date.now(),at=offset=>new Date(now+offset).toISOString(),day=86400000;
 sql.prepare("INSERT INTO users VALUES(?,?,?)").run(owner,'PRIVATE_EMAIL_CANARY@example.invalid',at(0));
 sql.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(project,owner,'PRIVATE_NAME_CANARY',at(0),at(0));
 const oldGH=id(),oldCF=id(),newGH=id(),newCF=id();
 const ciphers=new Map();for(const token of [oldGH,oldCF,newGH,newCF])ciphers.set(token,await fixtureCiphertext(fixtureKeyring(),`whumpo:${[oldGH,newGH].includes(token)?'github':'cloudflare'}:token:${owner}:${token}`,'PRIVATE_CREDENTIAL_CANARY'));
 const github=(token,state)=>sql.prepare('INSERT INTO github_token_vault VALUES(?,?,?,?,?)').run(token,owner,ciphers.get(token),at(day),state);
 const cloudflare=(token,state)=>sql.prepare('INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,?)').run(token,owner,ciphers.get(token),at(day),at(-10*day),state);
 github(oldGH,'revoking');cloudflare(oldCF,'revoking');
 // Direct revocation admission timestamps new work without historical backfills.
 for(const [provider,token] of [['github',oldGH],['cloudflare',oldCF]])assert.ok(Date.parse(sql.prepare(`SELECT requested_at FROM ${provider}_revocation_health WHERE token_id=?`).get(token).requested_at)>=now);
 // Missing/unknown telemetry is a diagnostic failure, never invented success.
 sql.prepare('DELETE FROM github_revocation_health WHERE token_id=?').run(oldGH);
 sql.prepare('UPDATE cloudflare_revocation_health SET requested_at=NULL WHERE token_id=?').run(oldCF);
 assert.equal(sql.prepare('SELECT requested_at FROM github_revocation_health WHERE token_id=?').get(oldGH),undefined);
 assert.equal(sql.prepare('SELECT requested_at FROM cloudflare_revocation_health WHERE token_id=?').get(oldCF).requested_at,null);
 github(newGH,'active');cloudflare(newCF,'active');
 for(const [provider,token] of [['github',newGH],['cloudflare',newCF]]){
  sql.prepare(`UPDATE ${provider}_token_vault SET state='revoking' WHERE id=?`).run(token);
  const first=sql.prepare(`SELECT requested_at FROM ${provider}_revocation_health WHERE token_id=?`).get(token).requested_at;
  assert.ok(Date.parse(first)>=now);
  sql.prepare(`UPDATE ${provider}_token_vault SET state='revoking' WHERE id=?`).run(token);
  assert.equal(sql.prepare(`SELECT requested_at FROM ${provider}_revocation_health WHERE token_id=?`).get(token).requested_at,first);
 }
 let report=await maintenanceReport(db,Date.now());
 for(const queue of ['github','cloudflare']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.count,2);assert.equal(backlog.unknownAgeCount,1);assert.equal(backlog.state,'attention');}
 for(const [provider,token] of [['github',oldGH],['cloudflare',oldCF]]){
  sql.prepare(`DELETE FROM ${provider}_token_vault WHERE id=?`).run(token);
  assert.equal(sql.prepare(`SELECT count(*) n FROM ${provider}_revocation_health WHERE token_id=?`).get(token).n,0);
 }
 // Retention age starts when eligible for deletion, not at the original write.
 sql.prepare('INSERT INTO contact_receipts VALUES(?,?,?,?,?)').run(id(),project,'PRIVATE_HASH_CANARY',at(-5*day),at(-2*day));
 sql.prepare('INSERT INTO contact_receipts VALUES(?,?,?,?,?)').run(id(),project,'PRIVATE_HASH_CANARY',at(-day),at(day));
 const destination=id();sql.prepare("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,'owner@example.invalid',?)").run(destination,owner,project,at(-5*day));
 sql.prepare("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) VALUES(?,?,?,?,'verification','verify:PRIVATE_CANARY','fixture','review-1',?,?,?)").run(id(),owner,project,destination,at(-32*day),at(-2*day),at(-2*day));
 sql.prepare('INSERT INTO site_traffic_daily VALUES(?,?,?)').run(project,at(-32*day).slice(0,10),1);
 sql.prepare('INSERT INTO site_traffic_daily VALUES(?,?,?)').run(project,at(-2*day).slice(0,10),1);
 sql.prepare('INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at,removed_at) VALUES(?,?,?,?)').run(id(),owner,at(-100*day),at(-93*day));
 sql.prepare('INSERT INTO site_health_budget VALUES(?,?)').run(at(-65*day).slice(0,10),1);
 const stage=id();ciphers.set(stage,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${owner}:${stage}`,'PRIVATE_CREDENTIAL_CANARY'));github(stage,'active');sql.prepare('INSERT INTO github_token_staging VALUES(?,?,?)').run(stage,'PRIVATE_STATE_CANARY',at(-2*day));
 sql.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state,created_at) VALUES(?,?,'github','fixture','PRIVATE_STATE','fixture-current',1,'dispatched',?)").run(newGH,owner,at(-2*day));
 sql.prepare('INSERT INTO github_refresh_custody(token_id,user_id,client_id,ciphertext,expires_at) VALUES(?,?,?,?,?)').run(newGH,owner,'fixture',await fixtureCiphertext(fixtureKeyring(),`whumpo:github:refresh:${owner}:${newGH}`,'PRIVATE_REFRESH_CANARY'),at(180*day));
 // WH-018: an unfinished closure last journaled two days ago is attention; a held account's closure is not backlog.
 const closureAt=Math.floor((now-2*day)/1000),held=id();
 sql.prepare("INSERT INTO account_closures(id,account_id,policy_version,review_digest,obligations_json,state,revision,created_at,updated_at) VALUES(?,?,1,?,'{}','waiting',1,?,?)").run(id(),owner,'e'.repeat(64),closureAt,closureAt);
 sql.prepare("INSERT INTO users VALUES(?,?,?)").run(held,'PRIVATE_HELD_CANARY@example.invalid',at(0));
 sql.prepare("INSERT INTO account_closures(id,account_id,policy_version,review_digest,obligations_json,state,revision,created_at,updated_at) VALUES(?,?,1,?,'{}','blocked',1,?,?)").run(id(),held,'f'.repeat(64),closureAt,closureAt);
 sql.prepare("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-inv',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+86400)").run(held);
 sql.prepare("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())").run(); // holds need a current preservation approver
 sql.prepare("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-inv','case-inv',?,'account',NULL,'basis-1','human:approver',unixepoch(),unixepoch()+86400)").run(held);
 sql.exec('PRAGMA query_only=ON');
 report=await maintenanceReport(db,Date.now());
 assert.equal(report.backlogs.length,42);
 {const closures=report.backlogs.find(q=>q.queue==='account_closures');assert.equal(closures.count,1);assert.equal(closures.state,'attention');assert.ok(closures.oldestAgeMs>=2*day-1000);}assert.ok(report.backlogs.every(q=>q.state!=='unavailable'),JSON.stringify(report.backlogs));
 for(const queue of ['contact_receipts','contact_notification_outbox','contact_notification_queue','traffic','fair_use','health_budget','github_staged','connection_exchanges']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'attention',queue);assert.equal(backlog.count,1,queue);}
 assert.equal(report.backlogs.find(q=>q.queue==='contact_receipts').oldestAgeMs>=2*day,true);
 for(const queue of ['github','cloudflare']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'pending');assert.equal(backlog.unknownAgeCount,0);assert.ok(backlog.oldestAgeMs<60000);}
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').count,1);
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').unknownAgeCount,0);
 assert.equal(report.operations.length,4);assert.ok(report.operations.every(o=>o.state==='available'));
 // WH-050 F8: every shared counter's ceiling matches the trigger/table that enforces it; 50%/80% flags; read-only.
 for(const [name,{enforcedBy,evidence}] of Object.entries(platformCounterInventory)){const source=sql.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(enforcedBy)?.sql??'';assert.ok(source.replace(/\s+/g,' ').includes(evidence),name);}
 assert.equal(report.counters.length,13);assert.ok(report.counters.every(c=>c.state!=='unavailable'),JSON.stringify(report.counters));
 assert.equal(report.counters.find(c=>c.counter==='contact_receipts').used,2);assert.equal(report.counters.find(c=>c.counter==='contact_receipts').state,'normal');
 sql.exec('PRAGMA query_only=OFF');
 const period=new Date(now).toISOString().slice(0,7);
 sql.prepare('INSERT INTO storage_usage(period,read_ops,write_ops) VALUES(?,?,?)').run(period,50000,8000);
 sql.prepare('INSERT INTO storage_usage(period,read_ops,write_ops) VALUES(?,?,?)').run('2000-01',100000,10000);
 sql.exec('PRAGMA query_only=ON');
 let counters=await counterReport(db,now);const state=name=>counters.counters.find(c=>c.counter===name);
 assert.equal(state('r2_reads').state,'warn');assert.equal(state('r2_reads').percent,50);assert.equal(state('r2_writes').state,'act');assert.equal(state('r2_writes').percent,80);assert.equal(counters.attention,true,'80% needs attention');
 assert.equal(state('public_backend_calls').state,'normal');assert.equal(state('public_backend_calls').used,0,'Only the observed UTC day/month is counted');
 counters=await counterReport(db,Date.parse('2000-01-15T00:00:00.000Z'));assert.equal(state('r2_reads').state,'exhausted');assert.equal(state('r2_writes').state,'exhausted');
 assert.equal((await maintenanceReport(db,now)).attention,true,'Counters at the act threshold surface in the maintenance report');
 const broken=await counterReport({prepare:()=>{throw Error('PRIVATE_SECRET_CANARY');}},now);assert.ok(broken.counters.every(c=>c.state==='unavailable'));assert.equal(broken.attention,true);assert.ok(!JSON.stringify(broken).includes('PRIVATE_'));
 assert.ok(!JSON.stringify(counters).includes(project)&&!JSON.stringify(counters).includes(owner));
 const encoded=JSON.stringify(report);for(const marker of ['PRIVATE_',owner,held,newGH,newCF,project])assert.ok(!encoded.includes(marker),marker);
 console.log('Maintenance inventory passed: complete current schema, missing telemetry attention, precise new revocation clocks, retry stability/cascade, 42 read-only queues (including unfinished account closures outside holds), four receipt families, 13 shared platform counters checked against their schema ceilings with 50%/80% flags, retention eligibility and private data exclusion.');
}finally{sql.close();}

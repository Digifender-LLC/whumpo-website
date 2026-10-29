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
 sql.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").run(owner,'PRIVATE_EMAIL_CANARY@example.invalid',at(0));
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
 // WH-182: an expired, never-applied review that no admission has sealed yet, and a sealed receipt past its 30-day replay horizon.
 sql.prepare('INSERT INTO directories(project_id) VALUES(?)').run(project);
 sql.prepare("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,'edit','[]',?,1,0,?)").run(id(),owner,project,'a'.repeat(64),at(-2*day));
 sql.exec('DROP TRIGGER review_receipt_bind');
 sql.prepare("INSERT INTO review_receipts(family,id,owner_user_id,project_id,kind,target,outcome,payload_digest,request_hash,confirmed_by,applied_at,lifecycle_class,sealed_at,seal) VALUES('directory_reviews',?,?,?,'change',?,'expired',?,?,NULL,NULL,'directories',?,?)").run(id(),owner,project,project,'a'.repeat(64),'b'.repeat(64),at(-33*day),'c'.repeat(64));
 // WH-201 queues: an expired pending change, a closed change still holding its plaintext address and past retention, 48-hour limit
 // evidence and a compromise review past its 90 days, each written already old through the schema's own insert checks.
 {
  const old=Date.now()-40*day,hex=char=>char.repeat(64);
  sql.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)").run(owner,hex('a'),id());
  sql.prepare("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)").run(owner,Date.now());
  sql.prepare("INSERT INTO owner_email_change_limits(kind,address_key,at) VALUES('send',?,?)").run(hex('b'),Date.now()-4*day);
  sql.prepare("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES('change-old',?,'request-old',?,'private-new@example.invalid',?,1,?,?,'pending',1,'[\"pending\"]',0)").run(owner,hex('c'),hex('d'),old,old+3600000);
  sql.prepare("INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) SELECT 'review-old',account_id,auth_epoch,credential_revision,kit_generation,'[]','[]',?,?,'open',1 FROM identity_accounts WHERE account_id=?").run(Date.now()-100*day,Date.now()-100*day+600000,owner);
  // WH-143: a lookup consent expired 10 days ago and a receipt last changed 500 days ago are both past retention.
  sql.prepare("INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES('consent-old',?,'gmail','messages.search','credential-x',?,'owner-panel',?,?,'issued',1)").run(owner,hex('e'),Date.now()-10*day-600000,Date.now()-10*day);
  sql.prepare("INSERT INTO connector_receipts(receipt_id,owner_id,provider,operation_id,authority,credential_id,provider_account_id,destination_id,operation_digest,request_digest,review_digest,price_units,price_basis,state,created_at,expires_at,updated_at,revision) VALUES('receipt-old',?,'gmail','message.send','owner-request','credential-x','account-x','dest-x',?,?,?,0,'plan-inclusion','review',?,?,?,1)").run(owner,hex('1'),hex('2'),hex('3'),Date.now()-500*day,Date.now()-500*day+3600000,Date.now()-500*day);
 }
 sql.exec('PRAGMA query_only=ON');
 report=await maintenanceReport(db,Date.now());
 assert.equal(report.backlogs.length,50);assert.ok(report.backlogs.every(q=>q.state!=='unavailable'),JSON.stringify(report.backlogs));
 for(const queue of ['contact_receipts','contact_notification_outbox','contact_notification_queue','traffic','fair_use','health_budget','github_staged','connection_exchanges']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'attention',queue);assert.equal(backlog.count,1,queue);}
 assert.equal(report.backlogs.find(q=>q.queue==='contact_receipts').oldestAgeMs>=2*day,true);
 for(const queue of ['github','cloudflare']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'pending');assert.equal(backlog.unknownAgeCount,0);assert.ok(backlog.oldestAgeMs<60000);}
 for(const queue of ['review_turnover','review_receipts']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.count,1,queue);assert.equal(backlog.state,'attention',queue);}
  assert.equal(report.reviews.length,21);assert.ok(report.reviews.every(r=>r.state!=='unavailable'),JSON.stringify(report.reviews));
 {const directory=report.reviews.find(r=>r.family==='directory_reviews');assert.deepEqual([directory.state,directory.waiting,directory.sealedReceipts],['attention',1,1]);assert.ok(report.reviews.filter(r=>r.family!=='directory_reviews').every(r=>r.state==='current'&&r.waiting===0));}
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').count,1);
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').unknownAgeCount,0);
 for(const queue of ['email_change_expiry','email_change_limits','security_reviews','lookup_consents','connector_receipts']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.count,1,queue);assert.equal(backlog.state,'attention',queue);assert.equal(backlog.unknownAgeCount,0,queue);}
 assert.equal(report.backlogs.find(q=>q.queue==='email_change_redaction').count,0,'a pending change keeps its address; the job closes it first');assert.equal(report.backlogs.find(q=>q.queue==='email_change_retention').count,0,'a change can only be inserted pending, so none is closed and old yet');
 assert.equal(report.operations.length,4);assert.ok(report.operations.every(o=>o.state==='available'));
 // WH-050 F8: every shared counter's ceiling matches the trigger/table that enforces it; 50%/80% flags; read-only.
 // An index may share a trigger's name (domain_connection_owner), so every object of that name is searched.
 for(const [name,{enforcedBy,evidence}] of Object.entries(platformCounterInventory)){const source=sql.prepare("SELECT group_concat(sql,' ') sql FROM sqlite_master WHERE name=?").get(enforcedBy)?.sql??'';assert.ok(source.replace(/\s+/g,' ').includes(evidence),name);}
 assert.equal(report.counters.length,14+1+18,'fourteen shared counters, the cost-event capacity and the eighteen review families that have a platform active cap');assert.ok(report.counters.every(c=>c.state!=='unavailable'),JSON.stringify(report.counters));
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
 const encoded=JSON.stringify(report);for(const marker of ['PRIVATE_',owner,newGH,newCF,project])assert.ok(!encoded.includes(marker),marker);
 console.log('Maintenance inventory passed: complete current schema, missing telemetry attention, precise new revocation clocks, retry stability/cascade, 50 read-only queues, four receipt families, 33 shared platform counters (14 shared, the cost-event capacity and 18 review-family caps) checked against their schema ceilings with 50%/80% flags, retention eligibility and private data exclusion.');
}finally{sql.close();}

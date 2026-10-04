import {sqliteD1} from './sqlite-d1.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import assert from 'node:assert/strict';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
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
 sql.prepare('INSERT INTO site_traffic_daily VALUES(?,?,?)').run(project,at(-32*day).slice(0,10),1);
 sql.prepare('INSERT INTO site_traffic_daily VALUES(?,?,?)').run(project,at(-2*day).slice(0,10),1);
 sql.prepare('INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at,removed_at) VALUES(?,?,?,?)').run(id(),owner,at(-100*day),at(-93*day));
 sql.prepare('INSERT INTO site_health_budget VALUES(?,?)').run(at(-65*day).slice(0,10),1);
 const stage=id();ciphers.set(stage,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${owner}:${stage}`,'PRIVATE_CREDENTIAL_CANARY'));github(stage,'active');sql.prepare('INSERT INTO github_token_staging VALUES(?,?,?)').run(stage,'PRIVATE_STATE_CANARY',at(-2*day));
 sql.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state,created_at) VALUES(?,?,'github','fixture','PRIVATE_STATE','fixture-current',1,'dispatched',?)").run(newGH,owner,at(-2*day));
 sql.prepare('INSERT INTO github_refresh_custody(token_id,user_id,client_id,ciphertext,expires_at) VALUES(?,?,?,?,?)').run(newGH,owner,'fixture',await fixtureCiphertext(fixtureKeyring(),`whumpo:github:refresh:${owner}:${newGH}`,'PRIVATE_REFRESH_CANARY'),at(180*day));
 sql.exec('PRAGMA query_only=ON');
 report=await maintenanceReport(db,Date.now());
 assert.equal(report.backlogs.length,36);assert.ok(report.backlogs.every(q=>q.state!=='unavailable'),JSON.stringify(report.backlogs));
 for(const queue of ['contact_receipts','traffic','fair_use','health_budget','github_staged','connection_exchanges']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'attention',queue);assert.equal(backlog.count,1,queue);}
 assert.equal(report.backlogs.find(q=>q.queue==='contact_receipts').oldestAgeMs>=2*day,true);
 for(const queue of ['github','cloudflare']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'pending');assert.equal(backlog.unknownAgeCount,0);assert.ok(backlog.oldestAgeMs<60000);}
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').count,1);
 assert.equal(report.backlogs.find(q=>q.queue==='github_refresh_grants').unknownAgeCount,0);
 assert.equal(report.operations.length,4);assert.ok(report.operations.every(o=>o.state==='available'));
 const encoded=JSON.stringify(report);for(const marker of ['PRIVATE_',owner,newGH,newCF,project])assert.ok(!encoded.includes(marker),marker);
 console.log('Maintenance inventory passed: complete current schema, missing telemetry attention, precise new revocation clocks, retry stability/cascade, 36 read-only queues, four receipt families, retention eligibility and private data exclusion.');
}finally{sql.close();}

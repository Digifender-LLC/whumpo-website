import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
const sql=new DatabaseSync(':memory:'),id=()=>crypto.randomUUID();
const db={prepare:q=>{const bound=p=>({first:async()=>sql.prepare(q).get(...p)??null,all:async()=>({results:sql.prepare(q).all(...p)})});return {...bound([]),bind:(...p)=>bound(p)};}};
try{
 for(const name of (await readdir('migrations')).filter(n=>n.endsWith('.sql')&&!n.startsWith('0107_')).sort())sql.exec(await readFile('migrations/'+name,'utf8'));
 const owner=id(),project=id(),now=Date.now(),at=offset=>new Date(now+offset).toISOString(),day=86400000;
 sql.prepare("INSERT INTO users VALUES(?,?,'fixture','fixture',?)").run(owner,'PRIVATE_EMAIL_CANARY@example.invalid',at(0));
 sql.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').run(project,owner,'PRIVATE_NAME_CANARY',at(0),at(0));
 const oldGH=id(),oldCF=id(),newGH=id(),newCF=id();
 const github=(token,state)=>sql.prepare('INSERT INTO github_token_vault VALUES(?,?,?,?,?)').run(token,owner,'PRIVATE_CREDENTIAL_CANARY',at(day),state);
 const cloudflare=(token,state)=>sql.prepare('INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,?)').run(token,owner,'PRIVATE_CREDENTIAL_CANARY',at(day),at(-10*day),state);
 github(oldGH,'revoking');cloudflare(oldCF,'revoking');
 sql.exec(await readFile('migrations/0107_revocation_health.sql','utf8'));
 assert.equal(sql.prepare('SELECT requested_at FROM github_revocation_health WHERE token_id=?').get(oldGH).requested_at,null);
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
 const stage=id();github(stage,'active');sql.prepare('INSERT INTO github_token_staging VALUES(?,?,?)').run(stage,'PRIVATE_STATE_CANARY',at(-2*day));
 sql.exec('PRAGMA query_only=ON');
 report=await maintenanceReport(db,Date.now());
 assert.equal(report.backlogs.length,28);assert.ok(report.backlogs.every(q=>q.state!=='unavailable'),JSON.stringify(report.backlogs));
 for(const queue of ['contact_receipts','traffic','fair_use','health_budget','github_staged']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'attention',queue);assert.equal(backlog.count,1,queue);}
 assert.equal(report.backlogs.find(q=>q.queue==='contact_receipts').oldestAgeMs>=2*day,true);
 for(const queue of ['github','cloudflare']){const backlog=report.backlogs.find(q=>q.queue===queue);assert.equal(backlog.state,'pending');assert.equal(backlog.unknownAgeCount,0);assert.ok(backlog.oldestAgeMs<60000);}
 assert.equal(report.operations.length,5);assert.ok(report.operations.every(o=>o.state==='available'));
 const encoded=JSON.stringify(report);for(const marker of ['PRIVATE_',owner,newGH,newCF,project])assert.ok(!encoded.includes(marker),marker);
 console.log('Maintenance inventory passed: migration preserves unknown history, precise new revocation clocks, retry stability/cascade, 28 read-only queues, five receipt families, retention eligibility and private data exclusion.');
}finally{sql.close();}

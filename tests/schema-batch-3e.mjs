import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 3e (WH-156 shared notification outbox) over the current schema on disposable in-memory SQLite and, with --d1, actual local D1:
// the two new tables with their keys, CHECKs and cascades, the twelve admission, state, ledger, cancellation and retention triggers, the three dropped tables with
// their triggers and indexes, and the objects that stay (destinations, reviews, suppressions and the 3c recipients view). The behaviour through
// the source, with a simulated provider, is tests/notification-outbox.mjs. Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r}));
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),id=()=>crypto.randomUUID(),T=Date.now();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const rejects=(sql,pattern,...v)=>assert.rejects(()=>run(sql,...v),pattern);
const user=id(),project=id(),destination=id();
await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",user,user+'@example.test');
await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Testing','draft','2026-10-30','2026-10-30')",project,user);
await run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,'owner@example.test','2026-10-30')",destination,user,project);
let n=0;
const insert=(o={})=>{
 const row={id:id(),user_id:user,scope:'account-email',project_id:null,destination_id:null,recipient_ref:null,template:'account.passkey-added@1',event_ref:'ref-'+(++n),created_at:T+n,expires_at:T+n+3600000,...o};
 row.recipient_key??=row.scope+':'+(row.destination_id??row.recipient_ref??row.user_id);
 const keys=Object.keys(row);return run(`INSERT INTO notification_notices(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k])).then(()=>row);
};
try{
 await check('the two tables exist, are STRICT and carry the declared keys; the three old tables are gone with their triggers and indexes',async()=>{
  assert.deepEqual((await all("SELECT name,strict FROM pragma_table_list WHERE name IN ('notification_notices','notification_send_ledger') ORDER BY name")).map(r=>[r.name,r.strict]),[['notification_notices',1],['notification_send_ledger',1]]);
  assert.deepEqual((await all("SELECT name,pk FROM pragma_table_info('notification_notices') ORDER BY cid")).map(r=>r.name),
   ['id','user_id','scope','project_id','destination_id','recipient_ref','recipient_key','template','event_ref','provider','state','attempts','job_id','created_at','expires_at','dispatched_at','outcome_at','provider_ref','reason','lookups','reconcile_until']);
  assert.deepEqual((await all("SELECT name,pk FROM pragma_table_info('notification_send_ledger') ORDER BY cid")).map(r=>[r.name,r.pk]),[['provider',1],['day',2],['sends',0],['ceiling',0]]);
  assert.deepEqual((await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('notification_notices') ORDER BY \"from\"")).map(r=>[r.from,r.table,r.on_delete]),
   [['destination_id','contact_notification_destinations','CASCADE'],['job_id','job_journal','SET NULL'],['project_id','projects','CASCADE'],['user_id','users','CASCADE']]);
  const unique=(await all("SELECT il.name,group_concat(ii.name) cols FROM pragma_index_list('notification_notices') il JOIN pragma_index_info(il.name) ii WHERE il.\"unique\"=1 AND il.origin!='pk' GROUP BY il.name")).map(r=>r.cols).sort();
  assert.deepEqual(unique,['job_id','template,event_ref,recipient_key']);
  assert.deepEqual(await all("SELECT name FROM sqlite_master WHERE name LIKE 'support_deliver%' OR name LIKE 'contact_notification_outbox%' OR name LIKE 'contact_notification_send_ledger%' OR name LIKE 'contact_send_ledger%' OR name LIKE 'contact_outbox%' OR name LIKE 'safety_hold_contact_outbox%'"),[]);
  assert.deepEqual((await all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('contact_notification_destinations','contact_destination_reviews','contact_notification_suppressions','contact_notification_suppression_resets','job_journal') ORDER BY name")).map(r=>r.name),
   ['contact_destination_reviews','contact_notification_destinations','contact_notification_suppression_resets','contact_notification_suppressions','job_journal']);
 });
 await check('every trigger is present and each one is on the table it names',async()=>{
  const triggers=(await all("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'notification\\_%' ESCAPE '\\' AND name NOT LIKE 'notification\\_configuration%' ESCAPE '\\' OR name LIKE 'safety\\_hold\\_notification%' ESCAPE '\\') ORDER BY name")).map(r=>r.name+'@'+r.tbl_name);
  assert.deepEqual(triggers,[
   'notification_notices_counted@notification_notices','notification_notices_destination_removed@contact_notification_destinations','notification_notices_job_cancelled@notification_notices',
   'notification_notices_new@notification_notices','notification_notices_project_removed@projects','notification_notices_retained@notification_notices','notification_notices_suppressed@contact_notification_suppressions',
   'notification_notices_transition@notification_notices','notification_notices_uncertain@job_journal','notification_send_ledger_insert@notification_send_ledger','notification_send_ledger_update@notification_send_ledger',
   'safety_hold_notification_notices_retained@notification_notices']);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('notification_recipients') ORDER BY cid")).map(r=>r.name),['project_id','scope','ref','address']);
 });
 await check('the scope decides which recipient columns are set, the recipient key is derived, and the template shape is checked (the catalog list is in code)',async()=>{
  const ok=await insert();assert.equal(ok.recipient_key,'account-email:'+user);
  await insert({scope:'owner-destination',project_id:project,destination_id:destination});
  await insert({scope:'project-staff',project_id:project,recipient_ref:'visitor-1',template:'appointment.staff-notice@1'});
  await insert({scope:'submitter',project_id:project,recipient_ref:'record-1',template:'appointment.request-receipt@1'});
  for(const [name,o] of [
   ['account scope with a project',{project_id:project}],['account scope with a destination',{destination_id:destination}],
   ['owner scope without a destination',{scope:'owner-destination',project_id:project}],['owner scope with a recipient_ref',{scope:'owner-destination',project_id:project,destination_id:destination,recipient_ref:'x'}],
   ['staff scope without a recipient_ref',{scope:'project-staff',project_id:project}],['unknown scope',{scope:'everyone'}],
   ['a recipient key that is not derived',{recipient_key:'account-email:someone-else'}],['a template with no version',{template:'account.passkey-added'}],
   ['a template over 80 characters',{template:'a'.repeat(80)+'@1'}],['an empty event_ref',{event_ref:''}],['an event_ref over 128 characters',{event_ref:'e'.repeat(129)}],
   ['a notice that lives longer than 24 hours',{expires_at:T+90000000}],['a notice that expires before it was created',{expires_at:T-1}],['another provider',{provider:'other'}],
   ['an already advanced state',{state:'accepted'}],['an attempt already counted',{attempts:1}],['a lookup already used',{lookups:1}],['a reason on a new notice',{reason:'expired'}],
   ['a job linked at insert',{job_id:id()}]
  ])await assert.rejects(insert(o),/CHECK|FOREIGN|notification_notice/,name);
  await assert.rejects(insert({event_ref:ok.event_ref,template:ok.template}),/UNIQUE/,'one notice per template, event and recipient');
  assert.ok(await insert({event_ref:ok.event_ref,template:'account.passkey-removed@1'}),'a different template is a different notice');
  const other=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",other,other+'@example.test');
  await assert.rejects(insert({user_id:other,scope:'owner-destination',project_id:project,destination_id:destination}),/notification_notice_scope/,'another account\'s destination');
  await assert.rejects(insert({user_id:other,scope:'submitter',project_id:project,recipient_ref:'x'}),/notification_notice_scope/,'another account\'s project');
 });
 await check('bounds: attempts 0..6, lookups 0..3, a closed reason list, provider_ref only after acceptance, reconcile_until required in unknown-outcome',async()=>{
  const q=await insert();
  await rejects("UPDATE notification_notices SET attempts=7 WHERE id=?",/CHECK|notification_notice_transition/,q.id);
  await rejects("UPDATE notification_notices SET state='cancelled',reason='because',outcome_at=? WHERE id=?",/CHECK|notification_notice_transition/,T,q.id);
  await rejects("UPDATE notification_notices SET state='cancelled',reason=NULL,outcome_at=? WHERE id=?",/CHECK|notification_notice_transition/,T,q.id);
  await rejects("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=NULL WHERE id=?",/CHECK|notification_notice_transition/,q.id);
  await rejects("UPDATE notification_notices SET provider_ref='x' WHERE id=?",/CHECK|notification_notice_transition/,q.id);
  const text=(await all("SELECT sql FROM sqlite_master WHERE name='notification_notices'"))[0].sql;
  assert.match(text,/state!='unknown-outcome' OR \(reconcile_until IS NOT NULL AND outcome_at IS NOT NULL\)/);assert.match(text,/reconcile_until<=outcome_at\+259200000/);
  assert.match(text,/lookups INTEGER NOT NULL DEFAULT 0 CHECK\(lookups BETWEEN 0 AND 3\)/);assert.match(text,/attempts INTEGER NOT NULL DEFAULT 0 CHECK\(attempts BETWEEN 0 AND 6\)/);
  assert.doesNotMatch(text,/template IN \(/,'no template list in the schema');
 });
 await check('the state table: a queued notice reaches only dispatching or cancelled, a cancelled one nothing, and identity is immutable',async()=>{
  const q=await insert(),states=['accepted','delivered','unknown-outcome','bounced','complained','failed','unresolved','deferred'];
  for(const s of states)await assert.rejects(run("UPDATE notification_notices SET state=?,reason='expired',outcome_at=?,reconcile_until=?,dispatched_at=?,attempts=1 WHERE id=?",s,T,T+1000,T,q.id),/CHECK|notification_notice_transition/,'queued -> '+s);
  await run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE id=?",T,q.id);
  for(const s of ['queued','dispatching','deferred','accepted','failed','unresolved'])await assert.rejects(run("UPDATE notification_notices SET state=?,reason='expired',outcome_at=?,dispatched_at=?,attempts=1 WHERE id=?",s,T,T,q.id),/CHECK|notification_notice_transition/,'cancelled -> '+s);
  for(const set of ["user_id='x'","scope='submitter'","recipient_key='k'","template='account.kit-rotated@1'","event_ref='changed'","created_at=1","expires_at=expires_at+1","project_id='x'"])await assert.rejects(run(`UPDATE notification_notices SET ${set} WHERE id=?`,q.id),/notification_notice_identity|CHECK|FOREIGN/,set);
  await assert.rejects(run('DELETE FROM notification_notices WHERE id=?',(await insert()).id),/notification_notice_retained/,'an open notice is not deletable');
  assert.equal((await all('SELECT count(*) n FROM notification_notices WHERE id=?',q.id))[0].n,1);
  await run('DELETE FROM notification_notices WHERE id=?',q.id);
 });
 await check('a cancelled notice takes its unclaimed envelope with it, and a deleted journal job leaves the notice with a cleared job_id',async()=>{
  const q=await insert(),jobId=id(),envelope={jobId,limits:{maxAttempts:1},ownerAccountId:user,purpose:'platform-email',schedule:{createdAt:T,expiresAt:T+3600000,notBefore:T}};
  await run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,'platform-email',?,?,?,?,1,?,?,'enqueued',?)",jobId,user,JSON.stringify(envelope),'a'.repeat(64),T,T+3600000,T,T,T);
  await run('UPDATE notification_notices SET job_id=? WHERE id=?',jobId,q.id);
  await assert.rejects(run('UPDATE notification_notices SET job_id=? WHERE id=?',id(),q.id),/FOREIGN|notification_notice_transition/,'a linked notice cannot be re-pointed');
  await run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE id=?",T+5,q.id);
  assert.equal((await all('SELECT state FROM job_journal WHERE id=?',jobId))[0].state,'cancelled');
  await run('DELETE FROM job_journal WHERE id=?',jobId);
  assert.equal((await all('SELECT job_id FROM notification_notices WHERE id=?',q.id))[0].job_id,null);
 });
 await check('the ledger is per provider and day, starts at zero and never exceeds its 32-day ceiling',async()=>{
  await rejects("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('other','2031-01-01',0,5)",/CHECK/);
  await rejects("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','2031-01-01',1,5)",/notification_send_final/);
  await run("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','2031-01-01',0,2)");
  await run("UPDATE notification_send_ledger SET sends=2 WHERE day='2031-01-01'");
  await rejects("UPDATE notification_send_ledger SET sends=3 WHERE day='2031-01-01'",/notification_send_ceiling/);
  await run("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','2031-01-20',0,2)");
  await rejects("UPDATE notification_send_ledger SET sends=1 WHERE day='2031-01-20'",/notification_send_ceiling/);
  await run("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','2031-03-01',0,2)");
  await run("UPDATE notification_send_ledger SET sends=1 WHERE day='2031-03-01'");
 });
 console.log(`Schema batch 3e: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; notification_notices and notification_send_ledger with their keys, checks, twelve triggers, the dropped contact outbox, send ledger and support deliveries, and the unchanged destinations, reviews and suppressions. No provider call.`);
}finally{await fixture.close();}

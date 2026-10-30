import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSchema} from '../tools/current-schema.mjs';
import {jobEnvelopeDigest} from '../tools/prototypes/job-envelope.mjs';
import {jobEnvelopeFixture as job,jobFixtureId as key,ownerA,ownerB} from './fixtures/job-envelope.mjs';

// WH-052 P-2: the D1 job journal over the current schema. On SQLite the two clients are two real connections to one file; with --d1 they are
// two users of the same actual local D1. D1 cannot read and then branch inside one commit, so this proves the guarded single statements and
// the triggers: two claimers, a stale fence, a lost settle reply, atomic chunk commits, forged writes. Synthetic rows only; no provider call.
const bundle=await build({stdin:{contents:"export * from './src/job-journal';export * from './src/job-dispatcher';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1});
let directory,files=[],A=fixture.db,B=fixture.db;
if(!d1){
 directory=await mkdtemp(join(tmpdir(),'whumpo-job-journal-'));
 const open=async()=>{const sql=new DatabaseSync(join(directory,'journal.sqlite'));sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');return sql;};
 const first=await open();first.exec('PRAGMA journal_mode=WAL');first.exec(await currentSchema());const second=await open();files=[first,second];
 A=sqliteD1Adapter(first);B=sqliteD1Adapter(second);
}
const run=(sql,...v)=>A.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await A.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>A.prepare(sql).bind(...v).first();
const rejects=(p,re)=>assert.rejects(p,re),events=async id=>(await all('SELECT event FROM job_journal_events WHERE job_id=? ORDER BY sequence',id)).map(r=>r.event);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
for(const o of [ownerA,ownerB])await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",o,o+'@example.test');
const lost=/job_lost/,conflict=/job_conflict/,minute=60000;
const admit=(label,purpose='platform-email',owner=ownerA,due=0)=>m.admitJob(A,job(label,purpose,owner,due));
/** Admit, claim and record the intent: an attempt in flight. */
const inflight=async(label,now=1000)=>{await admit(label);const {lease}=await m.claimJob(A,ownerA,key(label),now);const row=await m.beginExternal(A,lease,now+1);return {lease,row};};
try{
 await check('admission writes the job, its outbox entry and first event together; the digest matches the offline reference; replays are exact',async()=>{
  const envelope=job('admit-1'),row=await m.admitJob(A,envelope);
  assert.equal(row.state,'ready');assert.equal(row.fence,0);assert.equal(row.envelope_digest,jobEnvelopeDigest(envelope));assert.equal(await m.envelopeDigest(envelope),jobEnvelopeDigest(envelope));
  assert.deepEqual(await events(key('admit-1')),['enqueued']);
  const delivery=await m.jobDelivery(A,ownerA,key('admit-1'));
  assert.match(delivery.deliveryId,/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);assert.equal(delivery.envelopeDigest,row.envelope_digest);assert.equal(delivery.acknowledgedAt,null);
  assert.deepEqual(await m.admitJob(B,envelope),row,'a lost admission reply reads the same job');
  assert.deepEqual(await m.jobDelivery(B,ownerA,key('admit-1')),delivery,'and the same delivery identity');
  const altered=job('admit-1');altered.intent.inputDigest='b'.repeat(64);await rejects(m.admitJob(A,altered),conflict);
  await rejects(m.admitJob(A,job('admit-1','platform-email',ownerB)),conflict);
  assert.equal(await m.readJob(A,ownerB,key('admit-1')),null,'another owner reads nothing');
  assert.equal((await all('SELECT 1 FROM job_outbox WHERE job_id=?',key('admit-1'))).length,1);
  await rejects(m.admitJob(A,{...job('admit-2'),purpose:'unknown'}),/job_invalid/);await rejects(m.admitJob(A,{...job('admit-2'),contractVersion:2}),/job_invalid/);
  const unknown=job('admit-3');unknown.limits.maxAttempts=9;await rejects(m.admitJob(A,unknown),/CHECK|job_/);
 });
 await check('the schema refuses an inconsistent row: derived columns must match the stored envelope, and a job starts ready and unattempted',async()=>{
  const e=job('raw-1'),json=JSON.stringify(e),raw=(over={})=>{const v={id:key('raw-1'),owner:ownerA,purpose:'platform-email',json,digest:'a'.repeat(64),created:0,expires:604800000,max:3,due:0,state:'ready',fence:0,...over};
   return run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,state,fence,last_event,last_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'enqueued',?)",v.id,v.owner,v.purpose,v.json,v.digest,v.created,v.expires,v.max,v.due,v.due,v.state,v.fence,v.created);};
  for(const over of [{owner:ownerB},{purpose:'owner-push'},{due:5},{expires:604800001},{max:2},{state:'leased'},{fence:1},{id:key('raw-2')}])await rejects(raw(over),/job_journal_new|CHECK/);
  await raw();assert.deepEqual(await events(key('raw-1')),['enqueued']);
 });
 await check('two claimers race for one job: exactly one wins, with a new fence; nobody claims early, expired or for another owner',async()=>{
  await admit('race-1');await admit('future-1','platform-email',ownerA,5000);
  assert.equal(await m.claimJob(A,ownerA,key('future-1'),1000),null,'not due');
  assert.equal(await m.claimJob(A,ownerB,key('race-1'),1000),null,'wrong owner');
  // Both claimers read the same due list, then both claim: the guarded UPDATE lets one through.
  const [listA,listB]=await Promise.all([m.dueJobs(A,'platform-email',1000,2,25),m.dueJobs(B,'platform-email',1000,2,25)]);
  assert.ok(listA.some(r=>r.id===key('race-1'))&&listB.some(r=>r.id===key('race-1')));
  const [a,b]=await Promise.all([m.claimJob(A,ownerA,key('race-1'),1000),m.claimJob(B,ownerA,key('race-1'),1000)]);
  assert.equal([a,b].filter(Boolean).length,1);const won=a??b;assert.equal(won.lease.fence,1);assert.equal(won.row.state,'leased');assert.equal(won.row.lease_until,1000+minute);
  assert.equal(await m.claimJob(B,ownerA,key('race-1'),1000+minute-1),null,'a live lease is not claimable');
  assert.deepEqual(await events(key('race-1')),['enqueued','claimed']);
  await rejects(m.claimJob(A,ownerA,key('race-1'),1000,minute+1),/job_invalid/);
 });
 await check('a stale fence cannot act: an expired pre-dispatch lease is retaken and the old holder is fenced out',async()=>{
  await admit('stale-1');const first=await m.claimJob(A,ownerA,key('stale-1'),0),second=await m.claimJob(B,ownerA,key('stale-1'),minute);
  assert.equal(first.lease.fence,1);assert.equal(second.lease.fence,2);
  await rejects(m.beginExternal(A,first.lease,minute+1),lost);await rejects(m.markUncertain(A,first.lease,minute+1),lost);
  assert.equal((await m.readJob(A,ownerA,key('stale-1'))).state,'leased');
  const intent=await m.beginExternal(B,second.lease,minute+1);assert.equal(intent.state,'awaiting');assert.equal(intent.attempt,1);assert.equal(intent.attempt_id,key('stale-1')+'.1');
  await rejects(m.beginExternal(B,second.lease,minute+2),lost,'one intent per lease');
  assert.equal(await m.claimJob(A,ownerA,key('stale-1'),10*minute),null,'a recorded intent is never reclaimed as ready');
  // The fence also guards the raw statement: a hand-written update with a wrong fence changes nothing.
  assert.equal((await run("UPDATE job_journal SET state='uncertain',last_event='uncertain',last_at=5 WHERE id=? AND fence=?",key('stale-1'),1)).meta.changes,0);
 });
 await check('a lost lease with no intent recorded is retried; a lost lease with an intent is uncertain and never resent',async()=>{
  const {lease}=await inflight('uncertain-1',0);
  assert.deepEqual(await m.recoverExpiredJobs(A,minute-1),{uncertain:0,expired:0},'the lease is still live a millisecond before it expires');
  assert.deepEqual(await m.recoverExpiredJobs(B,minute,'owner-push'),{uncertain:0,expired:0},'a sweep for another purpose leaves it');
  assert.deepEqual(await m.recoverExpiredJobs(B,minute),{uncertain:1,expired:0});
  assert.equal((await m.readJob(A,ownerA,key('uncertain-1'))).state,'uncertain');
  assert.equal(await m.claimJob(A,ownerA,key('uncertain-1'),9*minute),null);await rejects(m.beginExternal(A,lease,9*minute),lost);await rejects(m.markUncertain(A,lease,9*minute),lost);
  assert.deepEqual(await events(key('uncertain-1')),['enqueued','claimed','intent','uncertain']);
  const {lease:live}=await inflight('uncertain-2',0);const row=await m.markUncertain(B,live,10);assert.equal(row.state,'uncertain');assert.equal(row.fence,live.fence);
 });
 await check('a lost settle reply: the same reference returns the saved result with no second event; a different one is a conflict',async()=>{
  const {row}=await inflight('settle-1',0);
  await rejects(m.settleJob(A,ownerB,key('settle-1'),row.attempt_id,'provider-1',5),conflict);await rejects(m.settleJob(A,ownerA,key('settle-1'),'wrong.1','provider-1',5),conflict);
  await rejects(m.settleJob(A,ownerA,key('settle-1'),row.attempt_id,'bad ref',5),/job_invalid/);
  const [x,y]=await Promise.all([m.settleJob(A,ownerA,key('settle-1'),row.attempt_id,'provider-1',5),m.settleJob(B,ownerA,key('settle-1'),row.attempt_id,'provider-1',6)]);
  assert.equal(x.state,'complete');assert.equal(y.result_ref,'provider-1');assert.deepEqual(await events(key('settle-1')),['enqueued','claimed','intent','external_result']);
  assert.deepEqual(await m.settleJob(B,ownerA,key('settle-1'),row.attempt_id,'provider-1',9),x,'the reply was lost: the repeat reads the saved result');
  await rejects(m.settleJob(A,ownerA,key('settle-1'),row.attempt_id,'provider-2',9),conflict);
  assert.equal(await m.claimJob(A,ownerA,key('settle-1'),999999),null);assert.equal((await all('SELECT 1 FROM job_journal_events WHERE job_id=? AND event=?',key('settle-1'),'external_result')).length,1);
  // An uncertain attempt is settled from the evidence, not retried.
  await inflight('settle-2',0);await m.recoverExpiredJobs(A,5*minute);const done=await m.settleJob(A,ownerA,key('settle-2'),key('settle-2')+'.1','provider-late',5*minute+1);assert.equal(done.state,'complete');
 });
 await check('confirmed-not-sent retries with a bounded backoff, then goes to the operator lane; the old attempt cannot settle afterwards',async()=>{
  let t=0;await admit('retry-1');const j=key('retry-1');
  for(const attempt of [1,2,3]){
   const {lease}=await m.claimJob(A,ownerA,j,t);const row=await m.beginExternal(A,lease,t+1);assert.equal(row.attempt,attempt);
   const after=await m.confirmNotSent(B,ownerA,j,row.attempt_id,'evidence-'+attempt,t+2);
   assert.equal(after.attempt_id,null);assert.equal(after.fence,row.fence+1);
   if(attempt<3){assert.equal(after.state,'ready');assert.equal(after.due,t+2+minute*2**(attempt-1));
    assert.deepEqual(await m.confirmNotSent(A,ownerA,j,row.attempt_id,'evidence-'+attempt,t+3),after,'a repeat is the saved result');
    assert.equal(await m.claimJob(A,ownerA,j,after.due-1),null,'not before the backoff');t=after.due;}
   else assert.equal(after.state,'operator');
   await rejects(m.settleJob(A,ownerA,j,row.attempt_id,'late',t+5),conflict);
  }
  assert.equal(await m.claimJob(A,ownerA,j,10**8),null);await rejects(m.releaseFromOperator(A,ownerA,j,'redrive',10**8),lost,'attempts are used up');
  await rejects(m.confirmNotSent(A,ownerA,j,key('retry-1')+'.9','x',1),conflict);
 });
 await check('cancel stops future work but keeps an in-flight effect to reconcile; repeats and late settles are exact',async()=>{
  await admit('cancel-1');const c=await m.cancelJob(A,ownerA,key('cancel-1'),5);assert.equal(c.state,'cancelled');assert.equal(c.cancel_requested,1);
  assert.deepEqual(await m.cancelJob(B,ownerA,key('cancel-1'),6),c);assert.equal(await m.claimJob(A,ownerA,key('cancel-1'),10),null);
  await rejects(m.cancelJob(A,ownerB,key('cancel-1'),6),conflict);
  const {lease,row}=await inflight('cancel-2',0);const held=await m.cancelJob(A,ownerA,key('cancel-2'),10);
  assert.equal(held.state,'awaiting');assert.equal(held.cancel_requested,1);assert.equal(held.fence,lease.fence+1);await rejects(m.markUncertain(A,lease,11),lost);
  assert.equal((await m.settleJob(A,ownerA,key('cancel-2'),row.attempt_id,'provider-c',12)).state,'cancelled');
  const {lease:l3,row:r3}=await inflight('cancel-3',0);await m.cancelJob(A,ownerA,key('cancel-3'),10);
  const nothing=await m.confirmNotSent(A,ownerA,key('cancel-3'),r3.attempt_id,'proof',11);assert.equal(nothing.state,'cancelled');
  await admit('cancel-4');const {lease:l4}=await m.claimJob(A,ownerA,key('cancel-4'),0);await m.cancelJob(A,ownerA,key('cancel-4'),1);await rejects(m.beginExternal(A,l4,2),lost);
  assert.deepEqual(await events(key('cancel-4')),['enqueued','claimed','cancel_requested']);void l3;
 });
 await check('expiry: an unsent job expires and is fenced; an in-flight effect is held, never expired',async()=>{
  await admit('expire-1');await admit('expire-2');const {lease}=await m.claimJob(A,ownerA,key('expire-2'),0);
  assert.equal(await m.claimJob(A,ownerA,key('expire-1'),604800000),null);
  await inflight('expire-3',0);
  const swept=await m.recoverExpiredJobs(A,604800000);assert.equal(swept.uncertain,1);assert.ok(swept.expired>=2,'every unsent job past its expiry, including earlier cases');
  assert.equal((await m.readJob(A,ownerA,key('expire-2'))).state,'expired');await rejects(m.beginExternal(A,lease,5),lost);assert.equal((await m.readJob(A,ownerA,key('expire-3'))).state,'uncertain');
  const settled=await m.settleJob(A,ownerA,key('expire-3'),key('expire-3')+'.1','provider-e',604800001);assert.equal(settled.state,'complete');
 });
 await check('operator moves: hold, no claim, release only without an attempt in flight, evidence settles a held uncertain job',async()=>{
  await admit('op-1');const h=await m.holdForOperator(A,ownerA,key('op-1'),'manual-hold',5);assert.equal(h.state,'operator');assert.equal(await m.claimJob(A,ownerA,key('op-1'),10),null);
  await rejects(m.holdForOperator(A,ownerA,key('op-1'),'again',6),lost);
  const r=await m.releaseFromOperator(A,ownerA,key('op-1'),'redrive',20);assert.equal(r.state,'ready');assert.equal(r.due,20);assert.ok(await m.claimJob(A,ownerA,key('op-1'),20));
  await inflight('op-2',0);await m.recoverExpiredJobs(A,5*minute);const u=await m.holdForOperator(A,ownerA,key('op-2'),'needs-human',5*minute+1);
  assert.equal(u.state,'operator');assert.equal(u.attempt_id,key('op-2')+'.1');await rejects(m.releaseFromOperator(A,ownerA,key('op-2'),'redrive',5*minute+2),lost);
  assert.equal((await m.cancelJob(A,ownerA,key('op-2'),5*minute+3)).state,'operator','an unresolved effect stays held even when cancelled');
  assert.equal((await m.settleJob(A,ownerA,key('op-2'),key('op-2')+'.1','operator-evidence',5*minute+4)).state,'cancelled');
  await rejects(m.holdForOperator(A,ownerA,key('op-2'),'x',5*minute+5),lost);
  assert.deepEqual(await events(key('op-1')),['enqueued','operator_hold','operator_release','claimed']);
 });
 await check('cleanup chunks commit their effect and cursor together, and a stale fence applies nothing',async()=>{
  await run('CREATE TABLE chunk_effect_fixture(n INTEGER)');
  try{
   const effect=n=>A.prepare('INSERT INTO chunk_effect_fixture(n) VALUES(?)').bind(n);
   await admit('chunk-1','account-cleanup');const first=await m.claimJob(A,ownerA,key('chunk-1'),0),second=await m.claimJob(B,ownerA,key('chunk-1'),minute);
   await rejects(m.commitChunk(A,first.lease,10,false,minute+1,[effect(1)]),lost);
   assert.equal((await one('SELECT count(*) n FROM chunk_effect_fixture')).n,0,'the stale holder\'s effect was rolled back');
   const row=await m.commitChunk(B,second.lease,10,false,minute+1,[effect(1),effect(2)]);assert.equal(row.state,'ready');assert.equal(row.cursor,10);assert.equal((await one('SELECT count(*) n FROM chunk_effect_fixture')).n,2);
   await rejects(m.commitChunk(B,second.lease,20,false,minute+2,[effect(3)]),lost,'the commit spent the lease');
   const third=await m.claimJob(A,ownerA,key('chunk-1'),minute+1);await rejects(m.commitChunk(A,third.lease,10,true,minute+2,[effect(4)]),lost,'the cursor only moves forward');
   const done=await m.commitChunk(A,third.lease,20,true,minute+3,[effect(5)]);assert.equal(done.state,'complete');
   assert.equal((await one('SELECT count(*) n FROM chunk_effect_fixture')).n,3);assert.deepEqual(await events(key('chunk-1')),['enqueued','claimed','claimed','chunk_committed','claimed','chunk_committed']);
   await admit('chunk-2','platform-email');const other=await m.claimJob(A,ownerA,key('chunk-2'),0);await rejects(m.commitChunk(A,other.lease,5,true,5,[]),lost,'only account-cleanup commits chunks');
  }finally{await run('DROP TABLE chunk_effect_fixture');}
 });
 await check('forged writes are refused by the schema: skipped transitions, identity changes, hand-written events, changed receipts',async()=>{
  await admit('forge-1');const id=key('forge-1'),update=(set,...v)=>run(`UPDATE job_journal SET ${set} WHERE id=?`,...v,id);
  await rejects(update("state='complete',result_ref='x',last_event='external_result',last_at=1"),/job_journal_transition/);
  await rejects(update("state='leased',lease_until=70000,fence=1,last_event='claimed',last_at=10"),/job_journal_transition/,'a lease longer than 60 s');
  await rejects(update("state='leased',lease_until=100,fence=1,last_event='claimed',last_at=10,due=1"),/job_journal_transition/);
  await rejects(update("fence=fence+1"),/CHECK|job_journal_transition/);await rejects(update("last_event='claimed'"),/job_journal_transition/);
  for(const set of ["owner_user_id='"+ownerB+"'","purpose='owner-push'","envelope_digest='"+'f'.repeat(64)+"'","expires_at=expires_at+1","max_attempts=1","initial_due=9","created_at=1",`envelope_json='{}'`,"id='"+key('x')+"'"])await rejects(update("state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0,"+set),/job_journal_identity/,'a valid claim cannot carry an identity change');
  await rejects(run("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) VALUES(?,'external_result',0,0,1)",id),/job_journal_event_new/);
  await rejects(run("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) VALUES(?,'enqueued',0,0,0)",id),/UNIQUE/);
  await rejects(run("UPDATE job_journal_events SET at=9 WHERE job_id=?",id),/job_journal_event_immutable/);
  await rejects(run('DELETE FROM job_journal_events WHERE job_id=?',id),/job_journal_event_retained/,'events of an unfinished job stay');
  await rejects(run('DELETE FROM job_journal WHERE id=?',id),/job_journal_retained/);await rejects(run('DELETE FROM job_outbox WHERE job_id=?',id),/job_outbox_retained/);
  const delivery=await m.jobDelivery(A,ownerA,id);
  await rejects(run("UPDATE job_outbox SET job_id=? WHERE delivery_id=?",key('x'),delivery.deliveryId),/job_outbox_identity/);await rejects(run("UPDATE job_outbox SET envelope_digest=? WHERE delivery_id=?",'e'.repeat(64),delivery.deliveryId),/job_outbox_identity/);
  await rejects(run("INSERT INTO job_outbox(delivery_id,job_id,envelope_digest) VALUES(?,?,?)",crypto.randomUUID(),key('forge-2'),'a'.repeat(64)),/job_outbox_new|FOREIGN|UNIQUE/);
  await m.acknowledgeDelivery(A,ownerB,delivery.deliveryId,50);assert.equal((await m.jobDelivery(A,ownerA,id)).acknowledgedAt,null,'another owner cannot acknowledge');
  await m.acknowledgeDelivery(A,ownerA,delivery.deliveryId,50);await m.acknowledgeDelivery(B,ownerA,delivery.deliveryId,60);assert.equal((await m.jobDelivery(A,ownerA,id)).acknowledgedAt,50,'set once');
  await rejects(run('UPDATE job_outbox SET acknowledged_at=99 WHERE delivery_id=?',delivery.deliveryId),/job_outbox_identity/);await rejects(run('UPDATE job_outbox SET acknowledged_at=NULL WHERE delivery_id=?',delivery.deliveryId),/job_outbox_identity/);
  assert.equal((await m.readJob(A,ownerA,id)).state,'ready','acknowledging is not completion');
 });
 await check('pruning: only finished jobs older than the retention constant go, with their events and outbox entry; unfinished ones never do',async()=>{
  assert.equal(m.jobJournalRetentionMs,30*24*3600*1000);await m.pruneJobJournal(A,10**13,1000);const day=86400000,t0=1000;
  const finished=async(label,at)=>{await admit(label);const {lease}=await m.claimJob(A,ownerA,key(label),at);const row=await m.beginExternal(A,lease,at+1);await m.settleJob(A,ownerA,key(label),row.attempt_id,'done-'+label,at+2);};
  await finished('prune-old-1',t0);await finished('prune-old-2',t0+1);await finished('prune-fresh',t0+5*day);await inflight('prune-flight',t0);await admit('prune-ready');
  await admit('prune-cancelled');await m.cancelJob(A,ownerA,key('prune-cancelled'),t0);
  const now=t0+31*day;assert.deepEqual(await m.pruneJobJournal(A,now,1),{jobs:1},'bounded');assert.deepEqual(await m.pruneJobJournal(A,now),{jobs:2});
  for(const gone of ['prune-old-1','prune-old-2','prune-cancelled']){assert.equal(await m.readJob(A,ownerA,key(gone)),null,gone);assert.equal((await all('SELECT 1 FROM job_journal_events WHERE job_id=?',key(gone))).length,0);assert.equal((await all('SELECT 1 FROM job_outbox WHERE job_id=?',key(gone))).length,0);}
  for(const kept of ['prune-fresh','prune-flight','prune-ready'])assert.ok(await m.readJob(A,ownerA,key(kept)),kept);
  assert.deepEqual(await m.pruneJobJournal(A,now),{jobs:0});assert.deepEqual(await m.pruneJobJournal(A,t0+60*day+3*day),{jobs:1},'the fresh one ages out 30 days after its last transition');
  assert.ok(await m.readJob(A,ownerA,key('prune-flight')),'an unresolved attempt is held for ever');await rejects(m.pruneJobJournal(A,now,0),/job_invalid/);
 });
 await check('deleting the account removes its journal, even unfinished jobs; the other owner is untouched',async()=>{
  const gone=crypto.randomUUID();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",gone,gone+'@example.test');
  await m.admitJob(A,job('gone-1','platform-email',gone));await m.admitJob(A,job('gone-2','platform-email',gone));
  const {lease}=await m.claimJob(A,gone,key('gone-2'),0);await m.beginExternal(A,lease,1);
  await run('DELETE FROM users WHERE id=?',gone);
  for(const table of ['job_journal','job_outbox','job_journal_events'])assert.equal((await one(`SELECT count(*) n FROM ${table} WHERE ${table==='job_journal'?'owner_user_id':'job_id'} IN (?,?)`,table==='job_journal'?gone:key('gone-1'),table==='job_journal'?gone:key('gone-2'))).n,0,table);
  assert.ok(await m.readJob(A,ownerA,key('prune-ready')),'the other owner is untouched');
 });
 await check('dueJobs: oldest due first, at most perOwner per owner, one purpose, and nothing leased or cancelled',async()=>{
  const owners=[crypto.randomUUID(),crypto.randomUUID()];for(const o of owners)await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",o,o+'@example.test');
  for(let i=0;i<6;i++)await m.admitJob(A,job('due-noisy-'+i,'owner-push',owners[0],100+i));
  await m.admitJob(A,job('due-quiet','owner-push',owners[1],200));await m.admitJob(A,job('due-other','platform-email',owners[1],1));await m.admitJob(A,job('due-future','owner-push',owners[1],10**6));
  await m.claimJob(A,owners[0],key('due-noisy-0'),500);
  const list=await m.dueJobs(A,'owner-push',500,2,25);
  assert.deepEqual(list.map(r=>r.id),[key('due-noisy-1'),key('due-noisy-2'),key('due-quiet')],'the noisy owner shows 2 and a quiet owner still appears');
  assert.equal((await m.dueJobs(A,'owner-push',500,2,1)).length,1);
  assert.deepEqual((await m.dueJobs(A,'owner-push',500+minute,1,25)).map(r=>r.id),[key('due-noisy-0'),key('due-quiet')],'an expired lease is due again');
 });
 await check('journalLane: claims with a D1 lease under the in-memory per-run caps; two overlapping ticks handle each job once; a failing handler does not strand the others',async()=>{
  const owners=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];for(const o of owners)await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",o,o+'@example.test');
  for(let i=0;i<4;i++)await m.admitJob(A,job('lane-a'+i,'deterministic-rule',owners[0]));
  for(let i=0;i<2;i++)await m.admitJob(A,job('lane-b'+i,'deterministic-rule',owners[1]));
  await m.admitJob(A,job('lane-c','deterministic-rule',owners[2]));
  let handled=[];const lane=(client,fail)=>m.journalLane(client,{type:'rules',purpose:'deterministic-rule',now:()=>1000,async handle(row,lease){
   handled.push(row.id);assert.equal(lease.fence,1);assert.equal(row.state,'leased');await new Promise(r=>setTimeout(r,2));if(fail&&row.id===key('lane-d0'))throw Error('HANDLER_FAILED');
   const intent=await m.beginExternal(client,lease,1001);await m.settleJob(client,lease.owner,row.id,intent.attempt_id,'r-'+row.id.slice(0,8),1002);}});
  // Overlapping ticks on two clients: every job handled at most once (a lost D1 claim is skipped).
  await m.dispatchJobs([lane(A,false)]);
  assert.ok(handled.length<=5&&handled.length>=3,'perOwner 2: owner a keeps two of four, others are served: '+handled.length);
  assert.equal(handled.filter(id=>[0,1,2,3].some(i=>id===key('lane-a'+i))).length,2);assert.equal(new Set(handled).size,handled.length);
  const before=handled.length;
  await Promise.all([m.dispatchJobs([lane(A,false)]),m.dispatchJobs([lane(B,false)])]);
  assert.equal(new Set(handled).size,handled.length,'no job was handled twice across two ticks');assert.equal(handled.length,before+2,'the next tick takes owner a\'s other two');
  assert.equal((await all("SELECT 1 FROM job_journal WHERE purpose='deterministic-rule' AND state='complete'")).length,7);
  // A throwing handler leaves its job leased (retried after the lease expires); the rest of the tick still runs and the failure escapes raw.
  for(let i=0;i<2;i++)await m.admitJob(A,job('lane-d'+i,'deterministic-rule',owners[1]));
  handled=[];await assert.rejects(m.dispatchJobs([lane(A,true)]),/HANDLER_FAILED/);
  assert.equal(handled.length,2);assert.equal((await m.readJob(A,owners[1],key('lane-d0'))).state,'leased');assert.equal((await m.readJob(A,owners[1],key('lane-d1'))).state,'complete');
  for(const id of handled){const row=await one('SELECT state FROM job_journal WHERE id=?',id);assert.ok(['leased','complete'].includes(row.state));}
 });
 console.log(`Job journal: ${cases} cases passed on ${d1?'local D1':'SQLite (two connections)'}; admission, two claimers, stale fences, lost settle replies, uncertain and operator lanes, atomic chunks, forged writes, pruning and the journal lane. No provider call.`);
}finally{for(const f of files)f.close();await fixture.close?.();if(directory)await rm(directory,{recursive:true,force:true});}

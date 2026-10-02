import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobJournalPrototype} from '../tools/prototypes/job-journal.mjs';
import {jobEnvelopeFixture,jobFixtureId as key,ownerA,ownerB} from './fixtures/job-envelope.mjs';

// Disposable file-backed SQLite proves recovery across closed connections.
// No production schema, credentials, real content or provider requests.
const directory=await mkdtemp(join(tmpdir(),'whumpo-job-prototype-'));
let db,journal,second;
const open=()=>{db=new DatabaseSync(join(directory,'jobs.sqlite'));journal=new JobJournalPrototype(db);journal.initialize();};
const job=jobEnvelopeFixture;
try {
  open();
  const original=journal.enqueue(job('effect-1'));
  assert.deepEqual(journal.enqueue(job('effect-1')),original);
  const altered=job('effect-1');altered.intent.inputDigest='b'.repeat(64);assert.throws(()=>journal.enqueue(altered));
  assert.throws(()=>journal.enqueue(job('effect-1','platform-email',ownerB)));
  assert.equal(journal.read(ownerB,key('effect-1')),null);
  assert.equal(journal.claim(ownerB,key('effect-1'),0),null);
  const first=journal.claim(ownerA,key('effect-1'),0);
  second=new DatabaseSync(join(directory,'jobs.sqlite'));
  const competing=new JobJournalPrototype(second);
  assert.equal(competing.claim(ownerA,key('effect-1'),1),null);
  const renewed=competing.claim(ownerA,key('effect-1'),60000);
  assert.equal(renewed.fence,first.fence+1);
  assert.throws(()=>journal.beginExternal(first,60001));
  let providerCalls=0;
  const fakeSubmit=(runner,claim,now)=>{
    const intent=runner.beginExternal(claim,now);
    providerCalls++;
    return intent; // Fake remote effect happened; reply was lost.
  };
  const intent=fakeSubmit(competing,renewed,60001);
  second.close();second=null;db.close();open();
  assert.equal(journal.recoverExpired(120001),1);
  assert.equal(journal.read(ownerA,key('effect-1')).state,'uncertain');
  assert.equal(journal.claim(ownerA,key('effect-1'),200000),null);
  assert.throws(()=>fakeSubmit(journal,renewed,200000));
  assert.equal(providerCalls,1);
  assert.throws(()=>journal.recordExternal(ownerB,key('effect-1'),intent.attempt_id,'receipt',200001));
  assert.throws(()=>journal.recordExternal(ownerA,key('effect-1'),'wrong-operation','receipt',200001));
  const result=journal.recordExternal(ownerA,key('effect-1'),intent.attempt_id,'provider-receipt',200001);
  assert.equal(result.state,'complete');
  // Persisted result followed by lost acknowledgement: no second effect.
  db.close();open();
  assert.deepEqual(journal.recordExternal(ownerA,key('effect-1'),intent.attempt_id,'provider-receipt',200002),result);
  assert.throws(()=>journal.recordExternal(ownerA,key('effect-1'),intent.attempt_id,'conflicting-receipt',200002));
  assert.equal(journal.claim(ownerA,key('effect-1'),999999),null);

  // A failed result receipt rolls back the state transition. Retry recording
  // the known provider result, never the remote submission.
  journal.enqueue(job('result-rollback'));
  const pendingResult=fakeSubmit(journal,journal.claim(ownerA,key('result-rollback'),0),1);
  db.exec("CREATE TRIGGER reject_fixture_receipt BEFORE INSERT ON prototype_events WHEN NEW.event='external_result' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
  assert.throws(()=>journal.recordExternal(ownerA,key('result-rollback'),pendingResult.attempt_id,'valid-result',2),/synthetic receipt failure/);
  assert.equal(journal.read(ownerA,key('result-rollback')).state,'awaiting');
  assert.equal(journal.read(ownerA,key('result-rollback')).result_ref,null);
  db.exec('DROP TRIGGER reject_fixture_receipt');
  assert.equal(journal.recordExternal(ownerA,key('result-rollback'),pendingResult.attempt_id,'valid-result',3).state,'complete');
  assert.equal(providerCalls,2);

  // Cancellation invalidates a claimed sender; in-flight work remains held.
  journal.enqueue(job('cancel-before'));
  const before=journal.claim(ownerA,key('cancel-before'),0);
  journal.cancel(ownerA,key('cancel-before'),1);
  assert.throws(()=>journal.beginExternal(before,2));
  journal.enqueue(job('cancel-after'));
  const after=journal.beginExternal(journal.claim(ownerA,key('cancel-after'),0),1);
  journal.cancel(ownerA,key('cancel-after'),2);
  assert.equal(journal.read(ownerA,key('cancel-after')).state,'awaiting');
  journal.recoverExpired(60001);
  assert.equal(journal.claim(ownerA,key('cancel-after'),70000),null);
  assert.equal(journal.recordExternal(ownerA,key('cancel-after'),after.attempt_id,'remote-still-happened',70001).state,'cancelled');
  assert.equal(journal.read(ownerA,key('cancel-after')).result_ref,'remote-still-happened');

  // Only fixture proof of a definitely-unsent operation can schedule a new
  // attempt. Backoff, attempt exhaustion and stale reply isolation are durable.
  journal.enqueue(job('retry'));
  let now=0,previousOperation;
  for (let attempt=1;attempt<=3;attempt++) {
    const pending=journal.beginExternal(journal.claim(ownerA,key('retry'),now),now);
    if(previousOperation)assert.throws(()=>journal.recordExternal(ownerA,key('retry'),previousOperation,'late',now));
    previousOperation=pending.attempt_id;
    const retry=journal.confirmNotSent(ownerA,key('retry'),pending.attempt_id,'fixture-proved-no-send',now+1);
    assert.equal(retry.attempt,attempt);
    assert.equal(retry.state,attempt===3?'operator':'ready');
    assert.equal(journal.claim(ownerA,key('retry'),retry.due-1),null);
    now=retry.due;
  }
  assert.equal(journal.claim(ownerA,key('retry'),now),null);

  // Synthetic cleanup chunks cannot erase owner B. Crash/rollback, acknowledgement
  // loss and cancellation are injected at the real transaction boundaries.
  db.exec('CREATE TABLE private_fixture(owner TEXT,id INTEGER,PRIMARY KEY(owner,id))');
  for (const owner of [ownerA,ownerB])for(let id=1;id<=5;id++)db.prepare('INSERT INTO private_fixture VALUES(?,?)').run(owner,id);
  journal.enqueue(job('cleanup','account-cleanup'));
  let chunk=journal.claim(ownerA,key('cleanup'),0);
  assert.throws(()=>journal.commitChunk(chunk,2,false,1,sql=>{
    sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,2);
    throw Error('synthetic crash before commit');
  }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture').get().n,10);
  assert.equal(journal.read(ownerA,key('cleanup')).cursor,0);
  journal.commitChunk(chunk,2,false,2,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,2));
  db.close();open(); // Response lost after commit; resume using saved cursor.
  assert.equal(journal.read(ownerA,key('cleanup')).cursor,2);
  assert.throws(()=>journal.commitChunk(chunk,2,false,3,()=>assert.fail('stale chunk ran')));
  chunk=journal.claim(ownerA,key('cleanup'),3);
  journal.commitChunk(chunk,4,false,4,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,4));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture WHERE owner=?').get(ownerB).n,5);
  chunk=journal.claim(ownerA,key('cleanup'),5);
  journal.cancel(ownerA,key('cleanup'),6);
  assert.throws(()=>journal.commitChunk(chunk,5,true,7,()=>assert.fail('cancelled chunk ran')));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture WHERE owner=?').get(ownerA).n,1);

  journal.enqueue(job('cleanup-complete','account-cleanup'));
  chunk=journal.claim(ownerA,key('cleanup-complete'),8);
  journal.commitChunk(chunk,5,true,9,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=?').run(chunk.owner));
  assert.equal(journal.read(ownerA,key('cleanup-complete')).state,'complete');
  assert.equal(journal.claim(ownerA,key('cleanup-complete'),10),null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture').get().n,5);
  assert.throws(()=>db.prepare('UPDATE prototype_jobs SET owner=? WHERE id=?').run(ownerB,key('cleanup')),/immutable job identity/);
  assert.throws(()=>db.exec("UPDATE prototype_events SET event='changed'"),/immutable receipt/);
  assert.throws(()=>db.exec('DELETE FROM prototype_events'),/immutable receipt/);
  // One envelope/outbox transaction, duplicate wake delivery and acknowledgement loss.
  const delivered=job('delivery','owner-push');journal.enqueue(delivered);
  const wake=journal.delivery(ownerA,delivered.jobId);assert.ok(wake);
  assert.equal(journal.delivery(ownerB,delivered.jobId),null);
  assert.throws(()=>journal.claimDelivery(ownerA,null,0),e=>e.code==='invalid_job');
  assert.throws(()=>journal.claimDelivery(ownerB,wake,0));
  assert.throws(()=>journal.claimDelivery(ownerA,{...wake,envelopeDigest:'b'.repeat(64)},0));
  journal.acknowledgeDelivery(ownerA,wake,1);
  db.close();open();
  assert.deepEqual(journal.delivery(ownerA,delivered.jobId),wake);
  journal.acknowledgeDelivery(ownerA,wake,2); // Lost acknowledgement: same delivery identity.
  assert.equal(journal.read(ownerA,delivered.jobId).state,'ready');
  const waking=journal.claimDelivery(ownerA,wake,2);assert.ok(waking);
  assert.equal(journal.claimDelivery(ownerA,wake,3),null);
  const dispatched=journal.beginExternal(waking,3);
  journal.recoverExpired(60003);
  assert.equal(journal.claimDelivery(ownerA,wake,60004),null);
  journal.recordExternal(ownerA,delivered.jobId,dispatched.attempt_id,'push-receipt',60005);
  assert.equal(journal.claimDelivery(ownerA,wake,60006),null);
  const drift=structuredClone(delivered);drift.actor.policyRevision++;
  assert.throws(()=>journal.enqueue(drift));
  assert.throws(()=>db.exec('UPDATE prototype_outbox SET envelope_digest=lower(hex(randomblob(32)))'),/immutable delivery identity/);
  db.exec("CREATE TRIGGER reject_enqueue BEFORE INSERT ON prototype_events WHEN NEW.event='enqueued' BEGIN SELECT RAISE(ABORT,'fixture enqueue failure'); END");
  const rollback=job('enqueue-rollback');assert.throws(()=>journal.enqueue(rollback),/fixture enqueue failure/);
  assert.equal(journal.read(ownerA,rollback.jobId),null);assert.equal(journal.delivery(ownerA,rollback.jobId),null);
  db.exec('DROP TRIGGER reject_enqueue');
  // Expired pre-dispatch work stops; expiration never erases an uncertain effect.
  const expires=job('expired'),inFlight=job('expired-in-flight');
  expires.schedule.expiresAt=10;inFlight.schedule.expiresAt=10;
  journal.enqueue(expires);journal.enqueue(inFlight);
  const stopped=journal.claim(ownerA,expires.jobId,0);
  const late=journal.beginExternal(journal.claim(ownerA,inFlight.jobId,0,5),1);
  journal.recoverExpired(11);
  assert.equal(journal.read(ownerA,expires.jobId).state,'expired');
  assert.throws(()=>journal.beginExternal(stopped,11));
  assert.equal(journal.read(ownerA,inFlight.jobId).state,'uncertain');
  assert.equal(journal.claim(ownerA,inFlight.jobId,11),null);
  assert.equal(journal.recordExternal(ownerA,inFlight.jobId,late.attempt_id,'late-receipt',12).state,'complete');
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM prototype_jobs WHERE state='ready' AND due<=? ORDER BY due,id LIMIT 10").all(10000);
  assert.match(JSON.stringify(plan),/prototype_due/);
  console.log('Job journal prototype passed: current envelopes, atomic outbox/replay, durable restart, competing claims/fencing, unknown external effects, cancellation/expiry, bounded retries, immutable receipts and tenant-scoped cleanup chunks. Local SQLite only; no scanner or provider calls.');
} finally { second?.close();db?.close();await rm(directory,{recursive:true,force:true}); }

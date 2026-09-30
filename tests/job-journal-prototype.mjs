import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobJournalPrototype} from '../tools/prototypes/job-journal.mjs';

// Disposable file-backed SQLite proves recovery across closed connections.
// No production schema, credentials, real content or provider requests.
const directory=await mkdtemp(join(tmpdir(),'whumpo-job-prototype-'));
let db,journal,second;
const open=()=>{db=new DatabaseSync(join(directory,'jobs.sqlite'));journal=new JobJournalPrototype(db);journal.initialize();};
const job=(id,kind='scan',owner='owner-a',due=0)=>({id,owner,kind,contextHash:'a'.repeat(64),due});
try {
  open();
  const original=journal.enqueue(job('scan-1'));
  assert.deepEqual(journal.enqueue(job('scan-1')),original);
  assert.throws(()=>journal.enqueue({...job('scan-1'),contextHash:'b'.repeat(64)}));
  assert.throws(()=>journal.enqueue(job('scan-1','scan','owner-b')));
  assert.equal(journal.read('owner-b','scan-1'),null);
  assert.equal(journal.claim('owner-b','scan-1',0),null);
  const first=journal.claim('owner-a','scan-1',0);
  second=new DatabaseSync(join(directory,'jobs.sqlite'));
  const competing=new JobJournalPrototype(second);
  assert.equal(competing.claim('owner-a','scan-1',1),null);
  const renewed=competing.claim('owner-a','scan-1',60000);
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
  assert.equal(journal.read('owner-a','scan-1').state,'uncertain');
  assert.equal(journal.claim('owner-a','scan-1',200000),null);
  assert.throws(()=>fakeSubmit(journal,renewed,200000));
  assert.equal(providerCalls,1);
  assert.throws(()=>journal.recordExternal('owner-b','scan-1',intent.operation,'receipt',200001));
  assert.throws(()=>journal.recordExternal('owner-a','scan-1','wrong-operation','receipt',200001));
  const result=journal.recordExternal('owner-a','scan-1',intent.operation,'provider-receipt',200001);
  assert.equal(result.state,'complete');
  // Persisted result followed by lost acknowledgement: no second effect.
  db.close();open();
  assert.deepEqual(journal.recordExternal('owner-a','scan-1',intent.operation,'provider-receipt',200002),result);
  assert.throws(()=>journal.recordExternal('owner-a','scan-1',intent.operation,'conflicting-receipt',200002));
  assert.equal(journal.claim('owner-a','scan-1',999999),null);

  // A failed result receipt rolls back the state transition. Retry recording
  // the known provider result, never the remote submission.
  journal.enqueue(job('result-rollback'));
  const pendingResult=fakeSubmit(journal,journal.claim('owner-a','result-rollback',0),1);
  db.exec("CREATE TRIGGER reject_fixture_receipt BEFORE INSERT ON prototype_events WHEN NEW.event='external_result' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END");
  assert.throws(()=>journal.recordExternal('owner-a','result-rollback',pendingResult.operation,'valid-result',2),/synthetic receipt failure/);
  assert.equal(journal.read('owner-a','result-rollback').state,'awaiting');
  assert.equal(journal.read('owner-a','result-rollback').result_ref,null);
  db.exec('DROP TRIGGER reject_fixture_receipt');
  assert.equal(journal.recordExternal('owner-a','result-rollback',pendingResult.operation,'valid-result',3).state,'complete');
  assert.equal(providerCalls,2);

  // Cancellation invalidates a claimed sender; in-flight work remains held.
  journal.enqueue(job('cancel-before'));
  const before=journal.claim('owner-a','cancel-before',0);
  journal.cancel('owner-a','cancel-before',1);
  assert.throws(()=>journal.beginExternal(before,2));
  journal.enqueue(job('cancel-after'));
  const after=journal.beginExternal(journal.claim('owner-a','cancel-after',0),1);
  journal.cancel('owner-a','cancel-after',2);
  assert.equal(journal.read('owner-a','cancel-after').state,'awaiting');
  journal.recoverExpired(60001);
  assert.equal(journal.claim('owner-a','cancel-after',70000),null);
  assert.equal(journal.recordExternal('owner-a','cancel-after',after.operation,'remote-still-happened',70001).state,'cancelled');
  assert.equal(journal.read('owner-a','cancel-after').result_ref,'remote-still-happened');

  // Only fixture proof of a definitely-unsent operation can schedule a new
  // attempt. Backoff, attempt exhaustion and stale reply isolation are durable.
  journal.enqueue(job('retry'));
  let now=0,previousOperation;
  for (let attempt=1;attempt<=3;attempt++) {
    const pending=journal.beginExternal(journal.claim('owner-a','retry',now),now);
    if(previousOperation)assert.throws(()=>journal.recordExternal('owner-a','retry',previousOperation,'late',now));
    previousOperation=pending.operation;
    const retry=journal.confirmNotSent('owner-a','retry',pending.operation,'fixture-proved-no-send',now+1);
    assert.equal(retry.attempt,attempt);
    assert.equal(retry.state,attempt===3?'operator':'ready');
    assert.equal(journal.claim('owner-a','retry',retry.due-1),null);
    now=retry.due;
  }
  assert.equal(journal.claim('owner-a','retry',now),null);

  // Local closure chunks cannot erase owner B. Crash/rollback, acknowledgement
  // loss and cancellation are injected at the real transaction boundaries.
  db.exec('CREATE TABLE private_fixture(owner TEXT,id INTEGER,PRIMARY KEY(owner,id))');
  for (const owner of ['owner-a','owner-b'])for(let id=1;id<=5;id++)db.prepare('INSERT INTO private_fixture VALUES(?,?)').run(owner,id);
  journal.enqueue(job('cleanup','cleanup'));
  let chunk=journal.claim('owner-a','cleanup',0);
  assert.throws(()=>journal.commitChunk(chunk,2,false,1,sql=>{
    sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,2);
    throw Error('synthetic crash before commit');
  }));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture').get().n,10);
  assert.equal(journal.read('owner-a','cleanup').cursor,0);
  journal.commitChunk(chunk,2,false,2,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,2));
  db.close();open(); // Response lost after commit; resume using saved cursor.
  assert.equal(journal.read('owner-a','cleanup').cursor,2);
  assert.throws(()=>journal.commitChunk(chunk,2,false,3,()=>assert.fail('stale chunk ran')));
  chunk=journal.claim('owner-a','cleanup',3);
  journal.commitChunk(chunk,4,false,4,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=? AND id<=?').run(chunk.owner,4));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM private_fixture WHERE owner='owner-b'").get().n,5);
  chunk=journal.claim('owner-a','cleanup',5);
  journal.cancel('owner-a','cleanup',6);
  assert.throws(()=>journal.commitChunk(chunk,5,true,7,()=>assert.fail('cancelled chunk ran')));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM private_fixture WHERE owner='owner-a'").get().n,1);

  journal.enqueue(job('cleanup-complete','cleanup'));
  chunk=journal.claim('owner-a','cleanup-complete',8);
  journal.commitChunk(chunk,5,true,9,sql=>sql.prepare('DELETE FROM private_fixture WHERE owner=?').run(chunk.owner));
  assert.equal(journal.read('owner-a','cleanup-complete').state,'complete');
  assert.equal(journal.claim('owner-a','cleanup-complete',10),null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_fixture').get().n,5);
  assert.throws(()=>db.exec("UPDATE prototype_jobs SET owner='owner-b' WHERE id='cleanup'"),/immutable job identity/);
  assert.throws(()=>db.exec("UPDATE prototype_events SET event='changed'"),/immutable receipt/);
  assert.throws(()=>db.exec('DELETE FROM prototype_events'),/immutable receipt/);
  const plan=db.prepare("EXPLAIN QUERY PLAN SELECT id FROM prototype_jobs WHERE state='ready' AND due<=? ORDER BY due,id LIMIT 10").all(10000);
  assert.match(JSON.stringify(plan),/prototype_due/);
  console.log('Job journal prototype passed: durable restart, competing claims/fencing, unknown external effects, replay, cancellation, bounded retries, immutable receipts and atomic tenant-scoped cleanup chunks. Local SQLite only.');
} finally { second?.close();db?.close();await rm(directory,{recursive:true,force:true}); }

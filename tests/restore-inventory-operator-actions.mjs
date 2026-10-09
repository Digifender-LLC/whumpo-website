import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {containmentHarness,realInventory,withoutTriggers,actionIdAged,aid,DAY,REASON,OPERATOR} from './helpers/containment-world.mjs';

// WH-050 operator actions through the WH-008 restore inventory: the real `stop-serving`, `lift`, `close` and `cleanup` actions of
// tools/operator-containment-input.mjs against the merged current schema. `serving` is a scope value of operator_containments, not a
// table. Companion scripts: tests/restore-inventory-containment.mjs (WH-008 authority-table derivation) and
// tests/restore-inventory-retention.mjs (kept rows, receipts, session revocation, the 512-event bound and action-ID reuse); split only
// to keep each script inside the 300 s per-script gate timeout. Every operator action goes through the real preview-then-apply path.
// The shared real-SQLite harness, its source authority and its FIXTURE-ONLY rules are described in tests/helpers/containment-world.mjs.
const harness=await containmentHarness('restore inventory operator serving stop and cleanup evidence'),{world,counts}=harness;

try{
 // 1. Real 90-day cleanup of the lifted, aged stop: observed first, unobserved, or after the fresh archive (the observed-first order is section 4).
 //    Final outcomes cannot depend on the order (the event counts do: an unobserved row leaves one event fewer). Aging is FIXTURE-ONLY
 //    and gives the row an id minted for its creation time.
 {
  const variants={'cleanup then old first':['cleanup','A0','A1'],'fresh first, cleanup, old then fresh':['A1','cleanup','A0','A1']};
  const finals=new Map();
  for(const [name,steps] of Object.entries(variants)){
   const w=await world('order-cleanup-'+name.replaceAll(' ','-').replaceAll(',','')),a0=await w.register(),s=await w.stopServing(w.projectId);
   await w.lift(s);await w.age(s,100*DAY);const a1=await w.register();
   for(const step of steps){
    if(step==='cleanup')await w.cleanup();else await w.outcome(step==='A0'?a0:a1);
   }
   finals.set(name,{A0:await w.outcome(a0),A1:await w.outcome(a1)});
   await w.close();
  }
  for(const [name,final] of finals)assert.deepEqual(final,{A0:'verified',A1:'suppressed-record'},name);
  counts.holds+=finals.size;counts.verifications+=finals.size;
 }

 // 2. WH-050 serving stop: the real stop-serving tool after an archive, then lift and close. An unpublished draft project can be
 //    stopped, so no site publication is needed.
 {
  const w=await world('serving'),a0=await w.register();
  await w.verified(a0);
  const s1=await w.stopServing(w.projectId);
  const stored=await w.db.prepare('SELECT scope,subject_kind,subject_id,allowance FROM operator_containments WHERE id=?').bind(s1).first();
  assert.equal(stored.scope,'serving');assert.equal(stored.subject_kind,'project');assert.equal(stored.subject_id,w.projectId);assert.equal(stored.allowance,null);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  const first=await w.evidence(a0);
  assert.deepEqual(first.events.map(e=>e.kind),['record-current']);
  assert.deepEqual(first.events[0].data.key,{id:s1,scope:'serving'});assert.deepEqual(Object.keys(first.events[0].data),['table','key','sha256']);
  const bytes=await readFile(w.file);
  for(const secret of [REASON,OPERATOR]){assert.ok(!JSON.stringify(first).includes(secret));assert.ok(!bytes.includes(Buffer.from(secret)));}
  // A point taken after the stop contains it: verified, no new event. A second concurrent stop of the project is refused by the tool.
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),1);
  await assert.rejects(w.stopServing(w.projectId),/already stopped/);assert.equal(await w.events(),1);
  // Lift while active changes the row digest: both archives hold, one event, and a point taken after the lift verifies.
  await w.lift(s1);
  await w.held(a1,'stale-authority');await w.held(a0,'stale-authority');assert.equal(await w.events(),2);
  const a2=await w.register();await w.verified(a2);assert.equal(await w.events(),2);
  // A real expiry (a +2 s stop; the admission trigger admits only a future expiry) changes no column: the archive that contains the
  // stop still verifies, while an archive lacking an expired-but-unclosed stop still holds. The reviewed close then changes the digest.
  // FIXTURE-ONLY: the +2 s stop is a direct insert through the admit trigger (a fresh action id, not the operator tool).
  const s2=aid();
  await w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'serving','project',?,NULL,'human:fixture','Short expiry',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 seconds'))").bind(s2,w.projectId,'d'.repeat(64)).run();
  const a3=await w.register();
  await new Promise(resolve=>setTimeout(resolve,2400));
  assert.equal((await w.db.prepare("SELECT count(*) AS n FROM operator_containments WHERE id=? AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND resolved_at IS NULL").bind(s2).first()).n,1,'The stop really expired and is unresolved');
  await w.verified(a3);assert.equal(await w.events(),2);
  await w.held(a2,'stale-authority');assert.equal(await w.events(),3);
  await w.closeAction(s2);
  assert.equal((await w.db.prepare('SELECT resolution FROM operator_containments WHERE id=?').bind(s2).first()).resolution,'closed');
  await w.held(a3,'stale-authority');await w.held(a2,'stale-authority');assert.equal(await w.events(),4);
  const a4=await w.register();await w.verified(a4);assert.equal(await w.events(),4);
  // A five-scope containment is five rows and therefore five events (the 512-event bound counts rows, not actions).
  await w.contain({kind:'project',id:w.projectId},{backend:'freeze',transition:'freeze',contact:'freeze',photo:'freeze',build:'freeze'});
  await w.held(a4,'stale-authority');assert.equal(await w.events(),9);
  await w.close();
 }

 // 3. One row, three events: a single stop observed unresolved, then closed (a changed digest), then cleaned (a suppression). The row is a
 //    FIXTURE-ONLY creation (the admit trigger admits only rows created now) carrying an id minted for its creation time, so it keeps one
 //    identity throughout; its real close is the tool, and only the resolution instant is then moved past 90 days (one UPDATE, no id change).
 {
  const w=await world('row-lifecycle'),a0=await w.register(),created=Date.now()-110*DAY,sid=actionIdAged(110*DAY);
  await withoutTriggers(w.db,['operator_containment_admit'],()=>w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,created_at,expires_at) VALUES(?,'serving','project',?,NULL,'human:fixture','Aged unresolved stop',?,?,?)")
   .bind(sid,w.projectId,'a'.repeat(64),new Date(created).toISOString(),new Date(Date.now()-100*DAY).toISOString()).run());
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1,'Event 1: the row observed unresolved');
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),1);
  await w.closeAction(sid);
  await w.rewrite('operator_containment_resolve','UPDATE operator_containments SET resolved_at=? WHERE id=?',new Date(Date.now()-95*DAY).toISOString(),sid);
  await w.held(a1,'stale-authority');assert.equal(await w.events(),2,'Event 2: the resolved digest');
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:1,revocations:0,receipts:0});assert.equal(await w.present(sid),0);
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),3,'Event 3: the deletion');
  const row=(await w.evidence(a1)).events;
  assert.deepEqual(row.map(e=>e.kind),['record-current','record-current','record-suppressed']);
  for(const e of row)assert.deepEqual(e.data.key,{id:sid,scope:'serving'});
  assert.notEqual(row[0].data.sha256,row[1].data.sha256);
  await w.verified(a0);assert.equal(await w.events(),3);
  await w.close();
 }

 // 4. Real 90-day cleanup of an OBSERVED resolved stop. The only synthetic input is the row's age (FIXTURE-ONLY `age`, id included).
 {
  const w=await world('cleanup-observed'),a0=await w.register(),sequence=[];
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  const a1=await w.register(); // contains the aged resolved stop
  await w.held(a0,'stale-authority');sequence.push(await w.events());
  await w.verified(a1);sequence.push(await w.events());
  const preview=await w.cleanupPreview();
  assert.deepEqual(preview.delete,{containments:1,revocations:0,receipts:0});
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:1,revocations:0,receipts:0});
  assert.equal(await w.present(s),0,'The receipt trigger deleted the listed stop');
  // The observed row is now observed-absent: an archive that never had it verifies; the one that contained it holds permanently.
  await w.verified(a0);sequence.push(await w.events());
  assert.deepEqual((await w.evidence(a0)).events.map(e=>e.kind),['record-current','record-suppressed']);
  await w.held(a1,'suppressed-record');sequence.push(await w.events());
  assert.deepEqual(sequence,[1,1,2,2],'Events only grow; the deletion is one more event, never a freed slot');
  // A point taken after the cleanup lacks the row and holds the cleanup receipt (not a watched authority table): it verifies.
  const a2=await w.register();await w.verified(a2);assert.equal(await w.events(),2);
  assert.ok(!(await readFile(w.file)).includes(Buffer.from(REASON)));
  await w.close();
 }

 // 5. Real cleanup with NO evidence run in between leaves no history. Stated residual: operators must run evidence for every
 //    registered archive before applying cleanup or session revocation; nothing enforces it.
 {
  const w=await world('cleanup-unobserved'),a0=await w.register();
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  const a1=await w.register();
  await w.cleanup();assert.equal(await w.present(s),0);
  await w.verified(a0);assert.equal(await w.events(),0,'No trace was recorded: the older archive verifies (an expired record only)');
  // The archive that contained the resolved row still holds, because its own record is watched. Cleanup invalidates old archives.
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),1);
  assert.deepEqual((await w.evidence(a1)).events.map(e=>e.kind),['record-suppressed']);
  await w.close();
 }

 // 6. Negative canary for the serving scope: against a copy of the inventory module with the declared set emptied, the old archive
 //    verifies even though a serving stop exists. (The containment canary is in tests/restore-inventory-containment.mjs.)
 {
  const scenario=async module=>{
   const w=await world('canary-serving',module),a0=await w.register();
   await w.stopServing(w.projectId);
   const result=await w.outcome(a0);await w.close();return result;
  };
  assert.equal(await scenario(realInventory),'stale-authority');
  const canary=await harness.emptiedInventory();
  try{assert.equal(await scenario(canary.module),'verified','Without derivation the old archive verifies, with a serving stop: the gap this suite pins');}finally{await canary.cleanup();}
 }
 harness.finish({});
}finally{await harness.dispose();}

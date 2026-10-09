import assert from 'node:assert/strict';
import {containmentHarness,withoutTriggers,newActionId,runContainment,aid,hours,iso,DAY,REASON,OPERATOR} from './helpers/containment-world.mjs';

// WH-050 retention, session revocation and action-ID identity through the WH-008 restore inventory: rows cleanup must keep, receipts, the
// exact 90-day boundary, session revocation, the cumulative 512-event bound after cleanup, and the refusal of a reused action ID after
// cleanup. Companion scripts: tests/restore-inventory-containment.mjs (WH-008 authority-table derivation) and
// tests/restore-inventory-operator-actions.mjs (serving stop, lift, close and cleanup ordering); split only to keep each script inside
// the 300 s per-script gate timeout. Every operator action goes through the real preview-then-apply path.
// The shared real-SQLite harness, its source authority and its FIXTURE-ONLY rules are described in tests/helpers/containment-world.mjs.
const harness=await containmentHarness('restore inventory operator retention and action identity evidence'),{world,counts}=harness;
const FRESH_ID=/new UUIDv7 minted within the last day/;

try{
 // 1. Rows cleanup must keep: active, expired-but-unresolved, resolved inside 90 days, and safety-held. Direct deletes refuse too.
 //    An unreleased safety hold in the source refuses every evidence request, so the evidence is checked after the release.
 {
  const w=await world('retention-kept'),a0=await w.register(),other=await w.otherOwner(),p3=await w.project(),p5=await w.project();
  const active=await w.contain({kind:'account',id:w.owner.account},{contact:'freeze'});
  let expired=await w.stopServing(w.projectId);expired=await w.expireOld(expired,100*DAY);
  let within=await w.stopServing(p3);await w.lift(within);within=await w.age(within,90*DAY-3600000);
  let heldRow=await w.stopServing(other.projectId);await w.lift(heldRow);heldRow=await w.age(heldRow,100*DAY);
  let eligible=await w.stopServing(p5);await w.lift(eligible);eligible=await w.age(eligible,100*DAY);
  await w.hold(other.account,other.projectId,'hold-containment');
  const preview=await w.cleanupPreview();
  assert.deepEqual(preview.delete,{containments:1,revocations:0,receipts:0});
  assert.deepEqual(preview.retained,{active:1,expiredAwaitingClose:1,resolvedWithinRetention:1,heldBySafety:1,revocationsRetained:0});
  for(const [name,cid] of Object.entries({active,expired,within,heldRow}))
   await assert.rejects(w.db.prepare('DELETE FROM operator_containments WHERE id=?').bind(cid).run(),/operator_containment_immutable/,name);
  assert.deepEqual((await w.cleanup()).receipt.deleted,{containments:1,revocations:0,receipts:0});
  assert.equal(await w.present(eligible),0);for(const cid of [active,expired,within,heldRow])assert.equal(await w.present(cid),1,'kept');
  // The active hold refuses evidence for every archive (the source is unsettled). Nothing is appended and nothing verifies.
  await w.refused(a0);await w.held(a0,'independent-evidence');assert.equal(await w.events(),0);
  await w.release('hold-containment');
  await w.held(a0,'stale-authority');assert.equal(await w.events(),4,'The four kept rows are current; the unobserved cleaned row left no trace');
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),4);
  // Once released, the formerly held row is eligible: the next cleanup deletes it, and the archive that contained it holds.
  assert.deepEqual((await w.cleanup()).receipt.deleted,{containments:1,revocations:0,receipts:0});
  assert.equal(await w.present(heldRow),0);for(const cid of [active,expired,within])assert.equal(await w.present(cid),1);
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),5);
  await w.held(a0,'stale-authority');
  await w.close();
 }

 // 2. The exact 90-day boundary, against the DATABASE clock. Both rows are FIXTURE-ONLY aged with timestamps computed by SQLite
 //    ('now', '-90 days' and a 30 s margin on each side), so no process-clock skew or scheduler stall can flip a case and nothing waits.
 //    Inside the boundary (resolved 90 days minus 30 s ago) the row is kept, whether deleted directly or named by a cutoff; 30 s outside
 //    it, a cutoff at the row's own resolution instant lists exactly that row, and cleanup deletes only it.
 {
  const w=await world('retention-boundary'),pOut=await w.project();
  let inside=await w.stopServing(w.projectId),outside=await w.stopServing(pOut);
  await w.lift(inside);await w.lift(outside);
  inside=await w.ageBySql(inside,['-90 days','+30 seconds'],90*DAY-30000);outside=await w.ageBySql(outside,['-90 days','-30 seconds'],90*DAY+30000);
  const resolvedAt=async cid=>(await w.db.prepare('SELECT resolved_at FROM operator_containments WHERE id=?').bind(cid).first()).resolved_at;
  const gap=async cid=>(await w.db.prepare("SELECT (julianday(strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days'))-julianday(resolved_at))*86400 AS seconds FROM operator_containments WHERE id=?").bind(cid).first()).seconds;
  assert.ok(Math.abs(await gap(inside)+30)<5&&Math.abs(await gap(outside)-30)<5,'The rows sit 30 s either side of the database clock\'s 90-day line');
  await assert.rejects(w.db.prepare('DELETE FROM operator_containments WHERE id=?').bind(inside).run(),/operator_containment_immutable/);
  await assert.rejects(runContainment(w.db,{action:'cleanup',id:aid(),before:await resolvedAt(inside),operator:OPERATOR}),/at least 90 days/,'A cutoff inside 90 days is refused');
  const input={action:'cleanup',id:aid(),before:await resolvedAt(outside),operator:OPERATOR},preview=await runContainment(w.db,input);
  assert.deepEqual(preview.delete,{containments:1,revocations:0,receipts:0});assert.equal(preview.retained.resolvedWithinRetention,1);
  assert.equal((await runContainment(w.db,input,preview.applyDigest)).receipt.deleted.containments,1);
  assert.equal(await w.present(outside),0);assert.equal(await w.present(inside),1,'The row inside the boundary is kept');
  await assert.rejects(w.db.prepare('DELETE FROM operator_containments WHERE id=?').bind(inside).run(),/operator_containment_immutable/);
  await w.close();
 }

 // 3. Cleanup receipts retire older cleanup receipts. Receipts are archive records, so an archive that contains a retired
 //    receipt holds as suppressed-record; the cleanup receipt table is not a watched authority table.
 {
  const w=await world('receipt-retirement'),a0=await w.register();
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  const first=await w.cleanup(); // receipt R1
  const firstId=await w.ageReceipt('operator_retention_receipts',first.id,100*DAY);
  const aR=await w.register(); // contains R1, aged past retention
  await w.verified(aR);await w.verified(a0);assert.equal(await w.events(),0,'A cleanup receipt is not a watched authority row');
  const preview=await w.cleanupPreview();
  assert.deepEqual(preview.delete,{containments:0,revocations:0,receipts:1});assert.equal(preview.receiptCapacity.stored,1);assert.equal(preview.receiptCapacity.afterCleanup,1);
  const second=await w.cleanup();assert.deepEqual(second.receipt.deleted,{containments:0,revocations:0,receipts:1});
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(firstId).first()).n,0);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(second.id).first()).n,1);
  await w.held(aR,'suppressed-record');assert.equal(await w.events(),1);
  await w.verified(a0);
  const aR2=await w.register();await w.verified(aR2);assert.equal(await w.events(),1);
  await w.close();
 }

 // 4. WH-050 session revocation. It deletes identity_sessions rows, which are archive records, so a containing archive holds
 //    as suppressed-record even if no evidence ran before the revocation. auth_epoch and credential_revision are deliberately
 //    unchanged, so stale-identity is NOT a second line of defence. The revocation receipt is not an authority row.
 //    The account has THREE sessions: one in the archive at creation, one added before the archive, and one added after it.
 //    Revocation removes all three, and costs one suppression per ARCHIVED session (two); the session created after the archive
 //    is never in the archive, so it adds no event (the limit this pins).
 {
  const w=await world('revocation'),second=await w.session();
  const a0=await w.register(); // contains the owner's two workspace sessions
  const third=await w.session(); // created after the archive: an ordinary new row, not watched
  await w.verified(a0);assert.equal(await w.events(),0,'A session created after the archive is not watched');
  const identityBefore=await w.db.prepare('SELECT auth_epoch,credential_revision FROM identity_accounts WHERE account_id=?').bind(w.owner.account).first();
  const {id:rid,result}=await w.revoke();
  assert.equal(result.revocation.revokedSessions,3);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM identity_sessions WHERE account_id=?').bind(w.owner.account).first()).n,0);
  const identityAfter=await w.db.prepare('SELECT auth_epoch,credential_revision FROM identity_accounts WHERE account_id=?').bind(w.owner.account).first();
  assert.equal(identityAfter.auth_epoch,identityBefore.auth_epoch);assert.equal(identityAfter.credential_revision,identityBefore.credential_revision);
  // FIXTURE-ONLY: the receipt is aged, and its id re-minted for that age, BEFORE any evidence run. The receipt table is not a watched
  // authority table, so the harness's rename guard could not catch a later rename here: the call order is what keeps it honest.
  const ridAged=await w.ageReceipt('operator_session_revocations',rid,100*DAY);
  // First inspected AFTER the revocation: each archived session record is observed absent, the post-archive one is not named at all.
  await w.held(a0,'suppressed-record');assert.equal(await w.events(),2);
  const evidence=await w.evidence(a0);
  assert.deepEqual(evidence.events.map(e=>e.kind),['record-suppressed','record-suppressed']);
  // Each suppression carries exactly its table and key, nothing else (no reason, operator, digest or other leaked field).
  const byId=(x,y)=>x.key.id<y.key.id?-1:1;
  assert.deepEqual(evidence.events.map(e=>e.data).sort(byId),[w.owner.authority,second.authority].map(sessionId=>({table:'identity_sessions',key:{id:sessionId}})).sort(byId));
  assert.ok(!evidence.events.some(e=>e.data.key.id===third.authority),'No event for the session created after the archive');
  assert.ok(!evidence.events.some(e=>e.kind==='identity-epoch'),'No epoch event: revocation does not advance the identity epoch');
  // An archive taken after the revocation has no sessions and contains the receipt, which is not watched: verified.
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),2);
  // A later sign-in is an ordinary new row: not watched, and a0 is unchanged.
  await w.session();
  await w.held(a0,'suppressed-record');assert.equal(await w.events(),2);
  // Retiring the aged receipt by cleanup holds the archive that contained it.
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:0,revocations:1,receipts:0});
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_session_revocations WHERE id=?').bind(ridAged).first()).n,0);
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),3);
  await w.close();
 }

 // 5. The 512-event bound with the WH-050 actions: cleanup never frees events.
 {
  // 500 observed resolved rows plus 12 active rows exactly fill the stream. One real cleanup of the 500 turns each into a
  // required suppression event: 512 + 500 does not fit, so every evidence request, for every archive, now fails closed
  // with nothing appended. Stated residual: cleanup of observed rows consumes the cumulative bound and can exhaust it.
  const w=await world('cap-cleanup'),a0=await w.register();
  await w.agedBulk(500,100*DAY);await w.bulk(12);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),512);
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:500,revocations:0,receipts:0});
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_containments').first()).n,12);
  await w.refused(a0);await w.held(a0,'independent-evidence');assert.equal(await w.events(),512,'No partial append, no freed slot');
  const a1=await w.register(); // contains only what remains
  await w.refused(a1);await w.held(a1,'independent-evidence');assert.equal(await w.events(),512);
  await w.close();
 }

 // 6. Action-ID reuse after cleanup is REFUSED (WH-050 time-bound UUIDv7 ids). An action id carries its own creation time and the schema
 //    admits a new one only within a day of the database clock; a cleaned row was at least 90 days old, so its id can never return.
 //    Hence nothing can reappear under an identity the inventory has permanently recorded as suppressed, and the stream is not poisoned.
 //    Each refusal uses the SAME old id with an otherwise valid payload (a future expiry, or current state to revoke or clean), through the
 //    tool (preview and apply) and as a direct insert, and each has a fresh-id control that succeeds with the same payload.
 // The three direct inserts, each ONE statement used for both the refusal of an old id and the fresh-id control of the same payload.
 const stopInsert=(w,cid,project)=>w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'serving','project',?,NULL,'human:fixture','Reuse attempt',?,?)").bind(cid,project,'d'.repeat(64),hours(48)).run();
 const revokeInsert=(w,cid)=>w.db.prepare("INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest) SELECT ?,a.account_id,a.auth_epoch,a.credential_revision,(SELECT json_group_array(id) FROM (SELECT id FROM identity_sessions WHERE account_id=a.account_id ORDER BY id)),'human:fixture','Reuse attempt',?,? FROM identity_accounts a WHERE a.account_id=?").bind(cid,'a'.repeat(64),'b'.repeat(64),w.owner.account).run();
 const cleanupInsert=(w,cid,before,stopId)=>w.db.prepare("INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,?,?,'[]','[]',?,?,?)").bind(cid,before,JSON.stringify([stopId+':serving']),OPERATOR,'a'.repeat(64),'b'.repeat(64)).run();
 const stopRequest=(w,cid)=>({action:'stop-serving',id:cid,project:w.projectId,expiresAt:hours(48),operator:OPERATOR,reason:REASON});
 {
  // Observed: an evidence run saw the absence in between, so the identity is a permanent record-suppressed event.
  const w=await world('id-reuse-observed'),a0=await w.register();
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  await w.cleanup();assert.equal(await w.present(s),0);
  await w.verified(a0);assert.equal(await w.events(),2,'The absence was observed: permanent record-suppressed');
  await assert.rejects(w.operate(stopRequest(w,s)),FRESH_ID);
  await assert.rejects(runContainment(w.db,stopRequest(w,s),'f'.repeat(64)),FRESH_ID);
  await assert.rejects(stopInsert(w,s,w.projectId),/operator_containment_invalid/);
  assert.equal(await w.present(s),0);assert.equal(await w.events(),2,'Nothing was written, nothing appended');
  // Control: the same payload under a fresh id is accepted, is an ordinary new current row, and the stream still answers.
  const control=await w.stopServing(w.projectId);assert.equal(await w.present(control),1);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),3);
  assert.deepEqual((await w.evidence(a0)).events.map(e=>e.kind),['record-current','record-suppressed','record-current']);
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),3);
  await w.close();
 }
 {
  // Unobserved: refusal does not depend on evidence timing. No run saw the absence before the reuse attempt.
  const w=await world('id-reuse-unobserved'),a0=await w.register();
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  await w.cleanup();
  await assert.rejects(w.operate(stopRequest(w,s)),FRESH_ID);
  await assert.rejects(stopInsert(w,s,w.projectId),/operator_containment_invalid/);
  assert.equal(await w.present(s),0);assert.equal(await w.events(),1);
  await w.verified(a0);assert.equal(await w.events(),2,'The absence is observed after the refusal, and stays absent');
  const control=await w.stopServing(w.projectId);assert.equal(await w.present(control),1);
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),2);
  await w.close();
 }
 {
  // The other two action tables: a cleaned session-revocation receipt id and a cleaned cleanup receipt id. Both are archive records, deletable
  // by cleanup, with operator-supplied ids, so before the fix they would poison the stream the same way.
  const w=await world('id-reuse-receipts'),account=w.owner.account,other=await w.project();
  let s=await w.stopServing(w.projectId);await w.lift(s);s=await w.age(s,100*DAY);
  const revoked=await w.revoke();const revokeId=await w.ageReceipt('operator_session_revocations',revoked.id,100*DAY);
  const a1=await w.register(); // contains the aged stop and the aged revocation receipt
  const c1=await w.cleanup();assert.deepEqual(c1.receipt.deleted,{containments:1,revocations:1,receipts:0});
  const cleanupId=await w.ageReceipt('operator_retention_receipts',c1.id,100*DAY);
  const a2=await w.register(); // contains the aged cleanup receipt
  const c2=await w.cleanup();assert.deepEqual(c2.receipt.deleted,{containments:0,revocations:0,receipts:1});
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),2,'The stop and the revocation receipt');
  await w.held(a2,'suppressed-record');assert.equal(await w.events(),3,'The retired cleanup receipt');
  // Session revocation: a current session exists, so the payload is valid; the old receipt id is refused, a fresh id is not.
  await w.session();
  const revokeRequest=cid=>({action:'revoke-sessions',id:cid,account,operator:OPERATOR,reason:REASON});
  await assert.rejects(w.operate(revokeRequest(revokeId)),FRESH_ID);
  await assert.rejects(runContainment(w.db,revokeRequest(revokeId),'f'.repeat(64)),FRESH_ID);
  await assert.rejects(revokeInsert(w,revokeId),/operator_revocation_invalid/);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_session_revocations WHERE id=?').bind(revokeId).first()).n,0);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM identity_sessions WHERE account_id=?').bind(account).first()).n,1,'The refused revocation removed nothing');
  // Cleanup: something is eligible, so the payload is valid; the old cleanup-receipt id is refused, a fresh id is not.
  let s3=await w.stopServing(other);await w.lift(s3);s3=await w.age(s3,100*DAY);
  const before=iso(Date.now()-91*DAY),cleanupRequest=cid=>({action:'cleanup',id:cid,before,operator:OPERATOR});
  await assert.rejects(runContainment(w.db,cleanupRequest(cleanupId)),FRESH_ID);
  await assert.rejects(runContainment(w.db,cleanupRequest(cleanupId),'f'.repeat(64)),FRESH_ID);
  await assert.rejects(cleanupInsert(w,cleanupId,before,s3),/operator_retention_invalid/);
  assert.equal(await w.present(s3),1,'The refused cleanup deleted nothing');
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(cleanupId).first()).n,0);
  // Controls: the same payloads under fresh ids succeed, and the inventory has neither refused nor gained an event.
  assert.equal((await w.revoke()).result.revocation.revokedSessions,1);
  assert.deepEqual((await w.cleanup()).receipt.deleted,{containments:1,revocations:0,receipts:0});
  await w.held(a1,'suppressed-record');await w.held(a2,'suppressed-record');assert.equal(await w.events(),3);
  const a3=await w.register();await w.verified(a3);assert.equal(await w.events(),3);
  await w.close();
 }
 {
  // Same-statement controls for the direct inserts above, isolated in a world of their own (no archive, no evidence run, so no inventory
  // side effect): an accepted revocation receipt deletes the account's sessions and an accepted cleanup receipt deletes its listed stop,
  // which would change what the refusal worlds go on to assert. Each statement is the very function the refusals call, with only the id
  // changed to a fresh action id, so those refusals are caused by the id and by nothing else in the payload.
  const w=await world('id-reuse-direct-controls'),account=w.owner.account,other=await w.project();
  const fresh=aid();await stopInsert(w,fresh,w.projectId);
  assert.equal(await w.present(fresh),1,'The direct stop insert is valid with a fresh id');
  const sessions=async()=>(await w.db.prepare('SELECT count(*) AS n FROM identity_sessions WHERE account_id=?').bind(account).first()).n;
  assert.equal(await sessions(),1);
  const freshRevoke=aid();await revokeInsert(w,freshRevoke,account);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_session_revocations WHERE id=?').bind(freshRevoke).first()).n,1,'The direct revocation insert is valid with a fresh id');
  assert.equal(await sessions(),0,'and its apply trigger removed the listed session');
  let s3=await w.stopServing(other);await w.lift(s3);s3=await w.age(s3,100*DAY);
  const freshCleanup=aid();await cleanupInsert(w,freshCleanup,iso(Date.now()-91*DAY),s3);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(freshCleanup).first()).n,1,'The direct cleanup receipt insert is valid with a fresh id');
  assert.equal(await w.present(s3),0,'and its apply trigger deleted the listed stop');
  // The containment update guard is back after aging AND still keys on the id: a valid resolution of an expired, unresolved aged row is
  // refused only when it also renames the row, and accepted without the rename (so the refusal is the id clause, not the resolution).
  let e=await w.stopServing(await w.project());e=await w.expireOld(e,100*DAY);
  const resolve=(rename)=>w.db.prepare(`UPDATE operator_containments SET ${rename?'id=?,':''}resolution='closed',resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_by='human:fixture',resolution_reason='Identity probe',resolution_digest=? WHERE id=?`).bind(...(rename?[aid()]:[]),'c'.repeat(64),e).run();
  await assert.rejects(resolve(true),/operator_containment_immutable/);
  assert.equal((await w.db.prepare('SELECT resolution FROM operator_containments WHERE id=?').bind(e).first()).resolution,null,'The refused rename resolved nothing');
  await resolve(false);
  assert.equal((await w.db.prepare('SELECT resolution FROM operator_containments WHERE id=?').bind(e).first()).resolution,'closed','The same resolution without a rename is accepted');
  await w.close();
 }
 {
  // A stored old action still replays exactly. FIXTURE-ONLY seed, as in tests/operator-containment.mjs: a stop created two days ago (an id
  // minted for then; the admit trigger, which compares with the clock now, is the one guard skipped). Replay inserts nothing and
  // the archive that contains the stop stays verified; only a never-applied request older than a day needs a new id.
  const w=await world('id-replay-stored'),seeded=newActionId(Date.now()-2*DAY),review='a'.repeat(64),request={...stopRequest(w,seeded)};
  await withoutTriggers(w.db,['operator_containment_admit'],()=>w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,created_at,expires_at) VALUES(?,'serving','project',?,NULL,?,?,?,?,?)")
   .bind(seeded,w.projectId,OPERATOR,REASON,review,iso(Date.now()-2*DAY),request.expiresAt).run());
  const a0=await w.register(); // contains the stored two-day-old stop
  assert.equal((await runContainment(w.db,request,review)).replayed,true);assert.equal((await runContainment(w.db,request)).alreadyApplied,true);
  assert.equal(await w.present(seeded),1);
  // The fixture guard fires: an id an archive already names can never be renamed by an aging helper (that would model delete plus insert).
  await assert.rejects(()=>w.age(seeded,100*DAY),/never renamed once an archive or evidence event names it/);assert.equal(await w.present(seeded),1);
  await assert.rejects(runContainment(w.db,{...request,id:newActionId(Date.now()-2*DAY)}),FRESH_ID,'A never-applied two-day-old request needs a new id');
  await w.verified(a0);assert.equal(await w.events(),0,'The replay changed nothing');
  await w.close();
 }
 harness.finish({});
}finally{await harness.dispose();}

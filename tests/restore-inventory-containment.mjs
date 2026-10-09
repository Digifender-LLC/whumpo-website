import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {containmentHarness,realInventory,workspaceFixture,aid} from './helpers/containment-world.mjs';

// WH-008: operator containments created AFTER an archive are current-source-only rows. The inventory watches the fixed
// declared authority tables (restoreAuthorityTables) so a candidate lacking such a row holds as stale-authority, no matter
// which archive is inspected first. This script is the original WH-008 case set (project and account containments); the WH-050
// serving stop, session revocation and 90-day retention cases are tests/restore-inventory-operator-actions.mjs and
// tests/restore-inventory-retention.mjs, split only to keep each script inside the 300 s per-script gate timeout.
// The shared real-SQLite harness, its source authority and its FIXTURE-ONLY rules are described in tests/helpers/containment-world.mjs.
const REASON='PRIVATE_CONTAINMENT_REASON_CANARY',OPERATOR='human:private-containment-operator';
const harness=await containmentHarness('restore inventory operator-containment evidence'),{world,m,counts}=harness;

try{
 assert.deepEqual([...realInventory.restoreAuthorityTables],['operator_containments']);assert.ok(Object.isFrozen(realInventory.restoreAuthorityTables));

 // 1. Source-only project/account containments after the archive hold the old archive; unrelated rows and a fresh archive do not.
 {
  const w=await world('after-archive'),a0=await w.register();
  await w.verified(a0);
  await w.project();await workspaceFixture(w.db,m); // unrelated new ordinary rows: projects, accounts, identity sessions
  await w.verified(a0);assert.equal(await w.events(),0,'Ordinary new rows are never watched');
  const c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'});
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  const c2=await w.contain({kind:'account',id:w.owner.account},{contact:'freeze'});
  await w.held(a0,'stale-authority');assert.equal(await w.events(),2);
  // Repeat evidence is idempotent: no new event, no changed history, a fresh challenge each time.
  const first=await w.evidence(a0),second=await w.evidence(a0);
  assert.deepEqual(second.events,first.events);assert.notEqual(second.challenge,first.challenge);assert.equal(await w.events(),2);
  assert.deepEqual(first.events.map(e=>e.kind),['record-current','record-current']);
  for(const e of first.events){assert.deepEqual(Object.keys(e.data),['table','key','sha256']);assert.equal(e.data.table,'operator_containments');assert.deepEqual(Object.keys(e.data.key),['id','scope']);}
  assert.deepEqual(first.events.map(e=>e.data.key.id).sort(),[c1,c2].sort());
  // Keys and digests only: neither the evidence nor the persisted inventory carries the reason or operator.
  const bytes=await readFile(w.file);
  for(const secret of [REASON,OPERATOR]){assert.ok(!JSON.stringify(first).includes(secret));assert.ok(!bytes.includes(Buffer.from(secret)));}
  // A restarted handle reads the same persisted events and reaches the same outcome.
  const restarted=await w.open();await w.held(a0,'stale-authority',restarted);assert.equal(await w.events(),2);
  // A point taken after the containments contains them. It is unchanged, so it verifies and adds no event.
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),2);
  await w.held(a0,'stale-authority');
  // Lifting changes the row: old and fresh archives both hold, one new event records the lifted digest, and a point taken after the lift verifies.
  await w.lift(c1);
  await w.held(a1,'stale-authority');await w.held(a0,'stale-authority');assert.equal(await w.events(),3);
  await w.held(a1,'stale-authority');assert.equal(await w.events(),3);
  const a2=await w.register();await w.verified(a2);assert.equal(await w.events(),3);
  // The source being lost or unreadable holds instead of reusing recorded events.
  const offline=await w.open(null);await w.held(a2,'independent-evidence',offline);
  const failing=await w.openBreaking();await w.verified(a2,failing.handle);failing.breakSource();await w.held(a2,'independent-evidence',failing.handle);
  await w.close();
 }

 // 2. Inspection order cannot change the outcome for the same known source and candidate.
 {
  const variants={
   'lift then old first':['lift','A0','A1'],'lift then fresh first':['lift','A1','A0'],
   'fresh first, lift, old then fresh':['A1','A0','lift','A0','A1'],'old first, lift, fresh then old':['A0','lift','A1','A0'],
  };
  const finals=new Map();
  for(const [name,steps] of Object.entries(variants)){
   const w=await world('order-'+name.replaceAll(' ','-').replaceAll(',','')),a0=await w.register(),c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'}),a1=await w.register();
   for(const step of steps){
    if(step==='lift')await w.lift(c1);else await w.outcome(step==="A0"?a0:a1);
   }
   finals.set(name,{A0:await w.outcome(a0),A1:await w.outcome(a1)});
   await w.close();
  }
  for(const [name,final] of finals)assert.deepEqual(final,{A0:'stale-authority',A1:'stale-authority'},name);
  counts.holds+=finals.size*2;
 }

 // 3. A lift or an expiry BEFORE the first evidence run still holds the old archive (active-only watching would have verified it).
 {
  const w=await world('lifted-before-inspection'),a0=await w.register();
  const c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'});await w.lift(c1);
  await w.held(a0,'stale-authority');await w.close();
 }
 {
  const w=await world('expired-before-inspection'),a0=await w.register();
  // FIXTURE-ONLY (a direct insert through the admit trigger, not the operator tool): the trigger admits only a future expiry, so use the shortest real one and let it pass.
  await w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Short expiry',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 seconds'))").bind(aid(),w.owner.account,'c'.repeat(64)).run();
  await new Promise(resolve=>setTimeout(resolve,2400));
  assert.equal((await w.db.prepare("SELECT count(*) AS n FROM operator_containments WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND resolved_at IS NULL").first()).n,1,'The row really expired');
  await w.held(a0,'stale-authority');await w.close();
 }

 // 4. Removal (FIXTURE-ONLY): observed and never-observed rows end in the same outcomes; archived rows hold as suppressed-record.
 {
  const w=await world('removal-observed'),a0=await w.register();
  const c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'}),c2=await w.contain({kind:'account',id:w.owner.account},{contact:'freeze'}),a1=await w.register();
  await w.held(a0,'stale-authority');
  await w.fixtureDelete(c1);
  await w.held(a0,'stale-authority'); // c2 is still a current containment the candidate lacks
  await w.held(a1,'suppressed-record');
  await w.fixtureDelete(c2);
  await w.verified(a0); // every observed row is now observed-absent; the candidate never had them
  await w.held(a1,'suppressed-record');
  const kinds=(await w.evidence(a0)).events.map(e=>e.kind);assert.deepEqual(kinds,['record-current','record-current','record-suppressed','record-suppressed']);
  await w.close();
 }
 {
  // Residual, stated honestly: a row created and removed without any evidence run in between leaves no trace, so the old
  // archive verifies. The archive that contained it still holds. Retained resolved rows are what this tree guarantees.
  const w=await world('removal-unobserved'),a0=await w.register();
  const c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'}),a1=await w.register();
  await w.fixtureDelete(c1);
  await w.verified(a0);assert.equal(await w.events(),0);
  await w.held(a1,'suppressed-record');
  await w.close();
 }

 // 5. More relevant rows than the 512-event bound fail closed: no truncation, no partial append, no silent drop.
 {
  const w=await world('overflow'),a0=await w.register();
  await w.bulk(512);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),512);
  await w.bulk(1);
  await w.held(a0,'independent-evidence');assert.equal(await w.events(),512,'The 513th row is refused, not dropped; recorded history is unchanged');
  await w.refused(a0);
  // A point that already contains every row needs no new event and verifies, so the bound only fails closed for older points.
  const fresh=await w.register();await w.verified(fresh);assert.equal(await w.events(),512);
  await w.held(a0,'independent-evidence');
  await w.close();
 }
 {
  const w=await world('overflow-active'),a0=await w.register();
  // The same applies to rows that are all still ACTIVE (unexpired and unlifted), not only to retained history.
  await w.bulk(513);
  assert.equal((await w.db.prepare("SELECT count(*) AS n FROM operator_containments WHERE resolved_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").first()).n,513);
  await w.held(a0,'independent-evidence');assert.equal(await w.events(),0,'All-or-none: nothing is partially appended');
  await w.close();
 }

 // 6. Negative canary: the same scenario against a copy of the inventory module with the declared set emptied must NOT hold.
 {
  const scenario=async module=>{
   const w=await world('canary',module),a0=await w.register();
   await w.contain({kind:'project',id:w.projectId},{backend:'freeze'});
   const result=await w.outcome(a0);await w.close();return result;
  };
  assert.equal(await scenario(realInventory),'stale-authority');
  const canary=await harness.emptiedInventory();
  try{assert.equal(await scenario(canary.module),'verified','Without derivation the old archive verifies: the gap this suite pins');}finally{await canary.cleanup();}
 }
 harness.finish({});
}finally{await harness.dispose();}

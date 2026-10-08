// WH-008 local disaster-recovery drill, part 2: interrupted current key rotations and
// database/key cutovers. Synthetic data only. The source is the complete current schema
// over the actual D1 query adapter; keys, rotation, write policy, restore inventory, key
// backup and admission are the actual current modules. Recovery targets are empty local
// D1 databases (Miniflare). No remote Cloudflare access, provider dispatch, listener,
// customer traffic or key retirement. Real recovery keys and vault files are never read.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {memoryBucket,isolatedTargets,seedCredentials} from './helpers/recovery-drill.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {inspectIsolatedRestore} from '../tools/restore-admission.mjs';
import {restoreCapturedCMSDatabase,captureCMSDatabase} from '../tools/cms-database-snapshot.mjs';
import {currentSchemaArtifact,currentSchemaPlan,inspectSchema} from '../tools/current-schema.mjs';
import {captureRecoveryPoint,verifyRecoveryPoint,openArchivedControl,restoreControlD1,restoreDiscrepancies,isolatedObjects,DrillHold} from '../tools/recovery-drill.mjs';

Error.stackTraceLimit=0;
const directory=await mkdtemp('/tmp/whumpo-recovery-keys-'),phases={},holds={};let refusals=0;
const phase=async(name,work)=>{const start=performance.now();try{return await work();}finally{phases[name]=Math.round((performance.now()-start)*10)/10;console.error(`drill phase ${name}: ${phases[name]} ms`);}};
const refuses=async(work,expected)=>{await assert.rejects(work,expected);refusals++;};
const drillHold=(work,code)=>refuses(work,e=>e instanceof DrillHold&&e.code===code);
const closers=[],network=globalThis.fetch,independentEvidenceRetries=[];let fixture,cutover,isolated;
// Independent-evidence holds can come from the fixed ten-second observation deadline on a
// contended host; retry those only (never a deterministic hold). Same rule as the main drill.
async function retryIndependentEvidence(run){for(let attempt=1;;attempt++){const result=await run();if(result.holds[0]!=='independent-evidence'||attempt===3)return result;independentEvidenceRetries.push(attempt);}}
const canary='PRIVATE_KEY_DRILL_CANARY',key={a:{id:'fixture-current',secret:'ab'.repeat(32)},b:{id:'drill-next',secret:'cd'.repeat(32)},c:{id:'drill-third',secret:'ef'.repeat(32)}};
const ringA=fixtureKeyring(key.a.secret,key.a.id),ringB=fixtureKeyring(key.b.secret,key.b.id,[key.a]),ringBOnly=fixtureKeyring(key.b.secret,key.b.id),ringC=fixtureKeyring(key.c.secret,key.c.id,[key.a,key.b]);
const ringBackToA=fixtureKeyring(key.a.secret,key.a.id,[key.b]);
try{
 globalThis.fetch=()=>assert.fail('The recovery drill must not dispatch to any real provider');
 fixture=await phase('setupSource',()=>sqliteD1());const {db}=fixture;
 const modules=await currentFixtureModules(['src/connection-rotation.ts','src/connection-vault.ts','src/connection-write-policy.ts']);
 const rotation=await modules.module('src/connection-rotation.ts'),vault=await modules.module('src/connection-vault.ts'),policy=await modules.module('src/connection-write-policy.ts');
 await rotation.initializeConnectionKeys(db,ringA,'synthetic-key-review');
 const owner=await workspaceFixture(db,modules.identity),ids=await seedCredentials(db,ringA,owner,canary);
 const request=(name,expectedRevision,review='drill-rotation-review')=>({id:name,reviewId:review,expectedRevision});

 // ---- Independent authority and encrypted key custody. Backups hold only invented keys.
 const streamId='recovery-keys-stream',inventoryFile=join(directory,'operator.whumpo-restore-inventory');
 await createRestoreInventory({inventoryFile,streamId});
 const inventory=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,sourceDb:db});closers.push(()=>inventory.close());
 const backups=await keyBackupFixture();closers.push(()=>backups.close());
 const backup={a:(await backups.create(ringA)).proof,b:(await backups.create(ringB)).proof,bOnly:(await backups.create(ringBOnly)).proof};
 const none=isolatedObjects(memoryBucket()),empty=memoryBucket();
 const point=async name=>{const dir=join(directory,'points',name),captured=await captureRecoveryPoint({sourceDb:db,objects:empty,directory:dir,snapshotId:'keys-'+name});return {...captured,dir};};
 const register=async(p,keyBackup,inv=inventory)=>{const archived=await openArchivedControl(p.dir,p.pointDigest);try{return await inv.registerArchive({archiveDb:archived.db,snapshotId:p.snapshotId,keyBackup});}finally{archived.close();}};
 const admit=(candidate,manifest,keyBackup,{inv=inventory,stream=streamId,once=false}={})=>{
  const run=()=>inspectIsolatedRestore({db:candidate,manifest,keyBackup,evidenceSource:inv.evidenceSource,expectedStreamId:stream,objects:none});
  return once?run():retryIndependentEvidence(run);
 };
 const archivedCandidate=async p=>{const a=await openArchivedControl(p.dir,p.pointDigest);closers.push(async()=>a.close());return a.db;};
 // The directory for the points must exist with owner-only permissions.
 await mkdir(join(directory,'points'),{mode:0o700});
 isolated=await isolatedTargets(directory,{databases:['C','D'],buckets:[]});const target=isolated.env;

 // ---- Point 0: before any rotation. The baseline must pass, or later holds mean nothing.
 const p0=await phase('capturePoint0',()=>point('p0')),m0=await register(p0,backup.a),c0=await archivedCandidate(p0);
 const baseline=await admit(c0,m0,backup.a);assert.equal(baseline.status,'verified',JSON.stringify(baseline));
 assert.deepEqual([baseline.keys.keyIds,baseline.keys.credentials],[['fixture-current'],4]);

 // ---- Interruption 1: activation committed, lost reply, no record rotated yet.
 await rotation.registerConnectionKeys(db,ringB,'drill-rotation-review');
 const lostActivation=interceptDatabase(db,/INSERT INTO connection_key_rotations/,async()=>{},async()=>{throw Error('lost activation reply');});
 const activated=await rotation.beginConnectionRotation(lostActivation,ringB,request('drill-rotation',1));
 assert.deepEqual([activated.revision,activated.target_key,activated.state],[2,'drill-next','running']);
 assert.deepEqual(await rotation.beginConnectionRotation(db,ringB,request('drill-rotation',1)),activated,'The lost reply is read back, not repeated');
 assert.equal((await rotation.connectionRotationStatus(db,'drill-rotation')).remaining,4);
 await refuses(rotation.rotateConnectionBatch(db,ringA,'drill-rotation','wrong-key-ring'),/unavailable/);
 const p1a=await phase('capturePoint1a',()=>point('p1a'));
 // A capsule lacking the retained source key cannot even be registered for this archive.
 await refuses(register(p1a,backup.bOnly),/unavailable/);
 const m1a=await register(p1a,backup.b);
 assert.deepEqual(m1a.keyIds,['drill-next','fixture-current'],'The manifest requires both keys while rotation is unsettled');
 // While the current source is itself mid-rotation, the inventory refuses to issue any evidence.
 const c1a=await archivedCandidate(p1a);
 holds.activatedNothingRotated=(await admit(c1a,m1a,backup.b,{once:true})).holds;assert.deepEqual(holds.activatedNothingRotated,['independent-evidence']);

 // ---- Interruption 2: some records rotated, the rest still under the retired key.
 const first=await rotation.rotateConnectionBatch(db,ringB,'drill-rotation','drill-batch-1',2);
 assert.deepEqual([first.selected_count,first.changed_count],[2,2]);
 assert.equal((await rotation.connectionRotationStatus(db,'drill-rotation')).remaining,2);
 const p1b=await phase('capturePoint1b',()=>point('p1b')),m1b=await register(p1b,backup.b);
 const restoreC=await phase('restoreMidRotationD1',()=>restoreControlD1(target.DRILL_C,p1b.dir,p1b.pointDigest));
 assert.equal(restoreC.digest,p1b.controlDigest);
 const rowsC=async()=>{const read=async(table,column)=>(await target.DRILL_C.prepare(`SELECT ${column} AS c FROM ${table}`).all()).results.map(r=>r.c.split('.')[1]).sort();return [...await read('github_token_vault','ciphertext'),...await read('cloudflare_token_vault','ciphertext'),...await read('github_oauth_states','verifier_ciphertext'),...await read('cloudflare_oauth_states','verifier_ciphertext')].sort();};
 assert.deepEqual(await rowsC(),['drill-next','drill-next','fixture-current','fixture-current'],'The restored candidate keeps the exact mixed-key state');
 assert.deepEqual(await target.DRILL_C.prepare('SELECT r.state,r.target_key,p.active_key,p.revision FROM connection_key_rotations r,connection_key_policy p').first(),{state:'running',target_key:'drill-next',active_key:'drill-next',revision:2});
 holds.midRotation=(await admit(target.DRILL_C,m1b,backup.b,{once:true})).holds;assert.deepEqual(holds.midRotation,['independent-evidence']);
 // The current-record snapshot itself is refused while a rotation is unsettled, so even the loss report is unavailable.
 // The source is present and readable; it is the unsettled rotation that blocks comparison, which must not read as a lost source.
 holds.midRotationReport=await restoreDiscrepancies(target.DRILL_C,db);assert.deepEqual(holds.midRotationReport,{servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,sourceAvailable:true,reconciliation:'held-current-source-unsettled',sourceHold:'key-rotation-unsettled'});

 // ---- Deterministic local recovery with the existing authority: finish the rotation
 // after a lost acknowledgement. The same batch ID reads back the same receipt.
 const lostBatch=interceptDatabase(db,/INSERT INTO connection_rotation_batches/,async()=>{},async()=>{throw Error('lost batch acknowledgement');});
 const second=await rotation.rotateConnectionBatch(lostBatch,ringB,'drill-rotation','drill-batch-2',20);
 assert.deepEqual([second.selected_count,second.changed_count],[2,2]);
 assert.deepEqual(await rotation.rotateConnectionBatch(db,ringB,'drill-rotation','drill-batch-2',20),second);
 const done=await rotation.connectionRotationStatus(db,'drill-rotation');assert.deepEqual([done.state,done.remaining,done.rotated],['complete',0,4]);

 // ---- Revoked session and its pending flows after the rotation completed.
 assert.equal((await db.prepare('SELECT count(*) n FROM github_oauth_states').first()).n,1);
 await owner.revoke();
 assert.equal((await db.prepare('SELECT (SELECT count(*) FROM github_oauth_states)+(SELECT count(*) FROM cloudflare_oauth_states) n').first()).n,0,'Revocation removes the pending flows');
 const gapsC=await phase('reconciliationMidRotation',()=>restoreDiscrepancies(target.DRILL_C,db));
 assert.deepEqual(gapsC.tables.resurrected,{identity_sessions:1,github_oauth_states:1,cloudflare_oauth_states:1},'The revoked session and its flows would return');
 assert.deepEqual(gapsC.tables.rolledBack,{connection_key_rotations:1},'The completed rotation would be rolled back to running');
 assert.deepEqual(gapsC.tables.lostSinceSnapshot,{connection_rotation_batches:1});
 holds.activatedAfterCompletion=(await admit(c1a,m1a,backup.b)).holds;assert.ok(['suppressed-record','stale-authority'].includes(holds.activatedAfterCompletion[0]),JSON.stringify(holds.activatedAfterCompletion));
 holds.midRotationAfterRevocation=(await admit(target.DRILL_C,m1b,backup.b)).holds;assert.equal(holds.midRotationAfterRevocation.length,1);
 assert.ok(['suppressed-record','stale-authority'].includes(holds.midRotationAfterRevocation[0]),JSON.stringify(holds.midRotationAfterRevocation));
 assert.equal((await captureCMSDatabase(async sql=>(await target.DRILL_C.prepare(sql).all()).results,{maxRows:200000})).digest,p1b.controlDigest,'The candidate is held, not scrubbed or advanced');
 // The pre-rotation point is older still: its key policy, every vault row and the session are stale.
 const gaps0=await restoreDiscrepancies(c0,db);
 assert.deepEqual(gaps0.tables,{resurrected:{cloudflare_oauth_states:1,github_oauth_states:1,identity_sessions:1},rolledBack:{cloudflare_token_vault:1,connection_key_policy:1,github_token_vault:1},lostSinceSnapshot:{connection_key_registry:1,connection_key_rotations:1,connection_rotation_batches:2}},'The pre-rotation point would roll back the key policy and credentials');
 holds.preRotationPoint=(await admit(c0,m0,backup.a)).holds;assert.ok(['suppressed-record','stale-authority'].includes(holds.preRotationPoint[0]),JSON.stringify(holds.preRotationPoint));

 // ---- Old keys cannot be reactivated, even though they remain registered and retained.
 await refuses(rotation.beginConnectionRotation(db,ringBackToA,request('drill-rollback',2)),/unavailable/);
 await refuses(policy.sealConnectionWrite(db,ringA,`whumpo:github:token:${owner.account}:restored-old-key`,'synthetic'),{code:'write-key'});
 const staleWrite=await vault.seal(ringA,`whumpo:github:token:${owner.account}:stale-writer`,'synthetic');
 await refuses(db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','active')").bind('stale-writer',owner.account,staleWrite).run(),/connection_write_key_changed/);
 const retirement=await rotation.connectionKeyRetirementStatus(db,'fixture-current');
 assert.deepEqual([retirement.liveReferences,retirement.retirementAllowed],[0,false],'No live reference still does not authorize retirement');
 assert.equal((await rotation.connectionKeyRetirementStatus(db,'drill-next')).active,true);
 const archivesNeedingOldKey=[m0,m1a,m1b].filter(m=>m.keyIds.includes('fixture-current')).length;assert.equal(archivesNeedingOldKey,3);

 // ---- Point 2: completed rotation after the revocation restores into a real isolated D1 and admits.
 const p2=await phase('capturePoint2',()=>point('p2')),m2=await register(p2,backup.b);
 assert.deepEqual(m2.keyIds,['drill-next'],'A completed rotation needs only the active key for this archive');
 const restoreD=await phase('restoreCompletedRotationD1',()=>restoreControlD1(target.DRILL_D,p2.dir,p2.pointDigest));assert.equal(restoreD.digest,p2.controlDigest);
 // The release tooling classifies a database by its observed schema only. A restored, populated control database is exactly
 // the current schema, so the release contract treats it as `none` (an already-current database, never an initializable
 // one), and a distinct empty database as `initialize`. The contract has no state in which a populated restored database
 // becomes the Workers' control database: that is the recorded cutover gap, not something this drill performs.
 const schemaArtifact=await currentSchemaArtifact(),emptyTarget=new DatabaseSync(':memory:');
 try{
  assert.equal(currentSchemaPlan(schemaArtifact,await inspectSchema(target.DRILL_D)).mode,'none','The restored database is exactly the current schema');
  assert.equal(currentSchemaPlan(schemaArtifact,await inspectSchema(sqliteD1Adapter(emptyTarget))).mode,'initialize','An empty database is the only initialization target');
 }finally{emptyTarget.close();}
 const admitted=await phase('admitCompletedRotation',()=>admit(target.DRILL_D,m2,backup.b));
 assert.equal(admitted.status,'verified',JSON.stringify(admitted));assert.deepEqual([admitted.keys.keyIds,admitted.keys.credentials],[['drill-next','fixture-current'],2]);
 assert.deepEqual([admitted.servingAllowed,admitted.providerDispatchAllowed,admitted.retirementAllowed],[false,false,false]);
 const same=await restoreDiscrepancies(target.DRILL_D,db);assert.deepEqual(same.counts,{resurrected:{},rolledBack:{},lostSinceSnapshot:{}});
 // Wrong capsules fail visibly at the registered binding: neither the old-key-only nor the new-key-only capsule is the pinned one.
 for(const [label,wrong] of [['oldKeysOnly',backup.a],['newKeysOnly',backup.bOnly]]){holds['completedRotation:'+label]=(await admit(target.DRILL_D,m2,wrong)).holds;assert.deepEqual(holds['completedRotation:'+label],['key-backup-binding']);}
 // The new-key-only capsule suffices for this archive; the retired key is still needed by older ones.
 assert.deepEqual(await register(p2,backup.b),m2,'Repeating the exact registration is idempotent');
 // A permanent withdrawal ends the older archive's evidence: it can never be admitted again.
 await inventory.withdrawArchive({snapshotId:p1b.snapshotId});
 holds.withdrawnMidRotation=(await admit(target.DRILL_C,m1b,backup.b,{once:true})).holds;assert.deepEqual(holds.withdrawnMidRotation,['independent-evidence']);
 // A recovery key that goes missing fails visibly even for the verified candidate.
 const recoveryKey=backups.recoveryKeyFile,movedKey=recoveryKey+'.moved';
 await rename(recoveryKey,movedKey);holds.recoveryKeyMissing=(await admit(target.DRILL_D,m2,backup.b)).holds;await rename(movedKey,recoveryKey);
 assert.deepEqual(holds.recoveryKeyMissing,['key-backup-unavailable']);assert.equal((await admit(target.DRILL_D,m2,backup.b)).status,'verified');

 // ---- A key verifier altered in an archived copy never becomes admissible. The inventory's
 // current-source comparison pins the registry row first, so it is reported as stale authority.
 const {snapshot}=await verifyRecoveryPoint(p2.dir,p2.pointDigest),copy=structuredClone(snapshot);
 const registry=copy.tables.find(t=>t.name==='connection_key_registry'),column=registry.columns.indexOf('fingerprint'),named=registry.columns.indexOf('id');
 for(const row of registry.rows)if(row[named]==="CAST(X'"+Buffer.from('drill-next').toString('hex').toUpperCase()+"' AS TEXT)")row[column]="'"+'0'.repeat(64)+"'";
 const forged=new DatabaseSync(':memory:');restoreCapturedCMSDatabase(forged,copy);
 try{
  const forgedAdapter=sqliteD1Adapter(forged),forgedManifest=await inventory.registerArchive({archiveDb:forgedAdapter,snapshotId:'keys-forged-verifier',keyBackup:backup.b});
  holds.forgedKeyVerifier=(await admit(forgedAdapter,forgedManifest,backup.b)).holds;assert.deepEqual(holds.forgedKeyVerifier,['stale-authority']);
 }finally{forged.close();}

 // ---- An unresolved OAuth exchange survives the restore: its outcome stays unknown.
 const exchange=crypto.randomUUID();
 await db.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state,created_at) VALUES(?,?,'github','fixture','unknown','drill-next',2,'dispatched','2026-10-08')").bind(exchange,owner.account).run();
 await rotation.registerConnectionKeys(db,ringC,'drill-third-review');
 await refuses(rotation.beginConnectionRotation(db,ringC,request('drill-third-rotation',2,'drill-third-review')),/unavailable/);
 assert.equal((await rotation.connectionKeyRetirementStatus(db,'drill-next')).unsettledExchanges,1);
 const p3=await point('p3'),m3=await register(p3,backup.b),c3=await archivedCandidate(p3);
 holds.unresolvedExchangeSource=(await admit(c3,m3,backup.b,{once:true})).holds;assert.deepEqual(holds.unresolvedExchangeSource,['independent-evidence'],'The source refuses evidence while the exchange is unresolved');
 // The same real block, seen by the loss report: the source exists and is readable, but its unresolved exchange holds the comparison.
 holds.unresolvedExchangeReport=await restoreDiscrepancies(c3,db);assert.deepEqual([holds.unresolvedExchangeReport.sourceAvailable,holds.unresolvedExchangeReport.reconciliation,holds.unresolvedExchangeReport.sourceHold,'counts' in holds.unresolvedExchangeReport],[true,'held-current-source-unsettled','uncertain-effect',false]);
 assert.ok(!JSON.stringify(holds.unresolvedExchangeReport).includes(exchange)&&!JSON.stringify(holds.unresolvedExchangeReport).includes(owner.account),'The hold report names no identifier');
 await db.prepare("INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,'rejected','bad_verification_code',200,created_at FROM connection_oauth_exchanges WHERE token_id=?").bind(exchange).run();
 await db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).run();
 await inventory.observe({operationId:'drill-exchange-terminal',selection:{kind:'external-effect',store:'connection_oauth_exchanges',effectId:exchange}});
 holds.unresolvedExchangeCandidate=(await retryIndependentEvidence(()=>admit(c3,m3,backup.b,{once:true}))).holds;
 assert.ok(['suppressed-record','stale-authority','uncertain-effect'].includes(holds.unresolvedExchangeCandidate[0]),JSON.stringify(holds.unresolvedExchangeCandidate));
 assert.ok(await c3.prepare('SELECT token_id FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).first(),'The recovered exchange row is kept visible, not erased');

 // ---- A source that exists but is not the current schema is held as invalid; one that cannot be read at all is unavailable.
 const foreign=new DatabaseSync(':memory:');
 try{
  holds.foreignSourceReport=await restoreDiscrepancies(c3,sqliteD1Adapter(foreign));
  assert.deepEqual([holds.foreignSourceReport.sourceAvailable,holds.foreignSourceReport.reconciliation,holds.foreignSourceReport.sourceHold],[true,'held-current-source-invalid','current-schema']);
 }finally{foreign.close();}
 const unreachable={prepare(){throw Error('source lost');},batch(){throw Error('source lost');}};
 holds.lostSourceReport=await restoreDiscrepancies(c3,unreachable);
 assert.deepEqual([holds.lostSourceReport.sourceAvailable,holds.lostSourceReport.reconciliation,'sourceHold' in holds.lostSourceReport],[false,'unavailable-without-current-source',false]);

 // ---- Database cutover: a new empty current database with initialized key policy replaces the
 // old control database. It is not a restore target, and the old generation's authority is not
 // reactivated: against the new current source every old record is absent and held.
 cutover=await phase('setupCutoverSource',()=>sqliteD1());
 await rotation.initializeConnectionKeys(cutover.db,ringB,'cutover-key-review');
 await drillHold(()=>restoreControlD1(cutover.db,p2.dir,p2.pointDigest),'restore-target-not-empty');
 const cutoverStream='recovery-keys-cutover-stream',cutoverFile=join(directory,'cutover.whumpo-restore-inventory');
 await createRestoreInventory({inventoryFile:cutoverFile,streamId:cutoverStream});
 const cutoverInventory=await openRestoreInventory({inventoryFile:cutoverFile,expectedStreamId:cutoverStream,sourceDb:cutover.db});closers.push(()=>cutoverInventory.close());
 const cutoverManifest=await register(p2,backup.b,cutoverInventory);
 holds.afterDatabaseCutover=(await admit(target.DRILL_D,cutoverManifest,backup.b,{inv:cutoverInventory,stream:cutoverStream})).holds;
 assert.equal(holds.afterDatabaseCutover.length,1);assert.ok(['suppressed-record','removed-owner','stale-authority'].includes(holds.afterDatabaseCutover[0]),JSON.stringify(holds.afterDatabaseCutover));
 const cutoverGaps=await restoreDiscrepancies(target.DRILL_D,cutover.db);
 assert.equal(cutoverGaps.sourceAvailable,true);assert.ok(cutoverGaps.counts.resurrected.identity>=1&&cutoverGaps.counts.resurrected.credential>=2,JSON.stringify(cutoverGaps.counts));

 assert.ok(!JSON.stringify([admitted,holds,cutoverGaps]).includes(canary)&&!JSON.stringify([admitted,holds]).includes(owner.account));
 console.log(JSON.stringify({suite:'WH-008 interrupted key rotation and cutover recovery drill',node:process.versions.node,
  points:{p0:{rows:p0.controlRows},p1a:{rows:p1a.controlRows},p1b:{rows:p1b.controlRows,restoreStatements:restoreC.statements},p2:{rows:p2.controlRows,restoreStatements:restoreD.statements},p3:{rows:p3.controlRows}},
  rotation:{records:4,firstBatch:first.changed_count,secondBatch:second.changed_count,archivesNeedingRetiredKey:archivesNeedingOldKey,retiredKeyLiveReferences:retirement.liveReferences},
  midRotationDiscrepancies:gapsC.tables,preRotationRolledBack:gaps0.counts.rolledBack,cutoverDiscrepancies:cutoverGaps.counts,
  measuredMs:phases,holds,drillRefusals:refusals,independentEvidenceRetries:independentEvidenceRetries.length,
  servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,remoteAccess:false},null,1));
}finally{
 globalThis.fetch=network;
 for(const close of closers.reverse())await close().catch(()=>{});
 await isolated?.dispose();await cutover?.close();await fixture?.close();
 await rm(directory,{recursive:true,force:true});
}

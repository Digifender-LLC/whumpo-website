import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile,chmod,rename,symlink,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {captureRestoreConstraint,inspectIsolatedRestore,restoreManifestDigest} from '../tools/restore-admission.mjs';
import {assertArtifactPath} from '../tools/artifact-protection.mjs';
import {recoveryAuthorityDatabase} from '../tools/recovery-authority.mjs';
import {syntheticAuthority} from './helpers/synthetic-platform.mjs';

Error.stackTraceLimit=0;
const directory=await mkdtemp('/tmp/whumpo-inventory-'),inventoryFile=join(directory,'current.whumpo-restore-inventory');
const streamId='separate-operator-inventory',id=()=>crypto.randomUUID(),fixture=await sqliteD1(),{db,sql}=fixture;
const keys=await keyBackupFixture(),keyring=fixtureKeyring(),stored=await keys.create(keyring),keyBackup=stored.proof;
const {identity:m}=await currentFixtureModules([]);
const opened=[],copies=[];let refusals=0;
const reject=async f=>{await assert.rejects(f,/unavailable|could not be observed/);refusals++;};
let authority;
// The source is always an authority over a synthetic platform (tests/helpers/synthetic-platform.mjs); a null source opens the read-only status handle.
const open=async(source=db)=>{const h=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,...(source?{authority:source===db?authority:await syntheticAuthority(source)}:{})});opened.push(h);return h;};
const copy=async()=>{const file=join(directory,id()+'.sqlite');await backup(sql,file);const isolated=new DatabaseSync(file,{readOnly:true});copies.push(isolated);return sqliteD1Adapter(isolated);};
const request=(manifest,change={})=>new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:id(),...change})});
const inspect=(candidate,manifest,inventory)=>inspectIsolatedRestore({db:candidate,manifest,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId});
const held=async(candidate,manifest,inventory,code)=>{const result=await inspect(candidate,manifest,inventory);assert.deepEqual(result.holds,[code]);assert.equal(result.servingAllowed,false);assert.equal(result.providerDispatchAllowed,false);assert.equal(result.retirementAllowed,false);refusals++;};
const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('Operator inventory must not access real providers');
try{
 await initializeFixtureKeys(db,keyring);const owner=await workspaceFixture(db,m);authority=await syntheticAuthority(db);
 await db.prepare("UPDATE users SET email='PRIVATE_INVENTORY_PROFILE_CANARY' WHERE id=?").bind(owner.account).run();
 const init=await createRestoreInventory({inventoryFile,streamId});assert.equal(init.archives,0);assert.equal(init.independentCustodyAccepted,false);
 await reject(()=>createRestoreInventory({inventoryFile,streamId}));
 await reject(()=>openRestoreInventory({inventoryFile,expectedStreamId:'wrong-stream'}));
 await reject(()=>openRestoreInventory({inventoryFile:join(directory,'missing.whumpo-restore-inventory'),expectedStreamId:streamId}));
 const inventory=await open(),archive=await copy(),snapshotId=id();
 await reject(()=>inventory.registerArchive({archiveDb:recoveryAuthorityDatabase(authority),snapshotId,keyBackup}));
 // A raw adapter is never a source: neither as the authority nor under the retired key.
 await reject(()=>openRestoreInventory({inventoryFile,expectedStreamId:streamId,authority:db}));
 await reject(()=>openRestoreInventory({inventoryFile,expectedStreamId:streamId,sourceDb:db}));
 await reject(()=>openRestoreInventory({inventoryFile,expectedStreamId:streamId,authority:{...authority}}));
 await reject(()=>inventory.registerArchive({archiveDb:archive,snapshotId,keyBackup:{...keyBackup}}));
 const manifest=await inventory.registerArchive({archiveDb:archive,snapshotId,keyBackup});
 assert.equal((await inspect(archive,manifest,inventory)).status,'verified');
 assert.deepEqual(await inventory.registerArchive({archiveDb:archive,snapshotId,keyBackup}),manifest,'Lost-response replay returns the original exact manifest');
 const wrongBackup=(await keys.create(keyring)).proof;
 await reject(()=>inventory.registerArchive({archiveDb:archive,snapshotId,keyBackup:wrongBackup}));
 const other=await open();
 const first=await inventory.observe({operationId:'record-before',selection:{kind:'record',table:'identity_sessions',key:{id:owner.authority}}});
 assert.equal(first.kind,'record-current');
 await db.prepare('DELETE FROM identity_sessions WHERE id=?').bind(owner.authority).run();
 const suppressed=await other.observe({operationId:'record-after',selection:{kind:'record',table:'identity_sessions',key:{id:owner.authority}}});
 assert.equal(suppressed.kind,'record-suppressed');
 assert.deepEqual(await inventory.observe({operationId:'record-after',selection:{kind:'record',table:'identity_sessions',key:{id:owner.authority}}}),suppressed);
 await reject(()=>inventory.observe({operationId:'record-after',selection:{kind:'record',table:'users',key:{id:owner.account}}}));
 await held(archive,manifest,inventory,'suppressed-record');
 const repaired=await copy(),current=await inventory.registerArchive({archiveDb:repaired,snapshotId:id(),keyBackup});
 assert.equal((await inspect(repaired,current,inventory)).status,'verified','Later suppression supersedes earlier record-current evidence');
 // Restart the reader and a completely new process. Persisted permissions and
 // tombstones, rather than an in-memory fixture map, govern verification.
 const offline=await open(null);await held(archive,manifest,offline,'independent-evidence');
 const reader=await open();await held(archive,manifest,reader,'suppressed-record');
 assert.equal((await inspect(repaired,current,reader)).status,'verified');
 await reject(()=>offline.observe({operationId:id(),selection:{kind:'owner-erased',ownerId:'absent'}}));
 await reject(()=>offline.withdrawArchive({snapshotId:current.snapshotId}));
 const run=spawnSync(process.execPath,['tools/restore-inventory.mjs','inspect',inventoryFile,streamId],{encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);const report=JSON.parse(run.stdout);assert.equal(report.currentSequence,2);assert.equal(report.archives,2);assert.equal(report.servingAllowed,false);
 assert.ok(!run.stdout.includes(owner.account));assert.ok(!run.stdout.includes(owner.authority));assert.ok(!run.stdout.includes(directory));
 await inventory.withdrawArchive({snapshotId});await other.withdrawArchive({snapshotId});
 assert.equal((await reader.evidenceSource.fetch(request(manifest))).status,404);
 await held(archive,manifest,reader,'independent-evidence');
 await reject(()=>inventory.registerArchive({archiveDb:archive,snapshotId,keyBackup}));
 await reject(()=>inventory.withdrawArchive({snapshotId:'not-registered'}));
 // Current schema selectors are derived from source reads. No caller hashes,
 // approval flags, SQL fragments or partial keys can manufacture observations.
 for(const selection of [
  {kind:'owner-erased',ownerId:owner.account},
  {kind:'record',table:'users; DROP TABLE users',key:{id:owner.account}},
  {kind:'record',table:'users',key:{}},
  {kind:'record',table:'users',key:{id:owner.account},sha256:'f'.repeat(64)},
  {kind:'external-effect',store:'standard_ai_requests',effectId:'missing'},
  {kind:'external-effect',store:'github_token_vault',effectId:'missing'},
  {kind:'identity-epoch',ownerId:'missing'},
  {kind:'publication-withdrawn',projectId:id(),surface:'unsupported'},
 ])await reject(()=>inventory.observe({operationId:id(),selection}));
 const epoch=await inventory.observe({operationId:'epoch-one',selection:{kind:'identity-epoch',ownerId:owner.account}});
 assert.equal(epoch.kind,'identity-epoch');
 await reject(()=>inventory.observe({operationId:'epoch-duplicate',selection:{kind:'identity-epoch',ownerId:owner.account}}));
 await db.prepare('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?').bind(owner.account).run();
 await inventory.observe({operationId:'epoch-two',selection:{kind:'identity-epoch',ownerId:owner.account}});
 await held(repaired,current,reader,'stale-identity');
 const effectId=id();
 await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-02','2026-10-02')").bind(effectId,owner.account,'a'.repeat(64)).run();
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(effectId).run();
 const effect=await captureRestoreConstraint(db,{kind:'external-effect',store:'standard_ai_requests',effectId});assert.equal(effect.data.state,'unknown');assert.equal(effect.data.receipt,null);
 await inventory.observe({operationId:'effect-unknown',selection:{kind:'external-effect',store:'standard_ai_requests',effectId}});
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?").bind(effectId).run();
 const terminal=await copy(),terminalManifest=await inventory.registerArchive({archiveDb:terminal,snapshotId:id(),keyBackup});
 await held(terminal,terminalManifest,reader,'uncertain-effect');
 await inventory.observe({operationId:'effect-terminal',selection:{kind:'external-effect',store:'standard_ai_requests',effectId}});
 assert.equal((await inspect(terminal,terminalManifest,reader)).status,'verified');
 // Unknown OAuth exchanges cannot borrow a token or another operation's result.
 const exchange=id();await db.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state) VALUES(?,?,'github','fixture','unknown','fixture-current',1,'dispatched')").bind(exchange,owner.account).run();
 assert.equal((await captureRestoreConstraint(db,{kind:'external-effect',store:'connection_oauth_exchanges',effectId:exchange})).data.state,'unknown');
 await db.prepare("INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,'rejected','bad_verification_code',200,created_at FROM connection_oauth_exchanges WHERE token_id=?").bind(exchange).run();
 assert.equal((await captureRestoreConstraint(db,{kind:'external-effect',store:'connection_oauth_exchanges',effectId:exchange})).data.state,'unknown');
 await db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).run();
 assert.equal((await captureRestoreConstraint(db,{kind:'external-effect',store:'connection_oauth_exchanges',effectId:exchange})).data.state,'reconciled');
 // Concurrent source reads cannot silently commit against a different journal.
 let raced=false;
 const racingSource=interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{if(!raced){raced=true;await other.observe({operationId:'racer',selection:{kind:'owner-erased',ownerId:'never-present'}});}});
 const writer=await open(racingSource);
 await reject(()=>writer.observe({operationId:'loser',selection:{kind:'owner-erased',ownerId:'another-absent'}}));
 assert.equal((await writer.observe({operationId:'loser',selection:{kind:'owner-erased',ownerId:'another-absent'}})).recorded,true);
 let evidenceReads=0;
 await held(terminal,terminalManifest,{evidenceSource:{fetch:async request=>{
  if(++evidenceReads===2)await inventory.withdrawArchive({snapshotId:terminalManifest.snapshotId});
  return reader.evidenceSource.fetch(request);
 }}},'independent-evidence');
 // SQL append-only invariants remain after all application handles are closed.
 const raw=new DatabaseSync(inventoryFile);raw.exec('PRAGMA foreign_keys=ON');
 for(const table of ['identity','archive','withdrawal','event'])for(const action of ['UPDATE','DELETE']){
  const query=action==='UPDATE'?`UPDATE ${table} SET ${table==='identity'?'stream_id=stream_id':table==='event'?'kind=kind':'snapshot_id=snapshot_id'}`:`DELETE FROM ${table}`;
  assert.throws(()=>raw.exec(query),/inventory_immutable/);refusals++;
 }
 assert.throws(()=>raw.prepare("INSERT INTO event VALUES(512,'gap','{}','owner-erased','{}')").run(),/inventory_sequence/);refusals++;raw.close();
 for(const change of [{version:1},{challenge:'invalid challenge'},{extra:true}])assert.equal((await reader.evidenceSource.fetch(request(terminalManifest,change))).status,400);
 assert.equal((await reader.evidenceSource.fetch(new Request('https://other.invalid/v2/check',{method:'POST',body:'{}'}))).status,400);
 await reject(()=>reader.evidenceSource.fetch(new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(2049)})));
 let cancelled=false;
 await reject(()=>reader.evidenceSource.fetch(new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},duplex:'half',body:new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}})})));
 assert.equal(cancelled,true);assert.ok(await reader.inspect(),'A stalled request cannot poison later work');
 const bytes=await readFile(inventoryFile);assert.ok(!bytes.includes(Buffer.from('PRIVATE_INVENTORY_PROFILE_CANARY')));assert.ok(!bytes.includes(Buffer.from(JSON.parse(keyring).keys[0].secret)));
 for(const path of ['public/data.whumpo-restore-inventory','public/data.whumpo-restore-inventory-journal']){assert.throws(()=>assertArtifactPath(path));refusals++;}
 await chmod(inventoryFile,0o644);await reject(()=>reader.inspect());await chmod(inventoryFile,0o600);
 const hard=join(directory,'hard.whumpo-restore-inventory');await link(inventoryFile,hard);await reject(()=>reader.inspect());await unlink(hard);
 const symbolic=join(directory,'symlink.whumpo-restore-inventory');await symlink(inventoryFile,symbolic);await reject(()=>openRestoreInventory({inventoryFile:symbolic,expectedStreamId:streamId}));
 const moved=join(directory,'original.whumpo-restore-inventory');await rename(inventoryFile,moved);await writeFile(inventoryFile,bytes,{mode:0o600});await reject(()=>reader.inspect());await unlink(inventoryFile);await rename(moved,inventoryFile);
 const corrupt=new DatabaseSync(inventoryFile);corrupt.exec('DROP TRIGGER event_update');corrupt.close();await reject(()=>openRestoreInventory({inventoryFile,expectedStreamId:streamId}));
 const bad=join(directory,'bad.whumpo-restore-inventory');await writeFile(bad,'not a database',{mode:0o600});await reject(()=>openRestoreInventory({inventoryFile:bad,expectedStreamId:streamId}));
 console.log(JSON.stringify({suite:'persistent operator restore inventory',refusals,persistedReadback:true,realReadOnlyCopies:copies.length,liveProviderAccess:false,independentCustodyAccepted:false}));
}finally{
 globalThis.fetch=network;for(const h of opened.reverse())await h.close();for(const c of copies)c.close();fixture.close();await keys.close();await rm(directory,{recursive:true,force:true});
}

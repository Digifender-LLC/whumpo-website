import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {inspectIsolatedRestore,restoreManifestDigest} from '../tools/restore-admission.mjs';
import {syntheticAuthority} from './helpers/synthetic-platform.mjs';

Error.stackTraceLimit=0;
const directory=await mkdtemp('/tmp/whumpo-inventory-freshness-'),inventoryFile=join(directory,'current.whumpo-restore-inventory'),streamId='fresh-source',id=()=>crypto.randomUUID();
const fixture=await sqliteD1(),{db,sql}=fixture,{identity:m}=await currentFixtureModules([]),keys=await keyBackupFixture(),keyring=fixtureKeyring(),{proof:keyBackup}=await keys.create(keyring);
const copies=[],handles=[];let refusals=0,verified=0;const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('No network permitted');
const open=async(source=db)=>{const h=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,...(source?{authority:await syntheticAuthority(source)}:{})});handles.push(h);return h;};
const copy=async()=>{const file=join(directory,id()+'.sqlite');await backup(sql,file);const copied=new DatabaseSync(file,{readOnly:true});copies.push(copied);return sqliteD1Adapter(copied);};
const register=async inventory=>{const candidate=await copy(),manifest=await inventory.registerArchive({archiveDb:candidate,snapshotId:id(),keyBackup});return {candidate,manifest};};
const inspect=({candidate,manifest},inventory)=>inspectIsolatedRestore({db:candidate,manifest,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId});
const assertResult=async(archive,inventory,hold)=>{
 const result=await inspect(archive,inventory);
 assert.equal(result.status,hold?'held':'verified');assert.deepEqual(result.holds,hold?[hold]:[]);
 for(const key of ['servingAllowed','providerDispatchAllowed','retirementAllowed'])assert.equal(result[key],false);
 if(hold)refusals++;else verified++;
 return result;
};
const request=manifest=>new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:id()})});
const evidence=async(archive,inventory)=>{const response=await inventory.evidenceSource.fetch(request(archive.manifest));assert.equal(response.status,200);return response.json();};
const reject=async action=>{await assert.rejects(action,/unavailable/);refusals++;};
try{
 await initializeFixtureKeys(db,keyring);const owner=await workspaceFixture(db,m);
 const session=await db.prepare('SELECT * FROM identity_sessions WHERE id=?').bind(owner.authority).first();
 await db.prepare('UPDATE users SET email=? WHERE id=?').bind('PRIVATE_SOURCE_PROFILE_CANARY',owner.account).run();
 const init=await createRestoreInventory({inventoryFile,streamId});assert.equal(init.version,2);
 const inventory=await open(),original=await register(inventory);
 await assertResult(original,inventory);
 await owner.revoke(); // No manual inventory.observe: missed notifications must not bless old authority.
 await assertResult(original,inventory,'suppressed-record');
 const observed=await evidence(original,inventory);assert.equal(observed.events.length,1);
 assert.deepEqual(observed.events[0].data,{table:'identity_sessions',key:{id:owner.authority}});
 assert.equal(observed.events[0].kind,'record-suppressed');
 const repeated=await evidence(original,inventory);assert.deepEqual(repeated.events,observed.events);assert.notEqual(repeated.challenge,observed.challenge);
 const restarted=await open();await assertResult(original,restarted,'suppressed-record');
 let current=await register(inventory);await assertResult(current,restarted);
 const offline=await open(null);assert.equal((await offline.inspect()).version,2);
 await assertResult(current,offline,'independent-evidence');
 const broken=await open({...db,batch:async()=>{throw Error('PRIVATE_SOURCE_FAILURE_CANARY');}});
 await assertResult(current,broken,'independent-evidence');

 // A stalled read that ignores cancellation must not poison the handle queue.
 const controller=new AbortController();let release,started;
 const began=new Promise(resolve=>{started=resolve;}),waiting=new Promise(resolve=>{release=resolve;});
 let stalledOnce=false;
 const stalled=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{
  if(!stalledOnce){stalledOnce=true;started();await waiting;}
 }));
 const sequenceAtAbort=(await inventory.inspect()).currentSequence;
 const pending=stalled.evidenceSource.fetch(new Request(request(current.manifest),{signal:controller.signal}));
 const aborted=reject(()=>pending);await began;controller.abort();await aborted;
 assert.equal((await stalled.inspect()).currentSequence,sequenceAtAbort);
 release();await assertResult(current,stalled);assert.equal((await stalled.inspect()).currentSequence,sequenceAtAbort);
 // Also exercise the real deadline without an external AbortController.
 const deadlineHandle=await open({...db,batch:()=>new Promise(()=>{})});
 const deadlineStart=Date.now();await reject(()=>deadlineHandle.evidenceSource.fetch(request(current.manifest)));
 assert.ok(Date.now()-deadlineStart>=9900);assert.ok(Date.now()-deadlineStart<15000);
 assert.equal((await deadlineHandle.inspect()).currentSequence,sequenceAtAbort);

 // A consumed/cancelled/current record need not disappear. A changed full row
 // is independently observed; neither its old digest nor the current value leaks.
 await db.prepare('UPDATE users SET email=? WHERE id=?').bind('PRIVATE_CHANGED_PROFILE_CANARY',owner.account).run();
 await assertResult(current,inventory,'stale-authority');
 const changed=await evidence(current,inventory);assert.equal(changed.events.length,2);assert.equal(changed.events.at(-1).kind,'record-current');
 assert.ok(!JSON.stringify(changed).includes('PRIVATE_CHANGED_PROFILE_CANARY'));
 current=await register(inventory);await assertResult(current,inventory);

 // Reusing a previously suppressed exact identity must not clear its tombstone.
 const columns=Object.keys(session);await db.prepare(`INSERT INTO identity_sessions(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...Object.values(session)).run();
 await assertResult(current,inventory,'independent-evidence');
 assert.equal((await inventory.inspect()).currentSequence,2);
 await owner.revoke();await assertResult(current,inventory);

 // New unresolved effects in CURRENT source hold even when absent from the archive.
 const effect=id();await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-02','2026-10-02')").bind(effect,owner.account,'a'.repeat(64)).run();
 await assertResult(current,inventory,'independent-evidence');
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(effect).run();
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?").bind(effect).run();
 await assertResult(current,inventory);
 const exchange=id();await db.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state) VALUES(?,?,'github','synthetic','unknown','fixture-current',1,'dispatched')").bind(exchange,owner.account).run();
 await assertResult(current,inventory,'independent-evidence');
 await db.prepare("INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,'rejected','bad_verification_code',200,created_at FROM connection_oauth_exchanges WHERE token_id=?").bind(exchange).run();
 await db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).run();
 await assertResult(current,inventory);

 // Change the real source after the first snapshot has been read. Both full
 // observations must agree, even for a record not present in the candidate.
 const addedUser=id();await db.prepare("INSERT INTO users VALUES(?,?,'2026-10-02')").bind(addedUser,'added@example.invalid').run();
 let sourceReads=0;
 const racing=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{},async()=>{
  if(++sourceReads===1)await db.prepare("UPDATE users SET email='changed@example.invalid' WHERE id=?").bind(addedUser).run();
 }));
 await assertResult(current,racing,'independent-evidence');assert.equal(sourceReads,2);
 await assertResult(current,racing); // A prior refusal doesn't poison later reads.

 // Another handle may withdraw while source observation is in flight.
 const doomed=await register(inventory);let withdrew=false;
 const withdrawalRace=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{
  if(!withdrew){withdrew=true;await restarted.withdrawArchive({snapshotId:doomed.manifest.snapshotId});}
 }));
 await assertResult(doomed,withdrawalRace,'independent-evidence');
 assert.equal((await inventory.evidenceSource.fetch(request(doomed.manifest))).status,404);

 // A concurrent journal write fences an automatic observation batch.
 await db.prepare('UPDATE users SET email=? WHERE id=?').bind('PRIVATE_RACED_PROFILE_CANARY',owner.account).run();
 let journalRace=false;const sequenceBefore=(await inventory.inspect()).currentSequence;
 const competing=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{
  if(!journalRace){journalRace=true;await restarted.observe({operationId:'competitor',selection:{kind:'owner-erased',ownerId:'never-present'}});}
 }));
 await assertResult(current,competing,'independent-evidence');assert.equal((await inventory.inspect()).currentSequence,sequenceBefore+1,'Only the competing observation commits');
 await assertResult(current,inventory,'stale-authority');
 current=await register(inventory);await assertResult(current,inventory);

 // A source with an obsolete or incomplete schema cannot issue fresh evidence.
 const wrongSource=new DatabaseSync(':memory:');wrongSource.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
 // It is now refused when the authority is opened (the observer cannot read its registry), before any evidence request can exist.
 try{await assert.rejects(()=>syntheticAuthority(sqliteD1Adapter(wrongSource)),{code:'source-observation'});refusals++;}finally{wrongSource.close();}
 // Old operator inventories are explicitly refused; no migration/old reader.
 const oldFile=join(directory,'obsolete.whumpo-restore-inventory');await writeFile(oldFile,Buffer.alloc(0),{mode:0o600});
 const obsolete=new DatabaseSync(oldFile);obsolete.exec("CREATE TABLE identity(singleton INTEGER PRIMARY KEY,version INTEGER CHECK(version=1)); INSERT INTO identity VALUES(1,1)");obsolete.close();
 const oldAuthority=await syntheticAuthority(db);
 await reject(()=>openRestoreInventory({inventoryFile:oldFile,expectedStreamId:streamId,authority:oldAuthority}));

 // Bounds apply to the entire derived batch. There is no partial suppression
 // prefix, truncation or empty-history replacement when 513 removals are seen.
 await db.batch(Array.from({length:513},(_,i)=>db.prepare("INSERT INTO activity_events(id,user_id,action,summary,created_at) VALUES(?,?,'fixture','Private bounded observation','2026-10-02')").bind('bound-'+i,owner.account)));
 const large=await register(inventory),beforeBound=(await inventory.inspect()).currentSequence;
 await db.prepare("DELETE FROM activity_events WHERE id LIKE 'bound-%'").run();
 await assertResult(large,inventory,'independent-evidence');assert.equal((await inventory.inspect()).currentSequence,beforeBound);

 const bytes=await readFile(inventoryFile);
 for(const canary of ['PRIVATE_SOURCE_PROFILE_CANARY','PRIVATE_CHANGED_PROFILE_CANARY','PRIVATE_RACED_PROFILE_CANARY','PRIVATE_SOURCE_FAILURE_CANARY',JSON.parse(keyring).keys[0].secret])assert.ok(!bytes.includes(Buffer.from(canary)));
 console.log(JSON.stringify({suite:'restore-inventory-freshness',refusals,verified,realReadOnlyCopies:copies.length,automaticSuppression:true,sourceRacesHeld:true,wholeBatchBound:true,liveProviderAccess:false}));
}finally{globalThis.fetch=network;for(const h of handles.reverse())await h.close();for(const c of copies)c.close();await fixture.close();await keys.close();await rm(directory,{recursive:true,force:true});}

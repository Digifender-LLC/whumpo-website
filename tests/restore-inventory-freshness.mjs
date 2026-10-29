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

Error.stackTraceLimit=0;
const directory=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-inventory-freshness-'),inventoryFile=join(directory,'current.whumpo-restore-inventory'),streamId='fresh-source',id=()=>crypto.randomUUID();
const fixture=await sqliteD1(),{db,sql}=fixture,{identity:m}=await currentFixtureModules([]),keys=await keyBackupFixture(),keyring=fixtureKeyring(),{proof:keyBackup}=await keys.create(keyring);
const copies=[],handles=[];let refusals=0,verified=0;const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('No network permitted');
const open=async(sourceDb=db)=>{const h=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,...(sourceDb?{sourceDb}:{})});handles.push(h);return h;};
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
 await db.prepare('UPDATE users SET created_at=? WHERE id=?').bind('PRIVATE_SOURCE_PROFILE_CANARY',owner.account).run();
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
 await db.prepare('UPDATE users SET created_at=? WHERE id=?').bind('PRIVATE_CHANGED_PROFILE_CANARY',owner.account).run();
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
 const addedUser=id();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-02')").bind(addedUser,'added@example.invalid').run();
 let sourceReads=0;
 const racing=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{},async()=>{
  if(++sourceReads===1)await db.prepare("UPDATE users SET created_at='changed@example.invalid' WHERE id=?").bind(addedUser).run();
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
 await db.prepare('UPDATE users SET created_at=? WHERE id=?').bind('PRIVATE_RACED_PROFILE_CANARY',owner.account).run();
 let journalRace=false;const sequenceBefore=(await inventory.inspect()).currentSequence;
 const competing=await open(interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{
  if(!journalRace){journalRace=true;await restarted.observe({operationId:'competitor',selection:{kind:'owner-erased',ownerId:'never-present'}});}
 }));
 await assertResult(current,competing,'independent-evidence');assert.equal((await inventory.inspect()).currentSequence,sequenceBefore+1,'Only the competing observation commits');
 await assertResult(current,inventory,'stale-authority');
 current=await register(inventory);await assertResult(current,inventory);

 // WH-201: a restore must never revive a superseded address change, a used token or an earlier verification state. The change rows and
 // the users row are ordinary watched records, so an archive taken before the current source moved on is held, whichever way it moved.
 {
  const run=(sqlText,...values)=>db.prepare(sqlText).bind(...values).run(),now=Date.now(),email=await db.prepare('SELECT email FROM users WHERE id=?').bind(owner.account).first();
  const key=char=>char.repeat(64),pending=async(changeId,address,deliverable)=>{
   await run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)",owner.account,Date.now());
   if(deliverable)await run("INSERT INTO owner_email_change_limits(kind,address_key,at) VALUES('send',?,?)",key(changeId==='change-one'?'b':'c'),Date.now());
   await run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES(?,?,?,?,?,?,1,?,?,'pending',1,'[\"pending\"]',?)",
    changeId,owner.account,'request-'+changeId,key('a'),address,key(changeId==='change-one'?'b':'c'),Date.now(),Date.now()+3600000,deliverable?1:0);
  };
  await pending('change-one','one@example.test',false);
  const beforeSupersede=await register(inventory);await assertResult(beforeSupersede,inventory);
  await run("UPDATE owner_email_changes SET state='superseded',revision=revision+1,history=json_insert(history,'$[#]','superseded') WHERE change_id='change-one'");
  await assertResult(beforeSupersede,inventory,'stale-authority'); // the superseded change is not revived by restoring the archive that held it pending
  await pending('change-two','two@example.test',true);
  await run("UPDATE owner_email_changes SET token_verifier=?,revision=revision+1 WHERE change_id='change-two'",key('e'));
  const withToken=await register(inventory);await assertResult(withToken,inventory);
  await run("UPDATE owner_email_changes SET state='confirmed',revision=revision+1,history=json_insert(history,'$[#]','confirmed'),previous_address=?,receipt_verified_at=?,undo_until=?+604800000 WHERE change_id='change-two'",email.email,now,now);
  await run("UPDATE users SET email='two@example.test',email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",now,owner.account);
  await assertResult(withToken,inventory,'stale-authority'); // a used token and the old unverified address are not revived
  const verified=await register(inventory);await assertResult(verified,inventory);
  await run("UPDATE owner_email_changes SET state='undone',revision=revision+1,history=json_insert(history,'$[#]','undone') WHERE change_id='change-two'");
  await run('UPDATE users SET email=?,email_verified_at=NULL,email_verified_via=NULL WHERE id=?',email.email,owner.account);
  await assertResult(verified,inventory,'stale-authority'); // the verified state is not revived once undone
  current=await register(inventory);await assertResult(current,inventory);
 }
 // WH-203: a restore must never revive an open compromise review after it committed (the epoch advanced, the sessions are gone).
 {
  const run=(sqlText,...values)=>db.prepare(sqlText).bind(...values).run(),t=Date.now();
  const a=await db.prepare('SELECT auth_epoch,credential_revision,kit_generation FROM identity_accounts WHERE account_id=?').bind(owner.account).first();
  await run("INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) VALUES('review-restore',?,?,?,?,'[]','[]',?,?,'open',1)",owner.account,a.auth_epoch,a.credential_revision,a.kit_generation,t,t+600000);
  const openArchive=await register(inventory);await assertResult(openArchive,inventory);
  await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',owner.account);
  await run("UPDATE owner_security_reviews SET state='committed',revision=revision+1,commit_request_id='request-restore',commit_request_hash=?,receipt=?,committed_at=? WHERE review_id='review-restore'",'a'.repeat(64),JSON.stringify({reviewId:'review-restore',epoch:a.auth_epoch+1,stage:'ready',revokedCredentials:[],kitRotated:false,pendingEmailChange:null,connections:[],sessionsRevoked:'all',accountRecoveryOnly:true}),Date.now());
  await assertResult(openArchive,inventory,'stale-authority'); // the archive that held the review open and the earlier epoch is not revived
  current=await register(inventory);await assertResult(current,inventory);
 }
 // A source with an obsolete or incomplete schema cannot issue fresh evidence.
 const wrongSource=new DatabaseSync(':memory:');wrongSource.exec('CREATE TABLE users(id TEXT PRIMARY KEY)');
 try{const wrong=await open(sqliteD1Adapter(wrongSource));await assertResult(current,wrong,'independent-evidence');}finally{wrongSource.close();}
 // Old operator inventories are explicitly refused; no migration/old reader.
 const oldFile=join(directory,'obsolete.whumpo-restore-inventory');await writeFile(oldFile,Buffer.alloc(0),{mode:0o600});
 const obsolete=new DatabaseSync(oldFile);obsolete.exec("CREATE TABLE identity(singleton INTEGER PRIMARY KEY,version INTEGER CHECK(version=1)); INSERT INTO identity VALUES(1,1)");obsolete.close();
 await reject(()=>openRestoreInventory({inventoryFile:oldFile,expectedStreamId:streamId,sourceDb:db}));

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

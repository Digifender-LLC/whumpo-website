import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import * as realInventory from '../tools/restore-inventory.mjs';
import {inspectIsolatedRestore,restoreManifestDigest} from '../tools/restore-admission.mjs';
import {runContainment,retentionMs} from '../tools/operator-containment-input.mjs';
import {syntheticAuthority} from './helpers/synthetic-platform.mjs';

// WH-008: operator containments created AFTER an archive are current-source-only rows. The inventory watches the fixed
// declared authority tables (restoreAuthorityTables) so a candidate lacking such a row holds as stale-authority, no matter
// which archive is inspected first. Real SQLite copies of the current schema, the real operator containment input path
// (WH-050: containment, project serving stop, lift/close, session revocation, 90-day retention cleanup), the real inventory
// evidence source and the real admission verifier. `serving` is a scope value of operator_containments, not a table.
// Fixture-only manipulations (labelled FIXTURE-ONLY) are limited to what the database clock cannot do: moving a row's
// timestamps into the past with schema-consistent values, and the deliberately illegal removals of section 4.
// The source is the recovery SOURCE AUTHORITY (tools/recovery-authority.mjs): the real release provider's observer and D1 REST
// adapter over a synthetic local account API (tests/helpers/synthetic-platform.mjs) bound to the fixture SQLite database; a raw
// database adapter is refused by the inventory. SQLite only; not D1, not a live account or database, not the WH-050 browser
// serving test, and no acceptance of recovery: every result keeps serving, provider dispatch and key retirement false.
Error.stackTraceLimit=0;
const toolsDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'..','tools');
const id=()=>crypto.randomUUID(),hours=n=>new Date(Date.now()+n*3600000).toISOString(),DAY=86400000;
const keys=await keyBackupFixture(),keyring=fixtureKeyring(),{proof:keyBackup}=await keys.create(keyring);
const {identity:m}=await currentFixtureModules([]);
const REASON='PRIVATE_CONTAINMENT_REASON_CANARY',OPERATOR='human:private-containment-operator';
const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('Operator inventory must not access real providers');
const worlds=[];let holds=0,verifications=0;

async function world(label,inventoryModule=realInventory){
 const directory=await mkdtemp('/tmp/whumpo-containment-evidence-'),file=join(directory,'current.whumpo-restore-inventory'),streamId='containment-'+label;
 const fixture=await sqliteD1(),{db,sql}=fixture,copies=[],handles=[];
 await initializeFixtureKeys(db,keyring);
 const owner=await workspaceFixture(db,m);
 const project=async()=>{const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Testing','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(p,owner.account).run();return p;};
 const projectId=await project();
 await inventoryModule.createRestoreInventory({inventoryFile:file,streamId});
 // `source` is the database bound to the synthetic platform (null: an offline, status-only handle).
 const open=async(source=db)=>{const h=await inventoryModule.openRestoreInventory({inventoryFile:file,expectedStreamId:streamId,...(source?{authority:await syntheticAuthority(source)}:{})});handles.push(h);return h;};
 // An authority that was proven, after which its source database stops answering: unobservable, never "unchanged".
 const openBreaking=async()=>{let broken=false;const flaky={...db,prepare:sql=>{if(broken)throw Error('PRIVATE_SOURCE_FAILURE_CANARY');return db.prepare(sql);},batch:async statements=>{if(broken)throw Error('PRIVATE_SOURCE_FAILURE_CANARY');return db.batch(statements);}};const h=await open(flaky);return {handle:h,breakSource:()=>{broken=true;}};};
 const inventory=await open();
 const register=async(handle=inventory)=>{
  const f=join(directory,id()+'.sqlite');await backup(sql,f);const copied=new DatabaseSync(f,{readOnly:true});copies.push(copied);
  const candidate=sqliteD1Adapter(copied),manifest=await handle.registerArchive({archiveDb:candidate,snapshotId:id(),keyBackup});return {candidate,manifest};
 };
 const inspect=async(archive,handle=inventory)=>{
  const result=await inspectIsolatedRestore({db:archive.candidate,manifest:archive.manifest,keyBackup,evidenceSource:handle.evidenceSource,expectedStreamId:streamId});
  for(const key of ['servingAllowed','providerDispatchAllowed','retirementAllowed'])assert.equal(result[key],false);
  return result;
 };
 const verified=async(archive,handle)=>{const r=await inspect(archive,handle);assert.equal(r.status,'verified');assert.deepEqual(r.holds,[]);verifications++;return r;};
 const held=async(archive,code,handle)=>{const r=await inspect(archive,handle);assert.equal(r.status,'held');assert.deepEqual(r.holds,[code]);holds++;return r;};
 const outcome=async(archive,handle)=>{const r=await inspect(archive,handle);return r.status==='verified'?'verified':r.holds[0];};
 const request=manifest=>new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:id()})});
 const evidence=async(archive,handle=inventory)=>{const response=await handle.evidenceSource.fetch(request(archive.manifest));assert.equal(response.status,200);return response.json();};
 // A request the evidence source refuses outright (it throws; the verifier then holds independent-evidence).
 const refused=(archive,handle=inventory)=>assert.rejects(()=>handle.evidenceSource.fetch(request(archive.manifest)),/unavailable/);
 const events=async()=>(await inventory.inspect()).currentSequence;
 // The real operator path: preview, then apply the exact reviewed digest.
 const operate=async input=>{const preview=await runContainment(db,input);return runContainment(db,input,preview.applyDigest);};
 const contain=async(subject,scopes,expiresAt=hours(48))=>{const cid=id();await operate({action:'contain',id:cid,subject,scopes,expiresAt,operator:OPERATOR,reason:REASON});return cid;};
 const lift=cid=>operate({action:'lift',id:cid,operator:OPERATOR,reason:REASON});
 // The real operator path for the WH-050 actions: each is a preview, then apply of the exact reviewed digest.
 const stopServing=async(project,expiresAt=hours(48))=>{const cid=id();await operate({action:'stop-serving',id:cid,project,expiresAt,operator:OPERATOR,reason:REASON});return cid;};
 const closeAction=cid=>operate({action:'close',id:cid,operator:OPERATOR,reason:REASON});
 const revoke=async(account=owner.account)=>{const rid=id();const result=await operate({action:'revoke-sessions',id:rid,account,operator:OPERATOR,reason:REASON});return {id:rid,result};};
 // Real retention cleanup: the receipt-gated insert whose trigger deletes the listed records. The cutoff is a real instant at
 // least 90 days before the database clock, so nothing here bypasses a retention guard.
 const cleanup=async(days=91)=>{
  const input={action:'cleanup',id:id(),before:new Date(Date.now()-days*86400000).toISOString(),operator:OPERATOR},preview=await runContainment(db,input);
  assert.ok(preview.applyDigest,'cleanup has something eligible');
  return {id:input.id,preview,receipt:(await runContainment(db,input,preview.applyDigest)).receipt};
 };
 const cleanupPreview=async(days=91)=>runContainment(db,{action:'cleanup',id:id(),before:new Date(Date.now()-days*86400000).toISOString(),operator:OPERATOR});
 // FIXTURE-ONLY: the database clock cannot move and the admission triggers only admit rows created now, so aging is done by
 // dropping and restoring the named guard around one UPDATE (as tests/operator-containment.mjs does). Values stay consistent
 // with the schema: created <= expiry within 30 days; a lifted row was resolved before its expiry; a closed row after it.
 // Age BEFORE registering the archive that is meant to contain the row, otherwise the digest change itself holds it.
 const rewrite=async(name,sql,...values)=>{
  const trigger=(await db.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(name).first()).sql;
  await db.prepare('DROP TRIGGER '+name).run();try{await db.prepare(sql).bind(...values).run();}finally{await db.prepare(trigger).run();}
 };
 const iso=ms=>new Date(ms).toISOString();
 const age=async(cid,ms)=>{
  const [{resolution}]=(await db.prepare('SELECT resolution FROM operator_containments WHERE id=? AND resolved_at IS NOT NULL').bind(cid).all()).results,resolved=Date.now()-ms;
  await rewrite('operator_containment_resolve','UPDATE operator_containments SET created_at=?,expires_at=?,resolved_at=? WHERE id=?',iso(resolved-7200000),iso(resolution==='lifted'?resolved+3600000:resolved-60000),iso(resolved),cid);
 };
 // FIXTURE-ONLY: an unresolved action whose expiry passed `ms` ago (a real expiry needs real waiting).
 const expireOld=(cid,ms)=>rewrite('operator_containment_resolve','UPDATE operator_containments SET created_at=?,expires_at=? WHERE id=? AND resolved_at IS NULL',iso(Date.now()-ms-7200000),iso(Date.now()-ms),cid);
 // FIXTURE-ONLY: the table forbids deletes of unresolved or young rows. This stands in for an ILLEGAL removal (a database
 // restored from elsewhere, an operator with direct access), used only by section 4. Normal retention uses `cleanup` above.
 const fixtureDelete=async cid=>{
  const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='operator_containment_retained'").first()).sql;
  await db.prepare('DROP TRIGGER operator_containment_retained').run();await db.prepare('DELETE FROM operator_containments WHERE id=?').bind(cid).run();await db.prepare(trigger).run();
 };
 // A second account and a project it owns (a safety hold on one owner holds that owner's whole subtree).
 const otherOwner=async()=>{const account=await workspaceFixture(db,m),p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Testing','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(p,account.account).run();return {account:account.account,projectId:p,session:account};};
 const hold=async(account,projectId,holdId)=>{
  await db.prepare("INSERT OR IGNORE INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)").bind('case-'+holdId,account).run();
  await db.prepare("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)").bind(holdId,'case-'+holdId,account,projectId).run();
 };
 const release=holdId=>db.prepare("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?").bind(holdId).run();
 const present=async cid=>(await db.prepare('SELECT count(*) AS n FROM operator_containments WHERE id=?').bind(cid).first()).n;
 // FIXTURE-ONLY bulk rows (the admission trigger still applies): many distinct retained containment rows without 500 operator previews.
 const bulk=async count=>db.batch(Array.from({length:count},()=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Bulk fixture',?,?)").bind(id(),owner.account,'b'.repeat(64),hours(24))));
 // FIXTURE-ONLY: many distinct RESOLVED containment rows, lifted and aged `ms` ago with schema-consistent timestamps (one UPDATE).
 const agedBulk=async(count,ms)=>{
  const ids=Array.from({length:count},id),resolved=Date.now()-ms;
  await db.batch(ids.map(cid=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Aged bulk fixture',?,?)").bind(cid,owner.account,'b'.repeat(64),hours(24))));
  await rewrite('operator_containment_resolve',"UPDATE operator_containments SET created_at=?,expires_at=?,resolution='lifted',resolved_at=?,resolved_by='human:fixture',resolution_reason='Aged bulk fixture',resolution_digest=? WHERE id IN (SELECT value FROM json_each(?))",iso(resolved-7200000),iso(resolved+3600000),iso(resolved),'e'.repeat(64),JSON.stringify(ids));
  return ids;
 };
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;for(const h of handles.reverse())await h.close();for(const c of copies)c.close();fixture.close();await rm(directory,{recursive:true,force:true});};
 const w={db,owner,projectId,project,operate,open,openBreaking,inventory,register,inspect,verified,held,outcome,evidence,refused,events,contain,lift,stopServing,closeAction,revoke,cleanup,cleanupPreview,rewrite,age,expireOld,fixtureDelete,agedBulk,otherOwner,hold,release,present,bulk,directory,file,close};
 worlds.push(w);return w;
}

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
  holds+=finals.size*2;
 }
 {
  // The same with the real 90-day cleanup of the lifted, aged stop: observed first, unobserved, or after the fresh archive (the observed-first order is section 7).
  // Final outcomes cannot depend on the order (the event counts do: an unobserved row leaves one event fewer).
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
  holds+=finals.size;verifications+=finals.size;
 }

 // 3. A lift or an expiry BEFORE the first evidence run still holds the old archive (active-only watching would have verified it).
 {
  const w=await world('lifted-before-inspection'),a0=await w.register();
  const c1=await w.contain({kind:'project',id:w.projectId},{backend:'freeze'});await w.lift(c1);
  await w.held(a0,'stale-authority');await w.close();
 }
 {
  const w=await world('expired-before-inspection'),a0=await w.register();
  // The trigger admits only a future expiry, so use the shortest real one and let it pass.
  await w.db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Short expiry',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 seconds'))").bind(id(),w.owner.account,'c'.repeat(64)).run();
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
  await assert.rejects(()=>w.inventory.evidenceSource.fetch(new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:a0.manifest.snapshotId,manifestDigest:restoreManifestDigest(a0.manifest),challenge:id()})})),/unavailable/);
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

 // 6. WH-050 serving stop (scope `serving` of operator_containments, not a table): the real stop-serving tool after an archive,
 //    then lift and close. An unpublished draft project can be stopped, so no site publication is needed.
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
  const s2=id();
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

 // 7. Real 90-day cleanup of an OBSERVED resolved stop. The only synthetic input is the row's age (FIXTURE-ONLY `age`).
 {
  const w=await world('cleanup-observed'),a0=await w.register(),counts=[];
  const s=await w.stopServing(w.projectId);await w.lift(s);await w.age(s,100*DAY);
  const a1=await w.register(); // contains the aged resolved stop
  await w.held(a0,'stale-authority');counts.push(await w.events());
  await w.verified(a1);counts.push(await w.events());
  const preview=await w.cleanupPreview();
  assert.deepEqual(preview.delete,{containments:1,revocations:0,receipts:0});
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:1,revocations:0,receipts:0});
  assert.equal(await w.present(s),0,'The receipt trigger deleted the listed stop');
  // The observed row is now observed-absent: an archive that never had it verifies; the one that contained it holds permanently.
  await w.verified(a0);counts.push(await w.events());
  assert.deepEqual((await w.evidence(a0)).events.map(e=>e.kind),['record-current','record-suppressed']);
  await w.held(a1,'suppressed-record');counts.push(await w.events());
  assert.deepEqual(counts,[1,1,2,2],'Events only grow; the deletion is one more event, never a freed slot');
  // A point taken after the cleanup lacks the row and holds the cleanup receipt (not a watched authority table): it verifies.
  const a2=await w.register();await w.verified(a2);assert.equal(await w.events(),2);
  assert.ok(!(await readFile(w.file)).includes(Buffer.from(REASON)));
  await w.close();
 }

 // 8. Real cleanup with NO evidence run in between leaves no history. Stated residual: operators must run evidence for every
 //    registered archive before applying cleanup or session revocation; nothing enforces it.
 {
  const w=await world('cleanup-unobserved'),a0=await w.register();
  const s=await w.stopServing(w.projectId);await w.lift(s);await w.age(s,100*DAY);
  const a1=await w.register();
  await w.cleanup();assert.equal(await w.present(s),0);
  await w.verified(a0);assert.equal(await w.events(),0,'No trace was recorded: the older archive verifies (an expired record only)');
  // The archive that contained the resolved row still holds, because its own record is watched. Cleanup invalidates old archives.
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),1);
  assert.deepEqual((await w.evidence(a1)).events.map(e=>e.kind),['record-suppressed']);
  await w.close();
 }

 // 9. Rows cleanup must keep: active, expired-but-unresolved, resolved inside 90 days, and safety-held. Direct deletes refuse too.
 //    An unreleased safety hold in the source refuses every evidence request, so the evidence is checked after the release.
 {
  const w=await world('retention-kept'),a0=await w.register(),other=await w.otherOwner(),p3=await w.project(),p5=await w.project();
  const active=await w.contain({kind:'account',id:w.owner.account},{contact:'freeze'});
  const expired=await w.stopServing(w.projectId);await w.expireOld(expired,100*DAY);
  const within=await w.stopServing(p3);await w.lift(within);await w.age(within,90*DAY-3600000);
  const heldRow=await w.stopServing(other.projectId);await w.lift(heldRow);await w.age(heldRow,100*DAY);
  const eligible=await w.stopServing(p5);await w.lift(eligible);await w.age(eligible,100*DAY);
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

 // 10. Cleanup receipts retire older cleanup receipts. Receipts are archive records, so an archive that contains a retired
 //     receipt holds as suppressed-record; the cleanup receipt table is not a watched authority table.
 {
  const w=await world('receipt-retirement'),a0=await w.register();
  const s=await w.stopServing(w.projectId);await w.lift(s);await w.age(s,100*DAY);
  const first=await w.cleanup(); // receipt R1
  await w.rewrite('operator_retention_immutable','UPDATE operator_retention_receipts SET created_at=? WHERE id=?',new Date(Date.now()-100*DAY).toISOString(),first.id);
  const aR=await w.register(); // contains R1, aged past retention
  await w.verified(aR);await w.verified(a0);assert.equal(await w.events(),0,'A cleanup receipt is not a watched authority row');
  const preview=await w.cleanupPreview();
  assert.deepEqual(preview.delete,{containments:0,revocations:0,receipts:1});assert.equal(preview.receiptCapacity.stored,1);assert.equal(preview.receiptCapacity.afterCleanup,1);
  const second=await w.cleanup();assert.deepEqual(second.receipt.deleted,{containments:0,revocations:0,receipts:1});
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(first.id).first()).n,0);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM operator_retention_receipts WHERE id=?').bind(second.id).first()).n,1);
  await w.held(aR,'suppressed-record');assert.equal(await w.events(),1);
  await w.verified(a0);
  const aR2=await w.register();await w.verified(aR2);assert.equal(await w.events(),1);
  await w.close();
 }

 // 11. WH-050 session revocation. It deletes identity_sessions rows, which are archive records, so a containing archive holds
 //     as suppressed-record even if no evidence ran before the revocation. auth_epoch and credential_revision are deliberately
 //     unchanged, so stale-identity is NOT a second line of defence. The revocation receipt is not an authority row.
 {
  const w=await world('revocation'),a0=await w.register(); // contains the owner's workspace session
  await w.verified(a0);
  const identityBefore=await w.db.prepare('SELECT auth_epoch,credential_revision FROM identity_accounts WHERE account_id=?').bind(w.owner.account).first();
  const {id:rid,result}=await w.revoke();
  assert.equal(result.revocation.revokedSessions,1);
  assert.equal((await w.db.prepare('SELECT count(*) AS n FROM identity_sessions WHERE account_id=?').bind(w.owner.account).first()).n,0);
  const identityAfter=await w.db.prepare('SELECT auth_epoch,credential_revision FROM identity_accounts WHERE account_id=?').bind(w.owner.account).first();
  assert.equal(identityAfter.auth_epoch,identityBefore.auth_epoch);assert.equal(identityAfter.credential_revision,identityBefore.credential_revision);
  // First inspected AFTER the revocation: the archive's own session record is observed absent.
  await w.held(a0,'suppressed-record');assert.equal(await w.events(),1);
  const evidence=await w.evidence(a0);
  assert.deepEqual(evidence.events.map(e=>e.kind),['record-suppressed']);
  assert.deepEqual(evidence.events[0].data,{table:'identity_sessions',key:{id:w.owner.authority}});
  assert.ok(!evidence.events.some(e=>e.kind==='identity-epoch'),'No epoch event: revocation does not advance the identity epoch');
  // An archive taken after the revocation has no sessions and contains the receipt, which is not watched: verified.
  await w.rewrite('operator_session_revocation_immutable','UPDATE operator_session_revocations SET created_at=? WHERE id=?',new Date(Date.now()-100*DAY).toISOString(),rid);
  const a1=await w.register();await w.verified(a1);assert.equal(await w.events(),1);
  // A later sign-in is an ordinary new row: not watched, and a0 is unchanged.
  await workspaceSession(w.db,m,{account:w.owner.account,credential:w.owner.credential});
  await w.held(a0,'suppressed-record');assert.equal(await w.events(),1);
  // Retiring the aged receipt by cleanup holds the archive that contained it.
  const cleaned=await w.cleanup();assert.deepEqual(cleaned.receipt.deleted,{containments:0,revocations:1,receipts:0});
  await w.held(a1,'suppressed-record');assert.equal(await w.events(),2);
  await w.close();
 }

 // 12. The 512-event bound with the WH-050 actions: cleanup never frees events.
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

 // 13. PINNED GAP (not accepted behaviour): reusing the id of an observed, cleaned containment. Nothing forbids it: the tool and
 //     the admission trigger look only at existing rows. If an evidence run observed the absence in between, the identity is a
 //     permanent record-suppressed event, and the reused row makes EVERY later evidence request for the whole stream fail
 //     closed. A fix needs a design decision (see docs/restore-admission.md); this test pins today's behaviour so a fix flips it.
 {
  const w=await world('id-reuse-observed'),a0=await w.register();
  const s=await w.stopServing(w.projectId);await w.lift(s);await w.age(s,100*DAY);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  await w.cleanup();assert.equal(await w.present(s),0);
  await w.verified(a0);assert.equal(await w.events(),2,'The absence was observed: permanent record-suppressed');
  await w.operate({action:'stop-serving',id:s,project:w.projectId,expiresAt:hours(48),operator:OPERATOR,reason:REASON}); // the SAME id, a fresh future expiry
  assert.equal(await w.present(s),1,'The tool accepted the reused id');
  await w.refused(a0);await w.held(a0,'independent-evidence');
  const a1=await w.register();await w.refused(a1);await w.held(a1,'independent-evidence');
  assert.equal(await w.events(),2,'Fail closed: nothing appended, no archive can verify');
  await w.lift(s); // lifting does not remove the row, so the stream stays refused until the row itself can be cleaned (>= 90 days)
  await w.refused(a1);await w.held(a1,'independent-evidence');
  await w.close();
 }
 {
  // The block depends on evidence timing: reuse BEFORE any run observed the absence is only an ordinary changed row.
  const w=await world('id-reuse-unobserved'),a0=await w.register();
  const s=await w.stopServing(w.projectId);await w.lift(s);await w.age(s,100*DAY);
  await w.held(a0,'stale-authority');assert.equal(await w.events(),1);
  await w.cleanup();
  await w.operate({action:'stop-serving',id:s,project:w.projectId,expiresAt:hours(48),operator:OPERATOR,reason:REASON});
  await w.held(a0,'stale-authority');assert.equal(await w.events(),2,'Looks like a changed row (new digest), not a suppression');
  const a1=await w.register();await w.verified(a1);
  await w.close();
 }

 // 14. Negative canary: the same scenario (a containment and a serving stop) against a copy of the inventory module with the declared set emptied must NOT hold.
 {
  const scenario=async module=>{
   const w=await world('canary',module),a0=await w.register();
   await w.contain({kind:'project',id:w.projectId},{backend:'freeze'});await w.stopServing(w.projectId);
   const result=await w.outcome(a0);await w.close();return result;
  };
  assert.equal(await scenario(realInventory),'stale-authority');
  const original='export const restoreAuthorityTables=Object.freeze([\'operator_containments\']);';
  let source=await readFile(join(toolsDirectory,'restore-inventory.mjs'),'utf8');
  assert.ok(source.includes(original),'The canary must find the declaration it removes');
  source=source.replace(original,'export const restoreAuthorityTables=Object.freeze([]);').replaceAll("from './",`from '${pathToFileURL(toolsDirectory).href}/`);
  assert.ok(!source.includes(original));
  const directory=await mkdtemp('/tmp/whumpo-containment-canary-'),file=join(directory,'restore-inventory-canary.mjs');
  try{
   await writeFile(file,source);
   assert.equal(await scenario(await import(pathToFileURL(file).href)),'verified','Without derivation the old archive verifies, with a containment and a serving stop: the gap this suite pins');
  }finally{await rm(directory,{recursive:true,force:true});}
 }
 console.log(JSON.stringify({suite:'restore inventory operator-containment evidence',worlds:worlds.length,holds,verifications,authorityTables:[...realInventory.restoreAuthorityTables],servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,liveProviderAccess:false}));
}finally{
 globalThis.fetch=network;
 for(const w of worlds)await w.close().catch(()=>{});
 await keys.close();
}

import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import * as realInventory from '../tools/restore-inventory.mjs';
import {inspectIsolatedRestore,restoreManifestDigest} from '../tools/restore-admission.mjs';
import {runContainment} from '../tools/operator-containment-input.mjs';
import {syntheticAuthority} from './helpers/synthetic-platform.mjs';

// WH-008: operator containments created AFTER an archive are current-source-only rows. The inventory watches the fixed
// declared authority tables (restoreAuthorityTables) so a candidate lacking such a row holds as stale-authority, no matter
// which archive is inspected first. Real SQLite copies of the current schema, the real operator containment input path,
// the real inventory evidence source and the real admission verifier. Fixture-only manipulations are labelled FIXTURE-ONLY.
// The source is the recovery SOURCE AUTHORITY (tools/recovery-authority.mjs): the real release provider's observer and D1 REST
// adapter over a synthetic local account API (tests/helpers/synthetic-platform.mjs) bound to the fixture SQLite database; a raw
// database adapter is refused by the inventory. SQLite only; not D1, not a live account or database, not WH-050's serving stop
// (a different, unmerged tree).
Error.stackTraceLimit=0;
const toolsDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'..','tools');
const id=()=>crypto.randomUUID(),hours=n=>new Date(Date.now()+n*3600000).toISOString();
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
 const events=async()=>(await inventory.inspect()).currentSequence;
 // The real operator path: preview, then apply the exact reviewed digest.
 const operate=async input=>{const preview=await runContainment(db,input);return runContainment(db,input,preview.applyDigest);};
 const contain=async(subject,scopes,expiresAt=hours(48))=>{const cid=id();await operate({action:'contain',id:cid,subject,scopes,expiresAt,operator:OPERATOR,reason:REASON});return cid;};
 const lift=cid=>operate({action:'lift',id:cid,operator:OPERATOR,reason:REASON});
 // FIXTURE-ONLY: the table forbids deletes (rows are append-only audit). The guard is dropped and restored around the write, as
 // tests/operator-containment.mjs moves its clock. It stands in for a future reviewed retention cleanup, which does not exist here.
 const fixtureDelete=async cid=>{
  const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='operator_containment_retained'").first()).sql;
  await db.prepare('DROP TRIGGER operator_containment_retained').run();await db.prepare('DELETE FROM operator_containments WHERE id=?').bind(cid).run();await db.prepare(trigger).run();
 };
 // FIXTURE-ONLY bulk rows (the admission trigger still applies): many distinct retained containment rows without 500 operator previews.
 const bulk=async count=>db.batch(Array.from({length:count},()=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Bulk fixture',?,?)").bind(id(),owner.account,'b'.repeat(64),hours(24))));
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;for(const h of handles.reverse())await h.close();for(const c of copies)c.close();fixture.close();await rm(directory,{recursive:true,force:true});};
 const w={db,owner,projectId,project,open,openBreaking,inventory,register,inspect,verified,held,outcome,evidence,events,contain,lift,fixtureDelete,bulk,directory,file,close};
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
  assert.equal((await w.db.prepare("SELECT count(*) AS n FROM operator_containments WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND lifted_at IS NULL").first()).n,1,'The row really expired');
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
  assert.equal((await w.db.prepare("SELECT count(*) AS n FROM operator_containments WHERE lifted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").first()).n,513);
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
  const original='export const restoreAuthorityTables=Object.freeze([\'operator_containments\']);';
  let source=await readFile(join(toolsDirectory,'restore-inventory.mjs'),'utf8');
  assert.ok(source.includes(original),'The canary must find the declaration it removes');
  source=source.replace(original,'export const restoreAuthorityTables=Object.freeze([]);').replaceAll("from './",`from '${pathToFileURL(toolsDirectory).href}/`);
  assert.ok(!source.includes(original));
  const directory=await mkdtemp('/tmp/whumpo-containment-canary-'),file=join(directory,'restore-inventory-canary.mjs');
  try{
   await writeFile(file,source);
   assert.equal(await scenario(await import(pathToFileURL(file).href)),'verified','Without derivation the old archive verifies: the gap this suite pins');
  }finally{await rm(directory,{recursive:true,force:true});}
 }
 console.log(JSON.stringify({suite:'restore inventory operator-containment evidence',worlds:worlds.length,holds,verifications,authorityTables:[...realInventory.restoreAuthorityTables],servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,liveProviderAccess:false}));
}finally{
 globalThis.fetch=network;
 for(const w of worlds)await w.close().catch(()=>{});
 await keys.close();
}

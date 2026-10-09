import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sqliteD1,sqliteD1Adapter} from '../sqlite-d1.mjs';
import {currentFixtureModules} from './current-modules.mjs';
import {workspaceFixture,workspaceSession} from './workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './connection-keyring.mjs';
import {keyBackupFixture} from './key-backup.mjs';
import {newActionId,actionIdAged,withoutTriggers} from './operator-action-ids.mjs';
import * as realInventory from '../../tools/restore-inventory.mjs';
import {inspectIsolatedRestore,restoreManifestDigest} from '../../tools/restore-admission.mjs';
import {runContainment,actionIdTime,actionIdWindowMs} from '../../tools/operator-containment-input.mjs';
import {syntheticAuthority} from './synthetic-platform.mjs';

// Shared harness of the restore-inventory operator-containment suites (tests/restore-inventory-containment.mjs: the WH-008
// authority-table derivation; tests/restore-inventory-operator-actions.mjs and tests/restore-inventory-retention.mjs: the WH-050
// serving stop, session revocation and 90-day retention cleanup). The suites are separate scripts only so that each stays well
// inside the 300 s per-script gate timeout of tools/verify.mjs; nothing here is a looser check than the original single file had.
//
// Real SQLite copies of the current schema, the real operator containment input path, the real inventory evidence source and
// the real admission verifier. The source is the recovery SOURCE AUTHORITY (tools/recovery-authority.mjs): the real release
// provider's observer and D1 REST adapter over a synthetic local account API (tests/helpers/synthetic-platform.mjs) bound to the
// fixture SQLite database; a raw database adapter is refused by the inventory. SQLite only; not D1, not a live account or
// database, and no acceptance of recovery: every result keeps serving, provider dispatch and key retirement false.
//
// Fixture-only manipulations are labelled FIXTURE-ONLY. The database clock cannot move and the admission triggers admit only rows
// created now, so a fixture may (a) age a row, (b) back-date an expiry, (c) insert bulk or short-expiry rows directly through
// the admit trigger (they skip the operator tool, not the schema) and (d) make the deliberately illegal removals of the
// containment suite. An aged action row always carries an action id minted for its creation time (`actionIdAged`), exactly as
// a real row of that age would: a young id on an old row would pass the new-id window and so prove nothing about reuse.
Error.stackTraceLimit=0;
export const toolsDirectory=resolve(dirname(fileURLToPath(import.meta.url)),'..','..','tools');
export const id=()=>crypto.randomUUID(); // project, snapshot and challenge ids (not operator action ids)
export const aid=()=>newActionId(); // operator action ids: containment, serving stop, revocation and cleanup receipt
export const hours=n=>new Date(Date.now()+n*3600000).toISOString(),DAY=86400000,HOUR=3600000;
export const REASON='PRIVATE_CONTAINMENT_REASON_CANARY',OPERATOR='human:private-containment-operator';
export const iso=ms=>new Date(ms).toISOString();
export {realInventory,newActionId,actionIdAged,withoutTriggers,runContainment,actionIdTime,workspaceFixture};

/**
 * Creates one suite's harness. `finish(extra)` prints the JSON summary; `dispose()` always runs in the suite's `finally`.
 * `m` is the current identity module, `counts` the asserted holds and verifications.
 */
export async function containmentHarness(suite){
 const keys=await keyBackupFixture(),keyring=fixtureKeyring(),{proof:keyBackup}=await keys.create(keyring);
 const {identity:m}=await currentFixtureModules([]);
 const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('Operator inventory must not access real providers');
 const worlds=[],counts={holds:0,verifications:0};

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
  const verified=async(archive,handle)=>{const r=await inspect(archive,handle);assert.equal(r.status,'verified');assert.deepEqual(r.holds,[]);counts.verifications++;return r;};
  const held=async(archive,code,handle)=>{const r=await inspect(archive,handle);assert.equal(r.status,'held');assert.deepEqual(r.holds,[code]);counts.holds++;return r;};
  const outcome=async(archive,handle)=>{const r=await inspect(archive,handle);return r.status==='verified'?'verified':r.holds[0];};
  const request=manifest=>new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:id()})});
  const evidence=async(archive,handle=inventory)=>{const response=await handle.evidenceSource.fetch(request(archive.manifest));assert.equal(response.status,200);return response.json();};
  // A request the evidence source refuses outright (it throws; the verifier then holds independent-evidence).
  const refused=(archive,handle=inventory)=>assert.rejects(()=>handle.evidenceSource.fetch(request(archive.manifest)),/unavailable/);
  const events=async()=>(await inventory.inspect()).currentSequence;
  // The real operator path: preview, then apply the exact reviewed digest.
  const operate=async input=>{const preview=await runContainment(db,input);return runContainment(db,input,preview.applyDigest);};
  const contain=async(subject,scopes,expiresAt=hours(48))=>{const cid=aid();await operate({action:'contain',id:cid,subject,scopes,expiresAt,operator:OPERATOR,reason:REASON});return cid;};
  const lift=cid=>operate({action:'lift',id:cid,operator:OPERATOR,reason:REASON});
  // The real operator path for the WH-050 actions: each is a preview, then apply of the exact reviewed digest.
  const stopServing=async(project,expiresAt=hours(48))=>{const cid=aid();await operate({action:'stop-serving',id:cid,project,expiresAt,operator:OPERATOR,reason:REASON});return cid;};
  const closeAction=cid=>operate({action:'close',id:cid,operator:OPERATOR,reason:REASON});
  const revoke=async(account=owner.account)=>{const rid=aid();const result=await operate({action:'revoke-sessions',id:rid,account,operator:OPERATOR,reason:REASON});return {id:rid,result};};
  // Real retention cleanup: the receipt-gated insert whose trigger deletes the listed records. The cutoff is a real instant at
  // least 90 days before the database clock, so nothing here bypasses a retention guard.
  const cleanupInput=(days=91)=>({action:'cleanup',id:aid(),before:iso(Date.now()-days*DAY),operator:OPERATOR});
  const cleanup=async(days=91)=>{
   const input=cleanupInput(days),preview=await runContainment(db,input);
   assert.ok(preview.applyDigest,'cleanup has something eligible');
   return {id:input.id,preview,receipt:(await runContainment(db,input,preview.applyDigest)).receipt};
  };
  const cleanupPreview=async(days=91)=>runContainment(db,cleanupInput(days));
  // FIXTURE-ONLY: the guarded UPDATEs below drop the named update guard around one statement (as tests/operator-containment.mjs does)
  // and then PROVE it is back: the stored trigger SQL is identical afterwards. Only update guards are dropped; the delete guards
  // and the cleanup admit/apply triggers stay live, so retention conclusions come through the real guards. Values stay
  // consistent with the schema: created <= expiry within 30 days; a lifted row was resolved before its expiry; a closed row after it.
  // Age BEFORE registering the archive that is meant to contain the row, otherwise the digest change itself holds it.
  const rewrite=async(name,statement,...values)=>{
   const stored=(await db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').bind('trigger',name).first()).sql;
   await withoutTriggers(db,[name],()=>db.prepare(statement).bind(...values).run());
   assert.equal((await db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').bind('trigger',name).first())?.sql,stored,'The dropped guard was restored exactly');
  };
  // The aged action row's id moves with its timestamps: minted for the instant the row claims to have been created, and
  // therefore older than the new-id window, so reusing it after cleanup is refused by the schema (the reuse proof).
  const stampedId=createdMs=>{const aged=actionIdAged(Date.now()-createdMs);assert.ok(Math.abs(actionIdTime(aged)-createdMs)<5000);assert.ok(actionIdTime(aged)<Date.now()-actionIdWindowMs,'An aged id is outside the window of a new id');return aged;};
  // FIXTURE-ONLY: a resolved action moved `ms` into the past (created two hours before it was resolved). Returns the new id.
  const age=async(cid,ms)=>{
   const [{resolution}]=(await db.prepare('SELECT resolution FROM operator_containments WHERE id=? AND resolved_at IS NOT NULL').bind(cid).all()).results,resolved=Date.now()-ms,next=stampedId(resolved-2*HOUR);
   await rewrite('operator_containment_resolve','UPDATE operator_containments SET id=?,created_at=?,expires_at=?,resolved_at=? WHERE id=?',next,iso(resolved-2*HOUR),iso(resolution==='lifted'?resolved+HOUR:resolved-60000),iso(resolved),cid);
   return next;
  };
  // FIXTURE-ONLY: an unresolved action whose expiry passed `ms` ago (a real expiry needs real waiting). Returns the new id.
  const expireOld=async(cid,ms)=>{
   const next=stampedId(Date.now()-ms-2*HOUR);
   await rewrite('operator_containment_resolve','UPDATE operator_containments SET id=?,created_at=?,expires_at=? WHERE id=? AND resolved_at IS NULL',next,iso(Date.now()-ms-2*HOUR),iso(Date.now()-ms),cid);
   return next;
  };
  // FIXTURE-ONLY: a revocation or cleanup receipt moved `ms` into the past (its id moves with its creation time). Returns the new id.
  const ageReceipt=async(table,rid,ms)=>{
   const next=stampedId(Date.now()-ms),guard=table==='operator_session_revocations'?'operator_session_revocation_immutable':'operator_retention_immutable';
   await rewrite(guard,`UPDATE ${table} SET id=?,created_at=? WHERE id=?`,next,iso(Date.now()-ms),rid);
   return next;
  };
  // FIXTURE-ONLY: one resolved action, aged with timestamps computed by the DATABASE clock (`modifiers` are SQLite date modifiers
  // for the resolution instant, for example ['-90 days','+30 seconds']), so a boundary test cannot flake on this process's clock.
  const ageBySql=async(cid,modifiers,ageMs)=>{
   const next=stampedId(Date.now()-ageMs-2*HOUR),f="'%Y-%m-%dT%H:%M:%fZ'";
   await rewrite('operator_containment_resolve',`UPDATE operator_containments SET id=?,created_at=strftime(${f},'now',?,?,'-2 hours'),expires_at=strftime(${f},'now',?,?,'+1 hour'),resolved_at=strftime(${f},'now',?,?) WHERE id=?`,next,...modifiers,...modifiers,...modifiers,cid);
   return next;
  };
  // FIXTURE-ONLY: the table forbids deletes of unresolved or young rows. This stands in for an ILLEGAL removal (a database
  // restored from elsewhere, an operator with direct access), used only by the removal cases. Normal retention uses `cleanup` above.
  const fixtureDelete=cid=>withoutTriggers(db,['operator_containment_retained'],()=>db.prepare('DELETE FROM operator_containments WHERE id=?').bind(cid).run());
  // A second account and a project it owns (a safety hold on one owner holds that owner's whole subtree).
  const otherOwner=async()=>{const account=await workspaceFixture(db,m),p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Testing','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(p,account.account).run();return {account:account.account,projectId:p,session:account};};
  // A further workspace session for the owner (an ordinary new identity_sessions row).
  const session=()=>workspaceSession(db,m,{account:owner.account,credential:owner.credential});
  const hold=async(account,projectId,holdId)=>{
   await db.prepare("INSERT OR IGNORE INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)").bind('case-'+holdId,account).run();
   await db.prepare("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)").bind(holdId,'case-'+holdId,account,projectId).run();
  };
  const release=holdId=>db.prepare("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?").bind(holdId).run();
  const present=async cid=>(await db.prepare('SELECT count(*) AS n FROM operator_containments WHERE id=?').bind(cid).first()).n;
  // FIXTURE-ONLY bulk rows (not the operator tool; the admission trigger still applies to each): many distinct retained
  // containment rows without 500 operator previews. Their ids are fresh action ids.
  const bulk=async count=>db.batch(Array.from({length:count},()=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','account',?,NULL,'human:fixture','Bulk fixture',?,?)").bind(aid(),owner.account,'b'.repeat(64),hours(24))));
  // FIXTURE-ONLY: many distinct RESOLVED containment rows, lifted and aged `ms` ago. Each is inserted whole, as it would have
  // stood (id and created_at `ms` + 2 h ago), so the admit trigger, which compares with the clock now, is the only guard skipped.
  const agedBulk=async(count,ms)=>{
   const resolved=Date.now()-ms,ids=Array.from({length:count},()=>stampedId(resolved-2*HOUR));
   await withoutTriggers(db,['operator_containment_admit'],()=>db.batch(ids.map(cid=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,created_at,expires_at,resolution,resolved_at,resolved_by,resolution_reason,resolution_digest) VALUES(?,'contact','account',?,NULL,'human:fixture','Aged bulk fixture',?,?,?,'lifted',?,'human:fixture','Aged bulk fixture',?)")
    .bind(cid,owner.account,'b'.repeat(64),iso(resolved-2*HOUR),iso(resolved+HOUR),iso(resolved),'e'.repeat(64)))));
   return ids;
  };
  let closed=false;
  const close=async()=>{if(closed)return;closed=true;for(const h of handles.reverse())await h.close();for(const c of copies)c.close();fixture.close();await rm(directory,{recursive:true,force:true});};
  const w={db,owner,projectId,project,operate,open,openBreaking,inventory,register,inspect,verified,held,outcome,evidence,refused,events,contain,lift,stopServing,closeAction,revoke,cleanup,cleanupInput,cleanupPreview,rewrite,age,expireOld,ageReceipt,ageBySql,fixtureDelete,agedBulk,otherOwner,session,hold,release,present,bulk,directory,file,close};
  worlds.push(w);return w;
 }

 /**
  * Negative canary: a copy of the inventory module with the declared authority set emptied. Without derivation, the archive that
  * lacks a source-only authority row verifies; this is the gap the suites pin. Returns {module,cleanup}.
  */
 async function emptiedInventory(){
  const original='export const restoreAuthorityTables=Object.freeze([\'operator_containments\']);';
  let source=await readFile(join(toolsDirectory,'restore-inventory.mjs'),'utf8');
  assert.ok(source.includes(original),'The canary must find the declaration it removes');
  source=source.replace(original,'export const restoreAuthorityTables=Object.freeze([]);').replaceAll("from './",`from '${pathToFileURL(toolsDirectory).href}/`);
  assert.ok(!source.includes(original));
  const directory=await mkdtemp('/tmp/whumpo-containment-canary-'),file=join(directory,'restore-inventory-canary.mjs');
  await writeFile(file,source);
  return {module:await import(pathToFileURL(file).href),cleanup:()=>rm(directory,{recursive:true,force:true})};
 }

 return {world,m,counts,emptiedInventory,
  finish:extra=>console.log(JSON.stringify({suite,worlds:worlds.length,holds:counts.holds,verifications:counts.verifications,authorityTables:[...realInventory.restoreAuthorityTables],...extra,servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,liveProviderAccess:false})),
  dispose:async()=>{globalThis.fetch=network;for(const w of worlds)await w.close().catch(()=>{});await keys.close();}};
}

import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {stableCMSDatabase,captureCMSDatabase,restoreCapturedCMSDatabase} from './cms-database-snapshot.mjs';
import {fileInventory,copyTree,same} from './release-manifest.mjs';
import {writePrivate,readPrivate,pathCheck} from './operator-private-files.mjs';
import {captureRestoreArchive,captureRestoreRecordSnapshot,restoreRecordIdentity} from './restore-admission.mjs';

// WH-008 local disaster-recovery drill helpers. Operator/local only: there is no
// HTTP listener, route binding, publisher, provider adapter or SQL writer for a
// live target. Every result keeps serving, dispatch and key retirement disabled;
// restore admission remains tools/restore-admission.mjs.
const digest=v=>createHash('sha256').update(v).digest('hex');
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const fenced={servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false};
const limits={objects:10000,objectBytes:1048576,statements:20000,sqlBytes:64*1024*1024};
export class DrillHold extends Error{constructor(code){super('Recovery drill step held: '+code);this.code=code;}}
const hold=(value,code)=>{if(!value)throw new DrillHold(code);};
const pointFile='recovery-point.json';

const query=db=>async sql=>{const r=await db.prepare(sql).all();hold(r&&r.success!==false&&Array.isArray(r.results),'control-read');return r.results;};
/** Minimal read-only D1-shaped adapter over an isolated in-memory SQLite copy. */
function readOnlyAdapter(sql){
 const statement=(text,params=[])=>({query:text,params,bind:(...values)=>statement(text,values),
  all:async()=>({success:true,results:sql.prepare(text).all(...params)}),
  first:async column=>{const row=sql.prepare(text).get(...params);return row?(column===undefined?row:row[column]):null;},
  run:async()=>{throw new DrillHold('read-only-candidate');}});
 return {prepare:text=>statement(text),batch:async list=>{
  sql.exec('BEGIN');
  try{const out=list.map(s=>{const q=sql.prepare(s.query);if(!q.columns().length)throw new DrillHold('read-only-candidate');return {success:true,results:q.all(...s.params)};});sql.exec('COMMIT');return out;}
  catch(error){sql.exec('ROLLBACK');throw error;}
 }};
}
// The same object rule the restore verifier applies: project bodies and stored,
// undisposed restricted safety evidence. Bodies live outside D1.
async function referencedObjects(db){
 const rows=await query(db)("SELECT object_key AS key,size,digest AS sha256 FROM project_files UNION ALL SELECT storage_key,size,sha256 FROM safety_evidence_objects WHERE stored_at IS NOT NULL AND disposed_at IS NULL ORDER BY 1");
 hold(rows.length<=limits.objects,'object-bound');return rows;
}
async function readObject(objects,entry){
 let body;
 try{const object=await objects.get(entry.key);hold(object&&object.size===entry.size,'missing-objects');body=Buffer.from(await object.arrayBuffer());}
 catch(error){if(error instanceof DrillHold)throw error;throw new DrillHold('missing-objects');}
 hold(body.length===entry.size&&body.length<=limits.objectBytes&&digest(body)===entry.sha256,'object-integrity');return body;
}
async function privateDirectory(path){await mkdir(path,{mode:0o700});await pathCheck(join(path,'x'),{external:true,parent:true});return path;}

/** Capture one local recovery point: two equal logical control-database reads,
 * an isolated SQLite round trip, every referenced private object body and the
 * selected Worker build outputs. The manifest is written last as the completion
 * marker. It is restricted operator data; capture grants no restore authority. */
export async function captureRecoveryPoint({sourceDb,objects,directory,snapshotId,workers={},now=Date.now}){
 hold(id(snapshotId),'point-identity');await pathCheck(directory,{external:true,parent:true});await privateDirectory(directory);
 const capturedAt=now(),control=await stableCMSDatabase(query(sourceDb),{maxRows:200000});
 const scratch=new DatabaseSync(':memory:');
 try{
  restoreCapturedCMSDatabase(scratch,control.snapshot);
  hold((await captureCMSDatabase(async sql=>scratch.prepare(sql).all(),{maxRows:200000})).digest===control.digest,'control-roundtrip');
  const entries=await referencedObjects(readOnlyAdapter(scratch));
  await privateDirectory(join(directory,'objects'));const written=new Set();
  for(const entry of entries){
   hold(sha(entry.sha256)&&Number.isSafeInteger(entry.size),'object-integrity');
   const body=await readObject(objects,entry);
   if(!written.has(entry.sha256)){await writePrivate(join(directory,'objects',entry.sha256),body);written.add(entry.sha256);}
  }
  const workerInventory={};
  for(const [role,source] of Object.entries(workers)){hold(id(role),'worker-artifact');workerInventory[role]=await copyTree(source,join(directory,'workers',role));}
  await writePrivate(join(directory,'control.json'),Buffer.from(JSON.stringify(control.snapshot)));
  const objectList=entries.map(e=>({key:e.key,size:e.size,sha256:e.sha256}));
  const point={format:'whumpo-recovery-point-v1',environment:'test',snapshotId,capturedAt,control:{sha256:control.digest,rows:control.rows,bytes:control.bytes},objects:{count:objectList.length,bytes:objectList.reduce((n,o)=>n+o.size,0),sha256:digest(JSON.stringify(objectList)),entries:objectList},workers:Object.fromEntries(Object.entries(workerInventory).map(([role,files])=>[role,{files,sha256:digest(JSON.stringify(files))}])),notIncluded:['Worker secret values','independent suppression authority','provider-side state','customer DNS/zone and GitHub copies','native CMS resources']};
  const pointBytes=Buffer.from(JSON.stringify(point));await writePrivate(join(directory,pointFile),pointBytes);
  // Record pointDigest outside the archive directory; every later read requires it.
  return {snapshotId,pointDigest:digest(pointBytes),capturedAt,controlDigest:control.digest,controlRows:control.rows,controlBytes:control.bytes,objects:point.objects.count,objectBytes:point.objects.bytes,workers:Object.keys(point.workers)};
 }finally{scratch.close();}
}

/** Re-read every archived byte against the completion manifest, whose digest
 * was recorded independently at capture. A self-consistent edited copy fails. */
export async function verifyRecoveryPoint(directory,expectedDigest){
 hold(sha(expectedDigest),'point-digest');
 let point,snapshot,bytes;
 try{bytes=await readPrivate(join(directory,pointFile),1024*1024*16);}catch{throw new DrillHold('point-missing');}
 hold(digest(bytes)===expectedDigest,'point-digest');
 try{point=JSON.parse(bytes);}catch{throw new DrillHold('point-format');}
 hold(point?.format==='whumpo-recovery-point-v1'&&point.environment==='test'&&id(point.snapshotId),'point-format');
 try{bytes=await readPrivate(join(directory,'control.json'),limits.sqlBytes);}catch{throw new DrillHold('control-missing');}
 hold(digest(bytes)===point.control.sha256,'control-digest');snapshot=JSON.parse(bytes);
 hold(Array.isArray(point.objects.entries)&&digest(JSON.stringify(point.objects.entries))===point.objects.sha256,'object-manifest');
 for(const entry of point.objects.entries){
  let body;try{body=await readPrivate(join(directory,'objects',entry.sha256),limits.objectBytes);}catch{throw new DrillHold('object-missing');}
  hold(body.length===entry.size&&digest(body)===entry.sha256,'object-digest');
 }
 for(const [role,worker] of Object.entries(point.workers)){
  let files;try{files=await fileInventory(join(directory,'workers',role));}catch{throw new DrillHold('worker-artifact-missing');}
  hold(same(files,worker.files)&&digest(JSON.stringify(files))===worker.sha256,'worker-artifact-digest');
 }
 return {point,snapshot};
}

/** Open the archived control copy read-only, for independent archive registration. */
export async function openArchivedControl(directory,expectedDigest){
 const {snapshot}=await verifyRecoveryPoint(directory,expectedDigest),sql=new DatabaseSync(':memory:');
 try{restoreCapturedCMSDatabase(sql,snapshot);sql.exec('PRAGMA query_only=ON');}catch(error){sql.close();throw error;}
 return {db:readOnlyAdapter(sql),close:()=>sql.close()};
}

/** Restore the control database into a fresh, isolated, EMPTY D1 binding in one
 * batch, then prove the logical round trip. A non-empty target is refused: a
 * failed or partial target is discarded for a new empty one, never replayed. */
export async function restoreControlD1(target,directory,expectedDigest){
 const {point,snapshot}=await verifyRecoveryPoint(directory,expectedDigest);
 const existing=await target.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7)<>'sqlite_' AND substr(name,1,4)<>'_cf_' LIMIT 1").first();
 hold(!existing,'restore-target-not-empty');
 const statements=['PRAGMA defer_foreign_keys=ON'];
 for(const s of snapshot.schema.filter(s=>s.type==='table'))statements.push(s.sql);
 for(const table of snapshot.tables){if(table.name==='sqlite_sequence')statements.push('DELETE FROM sqlite_sequence');for(const row of table.rows)statements.push(`INSERT INTO ${ident(table.name)} (${table.columns.map(ident).join(',')}) VALUES (${row.join(',')})`);}
 for(const s of snapshot.schema.filter(s=>s.type!=='table'))statements.push(s.sql);
 hold(statements.length<=limits.statements&&statements.reduce((n,s)=>n+Buffer.byteLength(s),0)<=limits.sqlBytes,'restore-bound');
 let result;try{result=await target.batch(statements.map(sql=>target.prepare(sql)));}catch{throw new DrillHold('restore-batch-failed');}
 hold(result.length===statements.length&&result.every(r=>r.success!==false),'restore-batch-failed');
 hold((await target.prepare('PRAGMA foreign_key_check').all()).results.length===0,'restore-integrity');
 // PRAGMA quick_check exhausts local D1 memory (SQLITE_NOMEM) on the complete
 // control schema; the complete logical round trip below is the integrity proof.
 const roundtrip=await captureCMSDatabase(query(target),{maxRows:200000});hold(roundtrip.digest===point.control.sha256,'restore-roundtrip');
 return {statements:statements.length,rows:roundtrip.rows,digest:roundtrip.digest};
}

/** Idempotently copy archived object bodies into an isolated private bucket.
 * Exact existing copies are skipped, so an interrupted restore can resume; an
 * unexpected or different object refuses the target rather than overwriting it. */
export async function restoreObjects(target,directory,expectedDigest){
 const {point}=await verifyRecoveryPoint(directory,expectedDigest),expected=new Map(point.objects.entries.map(e=>[e.key,e]));
 let cursor,listed=0;
 do{
  const page=await target.list({cursor,limit:1000});
  for(const object of page.objects){listed++;hold(expected.has(object.key),'restore-target-not-isolated');}
  cursor=page.truncated?page.cursor:undefined;
 }while(cursor);
 let written=0,skipped=0;
 for(const entry of point.objects.entries){
  const present=await target.get(entry.key);
  if(present){const body=Buffer.from(await present.arrayBuffer());hold(body.length===entry.size&&digest(body)===entry.sha256,'restore-target-conflict');skipped++;continue;}
  const body=await readPrivate(join(directory,'objects',entry.sha256),limits.objectBytes);hold(digest(body)===entry.sha256,'object-digest');
  await target.put(entry.key,body,{sha256:entry.sha256});written++;
 }
 return {objects:point.objects.entries.length,written,skipped,preexisting:listed};
}

/** Copy a Worker build output out of the recovery point and prove its inventory. */
export async function restoreWorkerArtifact(directory,expectedDigest,role,target){
 const {point}=await verifyRecoveryPoint(directory,expectedDigest);hold(Object.hasOwn(point.workers,role),'worker-artifact-missing');
 try{await lstat(target);throw new DrillHold('restore-target-not-empty');}catch(error){if(error instanceof DrillHold)throw error;}
 const files=await copyTree(join(directory,'workers',role),target);
 hold(same(files,point.workers[role].files),'worker-artifact-digest');return {files:files.length,sha256:point.workers[role].sha256};
}

/** A fenced read-only object capability for the restore verifier. */
export const isolatedObjects=bucket=>Object.freeze({get:key=>bucket.get(key)});

/** Publication and application pointers in an isolated candidate must name the
 * exact restored artifacts. Counts and hold codes only; no bodies or identifiers. */
export async function reconcileArtifacts(db){
 const q=query(db),holds=new Set();
 const sites=await q('SELECT p.project_id,v.project_id AS version_project,v.html,v.digest FROM publications p LEFT JOIN site_versions v ON v.id=p.version_id WHERE p.version_id IS NOT NULL');
 for(const s of sites){if(s.version_project!==s.project_id)holds.add('site-pointer');else if(digest(s.html)!==s.digest)holds.add('site-artifact-digest');}
 const photos=await q('SELECT f.object_key FROM publications p JOIN version_photos vp ON vp.version_id=p.version_id LEFT JOIN project_files f ON f.id=vp.file_id');
 if(photos.some(r=>r.object_key===null))holds.add('site-photo-pointer');
 const backends=await q('SELECT b.project_id,v.project_id AS version_project,v.source,v.digest FROM backend_publications b LEFT JOIN backend_versions v ON v.id=b.version_id WHERE b.version_id IS NOT NULL');
 for(const b of backends){if(b.version_project!==b.project_id)holds.add('backend-pointer');else if(digest(b.source)!==b.digest)holds.add('backend-artifact-digest');}
 const apps=await q('SELECT a.project_id,a.enabled,v.project_id AS version_project,v.source,v.digest,s.review_id,r.status AS page_status FROM app_spaces a LEFT JOIN backend_versions v ON v.id=a.version_id LEFT JOIN app_page_settings s ON s.project_id=a.project_id LEFT JOIN app_page_reviews r ON r.id=s.review_id');
 for(const a of apps){
  if(a.version_project!==a.project_id)holds.add('app-program-pointer');else if(digest(a.source)!==a.digest)holds.add('app-program-digest');
  if(a.review_id!==null&&a.page_status!=='applied')holds.add('app-page-pointer');
 }
 const documents=await q('SELECT d.state_json,v.project_id,a.project_id AS app FROM app_documents d JOIN app_visitors v ON v.id=d.visitor_id LEFT JOIN app_spaces a ON a.project_id=v.project_id');
 for(const d of documents){if(d.app===null)holds.add('app-document-pointer');try{JSON.parse(d.state_json);}catch{holds.add('app-document-format');}}
 return {...fenced,status:holds.size?'held':'consistent',holds:[...holds].sort(),publishedSites:sites.length,publishedSitePhotos:photos.length,publishedBackends:backends.length,applications:apps.length,enabledApplications:apps.filter(a=>a.enabled===1).length,applicationDocuments:documents.length};
}

// WH-019 hand-off classes. Present-in-candidate but absent-in-source rows would be
// resurrected by a restore; changed rows would roll back current authority.
const identityTables=new Set(['users','identity_accounts','identity_sessions','identity_grants','identity_credentials','identity_recovery_kits','app_visitors','app_sessions','app_passkeys','app_recovery_codes','app_invitations']);
const publicationTables=new Set(['publications','backend_publications','app_page_settings','app_spaces','publication_actions']);
const credentialTables=new Set(['github_token_vault','cloudflare_token_vault','github_refresh_custody','github_oauth_states','cloudflare_oauth_states','connection_key_registry','connection_key_policy','push_devices']);
const classify=table=>identityTables.has(table)?'identity':publicationTables.has(table)?'publication':credentialTables.has(table)?'credential':table.startsWith('app_')?'application-data':'other';

/** Compare an isolated candidate with the operator-selected current source.
 * Returns per-class counts for WH-019 reconciliation and RPO loss. It does not
 * repair, scrub or admit anything, and is unavailable when the source is lost. */
export async function restoreDiscrepancies(candidateDb,sourceDb){
 const candidate=(await captureRestoreArchive(candidateDb,{snapshotId:'drill-comparison',streamId:'drill-comparison',sequence:0})).records;
 let source;
 try{source=(await captureRestoreRecordSnapshot(sourceDb)).records;}catch{return {...fenced,sourceAvailable:false,reconciliation:'unavailable-without-current-source'};}
 const current=new Map(source.map(r=>[restoreRecordIdentity(r),r])),restored=new Map(candidate.map(r=>[restoreRecordIdentity(r),r]));
 const counts={resurrected:{},rolledBack:{},lostSinceSnapshot:{}},tables={resurrected:{},rolledBack:{},lostSinceSnapshot:{}};
 const add=(kind,table)=>{const c=classify(table);counts[kind][c]=(counts[kind][c]??0)+1;tables[kind][table]=(tables[kind][table]??0)+1;};
 for(const [key,row] of restored){const now=current.get(key);if(!now)add('resurrected',row.table);else if(now.sha256!==row.sha256)add('rolledBack',row.table);}
 for(const [key,row] of current)if(!restored.has(key))add('lostSinceSnapshot',row.table);
 return {...fenced,sourceAvailable:true,candidateRecords:candidate.length,sourceRecords:source.length,counts,tables};
}

/** WH-019: reconcile an isolated restored candidate with the CURRENT suppression ledger before anything is admitted or served.
 * `suppression` is the bundled src/restore-suppression.ts module (capture, replay, check), injected so this operator tool stays plain
 * JavaScript. The ledger is captured from the operator-selected current source; replay is one atomic batch on the candidate and is
 * idempotent; the gate must then report clear. Counts and codes only. Without a current source there is no ledger to replay, so
 * reconciliation is unavailable and the candidate stays held. */
export async function reconcileRestoreSuppressions(candidateDb,sourceDb,suppression){
 hold(suppression&&['captureRestoreSuppressions','replayRestoreSuppressions','checkRestoreSuppressions'].every(n=>typeof suppression[n]==='function'),'suppression-module');
 let ledger;try{ledger=await suppression.captureRestoreSuppressions(sourceDb);}catch{return {...fenced,status:'unavailable',reconciliation:'unavailable-without-current-source'};}
 const before=await suppression.checkRestoreSuppressions(candidateDb,ledger);
 let replay;try{replay=await suppression.replayRestoreSuppressions(candidateDb,ledger);}catch{throw new DrillHold('suppression-replay-refused');}
 const after=await suppression.checkRestoreSuppressions(candidateDb,ledger);
 hold(after.clear,'suppression-not-clear');
 return {...fenced,status:'reconciled',entries:ledger.entries.length,ledgerSha256:ledger.sha256,pendingBefore:before.pending,applied:replay.applied};
}

// WH-008 refresh (2026-10-29): coverage, key-version and interrupted-cutover inventories.
// Capture is the whole logical control database, so every table is captured and restored unless it is
// named here with a rationale. Today nothing is excluded: restored rows stay fenced and are reconciled
// by WH-019 rather than dropped, because dropping a ledger would hide the very rows reconciliation needs.
// A new table fails the drill until the lifecycle catalog classifies it (docs/data-lifecycle.json).
export const recoveryExclusions=Object.freeze({});

/** Per-table disposition: captured and restored, or excluded with a rationale. Hold codes only. */
export async function recoveryCoverage(snapshot,countRows,catalog,exclusions=recoveryExclusions){
 const owner=new Map();for(const c of catalog.classes)for(const t of c.tables)owner.set(t,c.id);
 const captured=new Map(snapshot.tables.filter(t=>t.name!=='sqlite_sequence').map(t=>[t.name,t.rows.length])),holds=new Set(),classes={};
 for(const t of Object.keys(exclusions))if(!captured.has(t))holds.add('coverage-stale-exclusion');
 let restored=0,excluded=0,empty=0;
 for(const [table,rows] of captured){
  const cls=owner.get(table);if(!cls){holds.add('coverage-unclassified-table');continue;}
  classes[cls]??={tables:0,rows:0};classes[cls].tables++;classes[cls].rows+=rows;
  if(Object.hasOwn(exclusions,table)){excluded++;continue;}
  if(await countRows(table)!==rows)holds.add('coverage-restore-mismatch');else{restored++;if(!rows)empty++;}
 }
 return {...fenced,status:holds.size?'held':'complete',holds:[...holds].sort(),tables:captured.size,restored,excluded,emptyTables:empty,populatedTables:restored-empty,classes:Object.keys(classes).length,perClass:classes};
}

const keyStores=[['github_token_vault','ciphertext'],['cloudflare_token_vault','ciphertext'],['github_refresh_custody','ciphertext'],['github_oauth_states','verifier_ciphertext'],['cloudflare_oauth_states','verifier_ciphertext'],['push_devices','token_sealed']];
/** WH-117 key versions: registered ids, the active id, ciphertext rows per key id, and any rotation left running.
 * Key ids and counts only, never fingerprints or key material. A running rotation or an in-use unregistered id holds. */
export async function inventoryKeyVersions(db){
 const q=query(db),holds=new Set();
 const registered=(await q('SELECT id FROM connection_key_registry ORDER BY id')).map(r=>r.id);
 const policy=await q('SELECT active_key,revision FROM connection_key_policy');
 const rotations=await q('SELECT id,source_key,target_key,revision,state FROM connection_key_rotations ORDER BY revision');
 const guards=(await q('SELECT count(*) n FROM connection_rotation_guards'))[0].n;
 const inUse={};
 for(const [table,column] of keyStores)for(const r of await q(`SELECT CASE WHEN substr(${ident(column)},1,4)='wv2.' THEN substr(${ident(column)},5,instr(substr(${ident(column)},5),'.')-1) ELSE '' END k,count(*) n FROM ${ident(table)} GROUP BY 1`)){
  inUse[r.k||'unrecognized']=(inUse[r.k||'unrecognized']??0)+r.n;
  if(!registered.includes(r.k))holds.add('key-version-unregistered');
 }
 if(policy.length!==1||!registered.includes(policy[0]?.active_key))holds.add('key-policy');
 const running=rotations.filter(r=>r.state==='running').map(r=>({id:r.id,source:r.source_key,target:r.target_key,revision:r.revision}));
 if(running.length||guards)holds.add('key-rotation-unsettled');
 return {...fenced,status:holds.size?'held':'settled',holds:[...holds].sort(),registered,active:policy[0]?.active_key??null,policyRevision:policy[0]?.revision??null,rotations:{complete:rotations.length-running.length,running},rotationGuards:guards,ciphertextByKey:inUse};
}

const stepStates=new Set(['pending','running','unknown','confirmed']),journalStates=new Set(['prepared','applying','needs-reconciliation','deployed']);
/** Interrupted cutovers: release journals (tools/release-manifest.mjs) left mid-apply. A running or unknown
 * step is never retried from here; the inventory only names it so the operator reconciles against live state. */
export function inventoryCutovers(journals){
 const holds=new Set(),releases=[];
 for(const j of journals){
  if(!j||typeof j.release!=='string'||!journalStates.has(j.status)||!j.steps||typeof j.steps!=='object'||!Object.values(j.steps).every(s=>stepStates.has(s?.status))){holds.add('journal-format');continue;}
  const stuck=Object.entries(j.steps).filter(([,s])=>s.status==='running'||s.status==='unknown').map(([step,s])=>({step,status:s.status,operationConfirmed:s.operationConfirmed===true}));
  const interrupted=j.status==='applying'||j.status==='needs-reconciliation'||stuck.length>0;
  if(interrupted)holds.add('cutover-interrupted');
  releases.push({release:j.release,status:j.status,interrupted,stuck,pending:Object.values(j.steps).filter(s=>s.status==='pending').length});
 }
 return {...fenced,status:holds.size?'held':'settled',holds:[...holds].sort(),journals:journals.length,interrupted:releases.filter(r=>r.interrupted).length,releases};
}

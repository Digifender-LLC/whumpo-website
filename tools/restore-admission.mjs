import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {currentSchemaArtifact,inspectSchema} from './current-schema.mjs';
import {checkSpecificationCompiler} from './check-specification-compiler.mjs';
import {checkServiceClientCompiler} from './check-service-client-compiler.mjs';
import {withRecoveredConnectionKeys} from './connection-key-backup.mjs';

// An operator-only isolated verifier. There is deliberately no HTTP/Chat route,
// global fetch, publisher, provider adapter, SQL writer or release authorization.
const digest=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(v,(_key,value)=>value instanceof Uint8Array?Array.from(value):value);
const same=(a,b)=>canonical(a)===canonical(b);
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
const sha=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const sequence=v=>Number.isSafeInteger(v)&&v>=0;
const exact=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
class Hold extends Error{constructor(code){super('Isolated restore remains unavailable.');this.code=code;}}
function requireCheck(value,code){if(!value)throw new Hold(code);}
const limits={rowsPerTable:10000,totalBytes:64*1024*1024,evidenceBytes:262144,events:512};
const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stores=[
 ['github_refresh_custody','ciphertext','token_id','github','refresh'],
 ['github_token_vault','ciphertext','id','github','token'],
 ['cloudflare_token_vault','ciphertext','id','cloudflare','token'],
 ['github_oauth_states','verifier_ciphertext','state_hash','github','pkce'],
 ['cloudflare_oauth_states','verifier_ciphertext','state_hash','cloudflare','pkce'],
];
// Only current, durable domain receipts can settle an external-effect constraint.
// A token row, arbitrary user row or echoed approval flag is never such a receipt.
const effectReceipts={
 github_backups:['state',['complete','failed']],cloudflare_dns_actions:['state',['applied','unchanged','observed']],
 domain_connections:['state',['active','disconnected']],standard_ai_requests:['state',['completed','released']],
 inference_calls:['status',['observed','released']],gateway_spend_attempts:['status',['settled','released']],
 stripe_subscription_orders:['state',['complete','expired']],connection_oauth_exchanges:['state',['rejected','revoked']],
 github_grant_revocations:['state',['revoked','cancelled']],
 // Provider acceptance and proved-unsent terminal outcomes are durable; dispatch/uncertain rows never reconcile.
 contact_notification_outbox:['state',['accepted','failed','cancelled','bounced','complained']],
};

function terminalEffect(store,row){
 const [column,states]=effectReceipts[store];
 if(!row||!states.includes(row[column]))return false;
 // An attempted generic cancellation is not independent proof of non-delivery. The unique claimant's
 // not_sent receipt proves the provider had not begun; an attempt-free cancellation never dispatched.
 return store!=='contact_notification_outbox'||row.state!=='cancelled'||row.attempts===0||row.last_error==='not_sent';
}

async function currentContract(){
 const schema=await currentSchemaArtifact(),content=await checkSpecificationCompiler(),clients=await checkServiceClientCompiler();
 const local=new DatabaseSync(':memory:');
 try{
  local.exec(schema.sql);
  const tables=local.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(({name})=>({name,keys:local.prepare('SELECT name FROM pragma_table_info(?) WHERE pk>0 ORDER BY pk').all(name).map(r=>r.name)}));
  const compiled=await build({absWorkingDir:sourceRoot,entryPoints:['src/connection-vault.ts'],bundle:true,format:'esm',platform:'node',write:false});
  const vault=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
  return {schema:schema.expected,compilers:[{id:content.compiler,sha256:content.compilerDigest},{id:clients.compiler,sha256:clients.compilerDigest}],tables,vault};
 }finally{local.close();}
}

async function snapshot(db,contract){
 requireCheck(same(await inspectSchema(db),contract.schema),'current-schema');
 // One read-only transaction, bounded per table and in aggregate. Never accept
 // supplied table names, truncated pages or a caller-generated row inventory.
 const queries=contract.tables.map(t=>db.prepare(`SELECT * FROM "${t.name}" LIMIT ${limits.rowsPerTable+1}`));
 const results=await db.batch([...queries,db.prepare('PRAGMA foreign_key_check')]);
 requireCheck(results.length===queries.length+1&&results.every(r=>r.success===true&&Array.isArray(r.results)),'candidate-read');
 requireCheck(results.at(-1).results.length===0,'candidate-integrity');
 let bytes=0;const rows=new Map(),inventory=[];
 for(let i=0;i<contract.tables.length;i++){
  const table=contract.tables[i],data=results[i].results;
  requireCheck(data.length<=limits.rowsPerTable,'candidate-bound');
  const serialized=data.map(r=>canonical(r)).sort();bytes+=serialized.reduce((n,v)=>n+Buffer.byteLength(v),0);
  requireCheck(bytes<=limits.totalBytes,'candidate-bound');
  rows.set(table.name,data);inventory.push({table:table.name,rows:data.length,sha256:digest(canonical(serialized))});
 }
 requireCheck(same(await inspectSchema(db),contract.schema),'current-schema');
 return {rows,inventory};
}

function manifestFor(contract,state,{snapshotId,streamId,sequence:watermark}){
 requireCheck(id(snapshotId)&&id(streamId)&&sequence(watermark),'manifest');
 const keyIds=new Set(state.rows.get('connection_key_policy').map(row=>row.active_key));
 for(const [table,column] of stores)for(const row of state.rows.get(table))keyIds.add(contract.vault.connectionCiphertextKeyId(row[column]));
 return {version:1,environment:'test',snapshotId,checkpoint:{streamId,sequence:watermark},schema:contract.schema,compilers:contract.compilers,cipherFormat:contract.vault.CONNECTION_VAULT_FORMAT,keyIds:[...keyIds].sort(),tables:state.inventory};
}

/** Restricted metadata artifact; registration of its digest in the independent
 * permitted-archive inventory is required separately. Capture grants nothing. */
export async function captureRestoreManifest(db,identity){
 try{const contract=await currentContract();return manifestFor(contract,await snapshot(db,contract),identity);}
 catch{throw new Error('Current restore manifest could not be captured; inspect the isolated inputs locally.');}
}
export const restoreManifestDigest=manifest=>digest(canonical(manifest));

export const restoreRecordIdentity=record=>canonical([record.table,Object.entries(record.key).sort(([a],[b])=>a.localeCompare(b))]);
function recordInventory(contract,state){
 const records=[];
 for(const table of contract.tables)for(const row of state.rows.get(table.name)){
  requireCheck(table.keys.length>0,'record-identity');
  const key=Object.fromEntries(table.keys.map(k=>[k,row[k]]));
  requireCheck(Object.values(key).every(v=>typeof v==='string'&&v.length<=1024||Number.isSafeInteger(v)),'record-identity');
  records.push({table:table.name,key,sha256:digest(canonical(row))});
 }
 return records.sort((a,b)=>restoreRecordIdentity(a).localeCompare(restoreRecordIdentity(b)));
}
/** Capture record identities/hashes and the manifest from the SAME read transaction.
 * Restricted operator metadata only: no row body or credential is returned. */
export async function captureRestoreArchive(db,identity){
 try{const contract=await currentContract(),state=await snapshot(db,contract);return {manifest:manifestFor(contract,state,identity),records:recordInventory(contract,state)};}
 catch{throw new Error('Current restore archive could not be captured.');}
}
/** Live-source observation, not a disaster-recovery authority or provider check. */
export async function captureRestoreRecordSnapshot(db){
 try{
  const contract=await currentContract(),state=await snapshot(db,contract);
  checkUnsettled(state);checkCredentialObligations(state);
  return {schema:contract.schema,records:recordInventory(contract,state),sha256:digest(canonical(state.inventory))};
 }catch{throw new Error('Current recovery source could not be observed.');}
}

/** Read a recovery constraint from the operator-selected CURRENT source, never
 * from customer-supplied row bodies, digests or a recovered candidate. This is
 * a bounded observation, not execution of erasure or provider reconciliation. */
export async function captureRestoreConstraint(db,selection){
 try{
  const contract=await currentContract(),state=await snapshot(db,contract);
  const find=(table,key)=>{
   const shape=contract.tables.find(t=>t.name===table);
   requireCheck(shape&&shape.keys.length>0&&exact(key,shape.keys)&&Object.values(key).every(v=>typeof v==='string'&&v.length<=1024||Number.isSafeInteger(v)),'constraint');
   return state.rows.get(table).find(row=>shape.keys.every(k=>row[k]===key[k]));
  };
  const s=selection;let kind,data;
  if(exact(s,['kind','ownerId'])&&s.kind==='owner-erased'&&id(s.ownerId)){
   requireCheck(!find('users',{id:s.ownerId}),'constraint');kind=s.kind;data={ownerId:s.ownerId};
  }else if(exact(s,['kind','ownerId'])&&s.kind==='identity-epoch'&&id(s.ownerId)){
   const row=find('identity_accounts',{account_id:s.ownerId});requireCheck(row&&sequence(row.auth_epoch)&&row.auth_epoch>0,'constraint');
   kind=s.kind;data={ownerId:s.ownerId,epoch:row.auth_epoch};
  }else if(exact(s,['kind','table','key'])&&s.kind==='record'){
   const row=find(s.table,s.key);kind=row?'record-current':'record-suppressed';
   data={table:s.table,key:s.key,...(row?{sha256:digest(canonical(row))}:{})};
  }else if(exact(s,['kind','projectId','surface'])&&s.kind==='publication-withdrawn'&&id(s.projectId)&&['site','backend','app'].includes(s.surface)){
   const row=find({site:'publications',backend:'backend_publications',app:'app_page_settings'}[s.surface],{project_id:s.projectId});
   requireCheck(!row||(s.surface==='app'?row.review_id===null:row.version_id===null),'constraint');
   kind=s.kind;data={projectId:s.projectId,surface:s.surface};
  }else if(exact(s,['kind','store','effectId'])&&s.kind==='external-effect'&&Object.hasOwn(effectReceipts,s.store)&&id(s.effectId)){
   const oauth=s.store==='connection_oauth_exchanges';
   const row=find(oauth?'connection_oauth_outcomes':s.store,{id:s.effectId});
   const pending=oauth?find(s.store,{token_id:s.effectId}):null;
   requireCheck(row||pending,'constraint');
   const reconciled=terminalEffect(s.store,row)&&!pending;
   kind=s.kind;data={effectId:s.effectId,store:s.store,state:reconciled?'reconciled':'unknown',receipt:reconciled?{sha256:digest(canonical(row))}:null};
  }else throw new Error('constraint');
  // Detach selected keys from the caller before any asynchronous persistence.
  return JSON.parse(canonical({kind,data}));
 }catch{throw new Error('Current recovery constraint could not be observed. Inspect the authoritative source locally.');}
}

function validateManifest(manifest,contract,state){
 requireCheck(exact(manifest,['version','environment','snapshotId','checkpoint','schema','compilers','cipherFormat','keyIds','tables'])&&manifest.version===1&&manifest.environment==='test','manifest');
 requireCheck(exact(manifest.checkpoint,['streamId','sequence']),'manifest');
 const actual=manifestFor(contract,state,{snapshotId:manifest.snapshotId,...manifest.checkpoint});
 requireCheck(same(manifest,actual),'manifest-mismatch');
}

async function readEvidence(source,streamId,manifest,now){
 requireCheck(source&&typeof source.fetch==='function'&&id(streamId)&&streamId===manifest.checkpoint.streamId,'independent-evidence');
 const challenge=randomUUID(),manifestDigest=restoreManifestDigest(manifest);
 let body,reader,timer;
 const controller=new AbortController();
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();void reader?.cancel().catch(()=>{});reject(new Hold('independent-evidence'));},10000);});
 try{
  body=await Promise.race([deadline,(async()=>{
   const response=await source.fetch(new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest,challenge}),signal:controller.signal}));
   requireCheck(!controller.signal.aborted,'independent-evidence');
   requireCheck(response.status===200&&!response.redirected&&response.body,'independent-evidence');
   reader=response.body.getReader();const chunks=[];let length=0;
   try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;requireCheck(length<=limits.evidenceBytes,'evidence-bound');chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();reader=undefined;}
   return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  })()]);
 }catch(error){if(error instanceof Hold)throw error;throw new Hold('independent-evidence');}
 finally{clearTimeout(timer);}
 requireCheck(exact(body,['version','streamId','snapshotId','manifestDigest','challenge','archiveState','capturedSequence','baseSequence','currentSequence','issuedAt','expiresAt','events','keyBackup']),'evidence-contract');
 requireCheck(body.version===2&&body.streamId===streamId&&body.snapshotId===manifest.snapshotId&&body.manifestDigest===manifestDigest&&body.challenge===challenge&&body.archiveState==='permitted','evidence-binding');
 requireCheck(exact(body.keyBackup,['backupId','sha256','keyIds'])&&id(body.keyBackup.backupId)&&sha(body.keyBackup.sha256)&&Array.isArray(body.keyBackup.keyIds)&&body.keyBackup.keyIds.length>0&&body.keyBackup.keyIds.length<=4&&body.keyBackup.keyIds.every(id)&&new Set(body.keyBackup.keyIds).size===body.keyBackup.keyIds.length,'evidence-contract');
 const current=now();
 requireCheck(sequence(body.issuedAt)&&sequence(body.expiresAt)&&body.issuedAt<=current&&body.issuedAt>=current-10000&&body.expiresAt>current&&body.expiresAt<=body.issuedAt+30000,'evidence-freshness');
 // This bounded interface requires the complete cumulative stream. A future
 // independently attested compacted baseline needs its own reviewed contract.
 requireCheck(body.baseSequence===0&&sequence(body.currentSequence)&&body.capturedSequence===manifest.checkpoint.sequence&&body.capturedSequence<=body.currentSequence&&Array.isArray(body.events)&&body.events.length<=limits.events&&body.events.length===body.currentSequence,'evidence-gap');
 for(let i=0;i<body.events.length;i++)requireCheck(exact(body.events[i],['sequence','kind','data'])&&body.events[i].sequence===i+1,'evidence-gap');
 return body;
}

function applyEvidence(evidence,state,contract){
 const rowFor=(table,key)=>{
  const shape=contract.tables.find(t=>t.name===table);
  requireCheck(shape&&shape.keys.length>0&&exact(key,shape.keys)&&Object.values(key).every(v=>typeof v==='string'&&v.length<=1024||Number.isSafeInteger(v)),'evidence-contract');
  return state.rows.get(table).find(row=>shape.keys.every(k=>row[k]===key[k]));
 };
 const external=new Map(),epochs=new Map(),currentRecords=new Map();
 const recordIdentity=(table,key)=>canonical([table,Object.entries(key).sort(([a],[b])=>a.localeCompare(b))]);
 for(const {kind,data} of evidence.events){
  if(kind==='owner-erased'){
   requireCheck(exact(data,['ownerId'])&&id(data.ownerId),'evidence-contract');
   requireCheck(!state.rows.get('users').some(r=>r.id===data.ownerId),'removed-owner');
  }else if(kind==='identity-epoch'){
   requireCheck(exact(data,['ownerId','epoch'])&&id(data.ownerId)&&sequence(data.epoch)&&data.epoch>0,'evidence-contract');
   requireCheck(!epochs.has(data.ownerId)||data.epoch>epochs.get(data.ownerId),'evidence-contract');epochs.set(data.ownerId,data.epoch);
  }else if(kind==='record-suppressed'){
   requireCheck(exact(data,['table','key']),'evidence-contract');
   requireCheck(!rowFor(data.table,data.key),'suppressed-record');
   currentRecords.delete(recordIdentity(data.table,data.key));
  }else if(kind==='record-current'){
   requireCheck(exact(data,['table','key','sha256'])&&sha(data.sha256),'evidence-contract');
   rowFor(data.table,data.key);currentRecords.set(recordIdentity(data.table,data.key),{kind,data});
  }else if(kind==='publication-withdrawn'){
   requireCheck(exact(data,['projectId','surface'])&&id(data.projectId)&&['site','backend','app'].includes(data.surface),'evidence-contract');
   const table={site:'publications',backend:'backend_publications',app:'app_page_settings'}[data.surface];
   currentRecords.set(recordIdentity(table,{project_id:data.projectId}),{kind,data});
  }else if(kind==='external-effect'){
   requireCheck(exact(data,['effectId','store','state','receipt'])&&id(data.effectId)&&Object.hasOwn(effectReceipts,data.store)&&['unknown','reconciled'].includes(data.state),'evidence-contract');
   if(data.state==='unknown')requireCheck(data.receipt===null,'evidence-contract');
   else requireCheck(effectReceipts[data.store]&&exact(data.receipt,['sha256'])&&sha(data.receipt.sha256),'evidence-contract');
   external.set(data.store+':'+data.effectId,data);
  }else throw new Hold('evidence-contract');
 }
 for(const [ownerId,epoch] of epochs){
  const account=state.rows.get('identity_accounts').find(r=>r.account_id===ownerId);
  requireCheck(!account||account.auth_epoch===epoch,'stale-identity');
  for(const table of ['identity_sessions','identity_grants'])requireCheck(!state.rows.get(table).some(r=>r.account_id===ownerId&&r.auth_epoch!==epoch),'stale-identity');
 }
 for(const {kind,data} of currentRecords.values()){
  if(kind==='record-current'){
   const row=rowFor(data.table,data.key);requireCheck(row&&digest(canonical(row))===data.sha256,'stale-authority');
  }else{
   const table={site:'publications',backend:'backend_publications',app:'app_page_settings'}[data.surface],row=state.rows.get(table).find(r=>r.project_id===data.projectId);
   requireCheck(!row||(data.surface==='app'?row.review_id===null:row.version_id===null),'withdrawn-publication');
  }
 }
 for(const effect of external.values()){
  requireCheck(effect.state==='reconciled','uncertain-effect');
  const row=rowFor(effect.store==='connection_oauth_exchanges'?'connection_oauth_outcomes':effect.store,{id:effect.effectId});
  requireCheck(terminalEffect(effect.store,row)&&digest(canonical(row))===effect.receipt.sha256,'uncertain-effect');
 }
}

function checkUnsettled(state,observedAt=Date.now()){
 // Native authority is never rehydrated from an archive, even with a current epoch.
 // A reviewed scrub must discard these rows and a current passkey starts new access.
 requireCheck(state.rows.get('mobile_identity_handoffs').length===0
  &&!state.rows.get('identity_sessions').some(row=>row.client==='android')
  &&!state.rows.get('identity_challenges').some(row=>row.client==='android'),'native-reauthentication-required');
 const checks=[
  ['contact_notification_outbox','state',['dispatching','uncertain']],
  ['github_backups','state',['dispatching','uncertain']],['cloudflare_dns_actions','state',['sending','uncertain']],
  ['domain_connections','state',['creating','uncertain','provisioning','disconnecting']],
  ['inference_calls','status',['reserved','dispatched','uncertain']],['gateway_spend_attempts','status',['reserved','dispatched','uncertain']],
  ['standard_ai_requests','state',['reserved','dispatched','uncertain']],['stripe_subscription_orders','state',['pending']],
 ];
 for(const [table,column,values] of checks)requireCheck(!state.rows.get(table).some(row=>values.includes(row[column])),'uncertain-effect');
 requireCheck(!state.rows.get('stripe_customers').some(row=>row.lease!==null||row.customer_id===null),'uncertain-effect');
 // WH-132: while a preservation hold, an open disclosure or an unfinished evidence capture exists (in the candidate or,
 // through the inventory's source observation, in the current database), no archive may be admitted. A restore during a
 // hold would roll back held records, case decisions or audit rows; it needs a separately reviewed procedure.
 requireCheck(!state.rows.get('safety_preservation_holds').some(row=>row.released_at===null)
  &&!state.rows.get('safety_disclosures').some(row=>['requested','approved'].includes(row.state))
  &&!state.rows.get('safety_evidence_objects').some(row=>row.stored_at===null),'preservation-hold');
 // One-use lookup permissions are transient authority; a restore cannot re-create consent.
 requireCheck(state.rows.get('connector_lookup_consents').length===0,'connector-consent-authority');
 requireCheck(!state.rows.get('connector_request_budgets').some(r=>r.window_start+60>observedAt/1000),'connector-budget-window');
 // Native CMS storage/derived keys have their own deferred recovery adapters.
 for(const table of ['cms_instances','cms_media_uploads','cms_wordpress_sources'])requireCheck(state.rows.get(table).length===0,'cms-recovery-unavailable');
 for(const table of ['identity_sessions','identity_grants'])for(const session of state.rows.get(table)){
  const account=state.rows.get('identity_accounts').find(r=>r.account_id===session.account_id);
  requireCheck(account&&session.auth_epoch===account.auth_epoch,'stale-identity');
 }
}

async function checkKeys(state,contract,keyring){
 let metadata,fingerprints;
 try{metadata=contract.vault.connectionKeyringMetadata(keyring);fingerprints=await contract.vault.connectionKeyFingerprints(keyring);}catch{throw new Hold('missing-keys');}
 const registered=state.rows.get('connection_key_registry'),policy=state.rows.get('connection_key_policy');
 requireCheck(policy.length===1&&policy[0].active_key===metadata.active,'key-policy');
 for(const entry of fingerprints)requireCheck(registered.some(r=>r.id===entry.id&&r.fingerprint===entry.fingerprint),'key-identity');
 requireCheck(metadata.keyIds.includes(policy[0].active_key),'missing-keys');
 let credentials=0;
 for(const [table,column,identity,provider,purpose] of stores)for(const row of state.rows.get(table)){
  const context=`whumpo:${provider}:${purpose}:${row.user_id}:${row[identity]}`;
  try{await contract.vault.unseal(keyring,context,row[column]);}catch{throw new Hold('credential-authentication');}
  credentials++;
 }
 checkCredentialObligations(state);
 return {keyIds:metadata.keyIds.slice().sort(),credentials};
}

function checkCredentialObligations(state){
 requireCheck(state.rows.get('connection_oauth_exchanges').length===0,'uncertain-effect');
 requireCheck(!state.rows.get('github_grant_revocations').some(r=>['dispatching','uncertain'].includes(r.state)),'uncertain-effect');
 requireCheck(!state.rows.get('github_refresh_custody').some(r=>r.access_revoked_at!==null||state.rows.get('github_token_vault').some(t=>t.id===r.token_id&&t.state==='revoking')),'uncertain-effect');
 requireCheck(state.rows.get('github_revocation_claims').length===0&&!state.rows.get('cloudflare_token_vault').some(row=>row.revoke_attempt!==null),'uncertain-effect');
 requireCheck(state.rows.get('connection_rotation_guards').length===0&&!state.rows.get('connection_key_rotations').some(r=>r.state==='running'),'key-rotation-unsettled');
}

async function checkObjects(state,objects){
 // Restricted evidence objects live outside D1; a recovered row must still name the exact stored bytes.
 const evidence=state.rows.get('safety_evidence_objects').filter(row=>row.stored_at!==null&&row.disposed_at===null).map(row=>({object_key:row.storage_key,size:row.size,digest:row.sha256}));
 const files=[...state.rows.get('project_files'),...evidence];
 requireCheck(files.length===0||objects&&typeof objects.get==='function','missing-objects');
 for(const row of files){
  let body;
  try{const object=await objects.get(row.object_key);requireCheck(object&&object.size===row.size&&typeof object.arrayBuffer==='function','missing-objects');body=await object.arrayBuffer();}
  catch(error){if(error instanceof Hold)throw error;throw new Hold('missing-objects');}
  requireCheck(body.byteLength===row.size&&digest(Buffer.from(body))===row.digest,'object-integrity');
 }
 return files.length;
}

/** Source is a server/operator-selected independent service capability, never a
 * customer JSON receipt or the recovered database. It must authenticate its own
 * permitted-archive inventory and cumulative evidence before replying. No live
 * adapter/store has been activated by this isolated verifier. */
export async function inspectIsolatedRestore({db,manifest,keyBackup,evidenceSource,expectedStreamId,objects,now=Date.now,...unknown}){
 const result={version:1,scope:'isolated-current-restore',status:'held',servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,holds:[]};
 try{
  requireCheck(Object.keys(unknown).length===0,'current-input');
  const contract=await currentContract(),before=await snapshot(db,contract);validateManifest(manifest,contract,before);
  const evidence=await readEvidence(evidenceSource,expectedStreamId,manifest,now);applyEvidence(evidence,before,contract);
  checkUnsettled(before,now());
  requireCheck(keyBackup&&same({backupId:keyBackup.backupId,sha256:keyBackup.sha256,keyIds:keyBackup.keyIds},evidence.keyBackup),'key-backup-binding');
  let recovered;
  try{recovered=await withRecoveredConnectionKeys(keyBackup,async keyring=>{
   try{return {keys:await checkKeys(before,contract,keyring)};}
   catch(error){return {hold:error instanceof Hold?error.code:'key-backup-unavailable'};}
  });}catch{throw new Hold('key-backup-unavailable');}
  requireCheck(!recovered.hold,recovered.hold);const keys=recovered.keys,objectCount=await checkObjects(before,objects);
  const after=await snapshot(db,contract);requireCheck(same(before.inventory,after.inventory),'candidate-changed');
  const current=await readEvidence(evidenceSource,expectedStreamId,manifest,now);
  requireCheck(same({sequence:evidence.currentSequence,events:evidence.events,keyBackup:evidence.keyBackup},{sequence:current.currentSequence,events:current.events,keyBackup:current.keyBackup}),'evidence-changed');
  try{await withRecoveredConnectionKeys(keyBackup,async()=>true);}catch{throw new Hold('key-backup-unavailable');}
  return {...result,status:'verified',manifestDigest:restoreManifestDigest(manifest),tables:before.inventory.length,keys,objects:objectCount,evidenceSequence:current.currentSequence};
 }catch(error){return {...result,holds:[error instanceof Hold?error.code:'verification-unavailable']};}
}

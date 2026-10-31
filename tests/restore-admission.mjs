import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {captureRestoreManifest,inspectIsolatedRestore,restoreManifestDigest} from '../tools/restore-admission.mjs';

Error.stackTraceLimit=0;
const fixture=await databaseFixture(),{db}=fixture,m=await currentSiteFixtureHandlers(),id=()=>crypto.randomUUID();
const hash=x=>createHash('sha256').update(x).digest('hex');
const rowHash=row=>hash(JSON.stringify(row,(_k,v)=>v instanceof Uint8Array?Array.from(v):v));
const keyring=fixtureKeyring(),canary='PRIVATE_RESTORE_CREDENTIAL_CANARY',objectKey='private-object-restore-canary',objectBytes=Buffer.from('Private synthetic object; never served or scanned.');
// Independent synthetic service state: it is not included in the recovered D1
// schema/rows. No production suppression store or provider acceptance is implied.
const backupFixture=await keyBackupFixture(),primaryBackup=await backupFixture.create(keyring);let keyBackup=primaryBackup.proof;
const journal=new DatabaseSync(':memory:');
journal.exec('CREATE TABLE archive(id TEXT PRIMARY KEY,digest TEXT NOT NULL,sequence INTEGER NOT NULL,key_backup TEXT NOT NULL); CREATE TABLE event(sequence INTEGER PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL);');
const head=()=>journal.prepare('SELECT COUNT(*) n FROM event').get().n;
const event=(kind,data)=>journal.prepare('INSERT INTO event VALUES(?,?,?)').run(head()+1,kind,JSON.stringify(data));
const clear=()=>journal.exec('DELETE FROM event; DELETE FROM archive;');
const streamId='synthetic-independent-stream';let now=Date.now(),calls=0;
const evidenceSource={async fetch(request){
 calls++;assert.equal(request.method,'POST');assert.equal(new URL(request.url).pathname,'/v2/check');assert.equal(new URL(request.url).origin,'https://restore-evidence.internal');
 const input=await request.json(),registered=journal.prepare('SELECT * FROM archive WHERE id=? AND digest=?').get(input.snapshotId,input.manifestDigest);
 if(!registered)return new Response(null,{status:404});
 assert.equal(input.version,2);
 return Response.json({version:2,keyBackup:JSON.parse(registered.key_backup),streamId,snapshotId:input.snapshotId,manifestDigest:registered.digest,challenge:input.challenge,archiveState:'permitted',capturedSequence:registered.sequence,baseSequence:0,currentSequence:head(),issuedAt:now,expiresAt:now+10000,events:journal.prepare('SELECT * FROM event ORDER BY sequence').all().map(row=>({...row,data:JSON.parse(row.data)}))});
}};
const objects={get:async key=>key===objectKey?{size:objectBytes.length,arrayBuffer:async()=>Uint8Array.from(objectBytes).buffer}:null};
const capture=()=>captureRestoreManifest(db,{snapshotId:id(),streamId,sequence:head()});
const backupReference=proof=>({backupId:proof.backupId,sha256:proof.sha256,keyIds:proof.keyIds});
function permit(manifest){journal.prepare('INSERT INTO archive VALUES(?,?,?,?)').run(manifest.snapshotId,restoreManifestDigest(manifest),manifest.checkpoint.sequence,JSON.stringify(backupReference(keyBackup)));}
async function heldWithBackup(manifest,proof,code){
 journal.prepare('UPDATE archive SET key_backup=? WHERE id=?').run(JSON.stringify(backupReference(proof)),manifest.snapshotId);
 try{await held({...options(manifest),keyBackup:proof},code);}
 finally{journal.prepare('UPDATE archive SET key_backup=? WHERE id=?').run(JSON.stringify(backupReference(keyBackup)),manifest.snapshotId);}
}
async function current(){const manifest=await capture();permit(manifest);return manifest;}
const options=manifest=>({db,manifest,keyBackup,evidenceSource,expectedStreamId:streamId,objects,now:()=>now});
let refusals=0;
async function held(input,code){const report=await inspectIsolatedRestore(input);assert.deepEqual(report.holds,[code]);assert.equal(report.status,'held');assert.equal(report.servingAllowed,false);assert.equal(report.providerDispatchAllowed,false);assert.ok(!JSON.stringify(report).includes(canary));assert.ok(!JSON.stringify(report).includes(objectKey));refusals++;return report;}
async function passed(input){const result=await inspectIsolatedRestore(input);assert.equal(result.status,'verified',JSON.stringify(result));assert.equal(result.servingAllowed,false);assert.equal(result.providerDispatchAllowed,false);assert.equal(result.retirementAllowed,false);assert.equal(result.tables,252);return result;}
const altered=(mutate)=>({async fetch(request){const response=await evidenceSource.fetch(request);const body=await response.json();await mutate(body);return Response.json(body);}});
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Restore verification cannot dispatch to any real provider');
try{
 await initializeFixtureKeys(db,keyring);const owner=await workspaceFixture(db,m),scope=await owner.scope();
 const {project,version}=await createFixtureProject(scope,owner.account,'Safe garden','Synthetic private garden fixture');
 const records=[];
 for(const provider of ['github','cloudflare'])for(const purpose of ['token','pkce']){
  const record=id(),cipher=await fixtureCiphertext(keyring,`whumpo:${provider}:${purpose}:${owner.account}:${record}`,canary);
  if(purpose==='pkce')await db.prepare(`INSERT INTO ${provider}_oauth_states(user_id,state_hash,authority_id,verifier_ciphertext,expires_at) VALUES(?,?,?,?,'2099-01-01')`).bind(owner.account,record,owner.authority,cipher).run();
  else if(provider==='github')await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')").bind(record,owner.account,cipher).run();
  else await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,'2099-01-01','2026-10-02','revoking')").bind(record,owner.account,cipher).run();
  records.push({provider,purpose,record});
 }
 const file=id();await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,?,1,1,'pending','2026-10-02')").bind(file,project,'Synthetic object',objectKey,hash(objectBytes),objectBytes.length).run();
 let manifest=await capture();
 assert.ok(!JSON.stringify(manifest).includes(canary));assert.ok(!JSON.stringify(manifest).includes(objectKey));assert.ok(!JSON.stringify(manifest).includes(JSON.parse(keyring).keys[0].secret));
 await held(options(manifest),'independent-evidence');permit(manifest);
 const good=await passed(options(manifest));assert.equal(good.keys.credentials,4);assert.equal(good.objects,1);
 for(const proof of [undefined,{},JSON.stringify(keyBackup)])await held({...options(manifest),keyBackup:proof},'key-backup-binding');
 await held({...options(manifest),keyring,keyBackup:undefined},'current-input');
 await held({...options(manifest),keyBackup:{...keyBackup}},'key-backup-unavailable');
 await held({...options(manifest),evidenceSource:altered(b=>{b.keyBackup.sha256='a'.repeat(64);})},'key-backup-binding');
 await held({...options(manifest),evidenceSource:altered(b=>{delete b.keyBackup;})},'evidence-contract');
 await held({...options(manifest),evidenceSource:altered(b=>{b.version=1;})},'evidence-binding');
 const savedCapsule=await readFile(primaryBackup.backupFile);
 try{await held({...options(manifest),objects:{get:async path=>{await rm(primaryBackup.backupFile);return objects.get(path);}}},'key-backup-unavailable');}
 finally{await writeFile(primaryBackup.backupFile,savedCapsule,{mode:0o600});}
 await heldWithBackup(manifest,(await backupFixture.create(fixtureKeyring('cd'.repeat(32)))).proof,'key-identity');
 await heldWithBackup(manifest,(await backupFixture.create(fixtureKeyring('ab'.repeat(32),'unregistered'))).proof,'key-policy');
 for(const source of [undefined,{approved:true},{independent:true,events:[]}])await held({...options(manifest),evidenceSource:source},'independent-evidence');
 await held({...options(manifest),expectedStreamId:'different-stream'},'independent-evidence');
 await held({...options(manifest),evidenceSource:{fetch:async()=>{throw Error(canary);}}},'independent-evidence');
 if(fixture.sql){
  let cancelled=false;
  await held({...options(manifest),evidenceSource:{fetch:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))}},'independent-evidence');
  assert.equal(cancelled,true,'A stalled evidence body must be cancelled at the deadline');
 }
 for(const mutate of [b=>b.challenge='old-challenge',b=>b.manifestDigest='a'.repeat(64),b=>b.snapshotId=id(),b=>b.streamId='other-stream',b=>b.archiveState='expired'])await held({...options(manifest),evidenceSource:altered(mutate)},'evidence-binding');
 for(const mutate of [b=>b.issuedAt=now+1,b=>b.issuedAt=now-10001,b=>b.expiresAt=now,b=>b.expiresAt=now+30001])await held({...options(manifest),evidenceSource:altered(mutate)},'evidence-freshness');
 for(const mutate of [b=>b.baseSequence=1,b=>b.currentSequence=1,b=>b.capturedSequence=99])await held({...options(manifest),evidenceSource:altered(mutate)},'evidence-gap');
 for(const numbers of [[2,1],[1,1]])await held({...options(manifest),evidenceSource:altered(b=>{b.currentSequence=2;b.events=numbers.map(sequence=>({sequence,kind:'owner-erased',data:{ownerId:'other-owner'}}));})},'evidence-gap');
 await held({...options(manifest),evidenceSource:altered(b=>{b.approved=true;})},'evidence-contract');
 await held({...options(manifest),evidenceSource:{fetch:async()=>new Response('x'.repeat(262145))}},'evidence-bound');
 await held({...options(manifest),manifest:{...manifest,version:0}},'manifest');
 await held({...options(manifest),manifest:{...manifest,cipherFormat:'obsolete'}},'manifest-mismatch');
 await held({...options(manifest),manifest:{...manifest,tables:[]}},'manifest-mismatch');
 await held({...options(manifest),manifest:{...manifest,compilers:[]}},'manifest-mismatch');
 await held({...options(manifest),objects:undefined},'missing-objects');
 await held({...options(manifest),objects:{get:async()=>null}},'missing-objects');
 await held({...options(manifest),objects:{get:async()=>({size:objectBytes.length,arrayBuffer:async()=>new Uint8Array(objectBytes.length).buffer})}},'object-integrity');
 event('identity-epoch',{ownerId:owner.account,epoch:2});await held(options(manifest),'stale-identity');
 clear();permit(manifest);event('owner-erased',{ownerId:owner.account});await held(options(manifest),'removed-owner');
 clear();permit(manifest);event('record-suppressed',{table:'identity_sessions',key:{id:owner.authority}});await held(options(manifest),'suppressed-record');
 clear();permit(manifest);event('record-suppressed',{table:'identity_credentials',key:{id:owner.credential}});await held(options(manifest),'suppressed-record');
 clear();permit(manifest);const effectId=id();event('external-effect',{effectId,store:'standard_ai_requests',state:'unknown',receipt:null});await held(options(manifest),'uncertain-effect');
 const token=records.find(r=>r.provider==='github'&&r.purpose==='token');
 event('external-effect',{effectId,store:'standard_ai_requests',state:'reconciled',receipt:{sha256:'f'.repeat(64)}});await held(options(manifest),'uncertain-effect');
 const tokenRow=await db.prepare('SELECT * FROM github_token_vault WHERE id=?').bind(token.record).first();
 await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-02','2026-10-02')").bind(effectId,owner.account,'b'.repeat(64)).run();
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(effectId).run();
 const pendingEffect=await db.prepare('SELECT * FROM standard_ai_requests WHERE id=?').bind(effectId).first();
 manifest=await current();event('external-effect',{effectId,store:'standard_ai_requests',state:'reconciled',receipt:{sha256:rowHash(pendingEffect)}});await held(options(manifest),'uncertain-effect');
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?").bind(effectId).run();
 const effectRow=await db.prepare('SELECT * FROM standard_ai_requests WHERE id=?').bind(effectId).first();
 manifest=await current();event('external-effect',{effectId,store:'standard_ai_requests',state:'reconciled',receipt:{sha256:rowHash(effectRow)}});await passed(options(manifest));
 clear();manifest=await current();event('external-effect',{effectId:token.record,store:'github_token_vault',state:'reconciled',receipt:{sha256:rowHash(tokenRow)}});await held(options(manifest),'evidence-contract');
 clear();permit(manifest);event('record-current',{table:'users',key:{id:owner.account},sha256:'f'.repeat(64)});await held(options(manifest),'stale-authority');
 clear();permit(manifest);event('unrecognized-kind',{});await held(options(manifest),'evidence-contract');
 clear();permit(manifest);event('record-suppressed',{table:'users; DELETE FROM users',key:{id:owner.account}});await held(options(manifest),'evidence-contract');
 clear();permit(manifest);
 let reads=0;await held({...options(manifest),evidenceSource:{fetch:async request=>{if(++reads===2)event('owner-erased',{ownerId:'an-unrelated-owner'});return evidenceSource.fetch(request);}}},'evidence-changed');
 reads=0;clear();permit(manifest);
 await held({...options(manifest),evidenceSource:altered(b=>{if(++reads===2)b.keyBackup.sha256='f'.repeat(64);})},'evidence-changed');
 clear();permit(manifest);
 let changed=false;const changing=interceptDatabase(db,/SELECT \* FROM "users"/,async()=>{if(changed)return;changed=true;await db.prepare("UPDATE users SET created_at='changed@example.invalid' WHERE id=?").bind(owner.account).run();});
 // Mutating during the object read occurs after the first admitted snapshot.
 await held({...options(manifest),objects:{get:async key=>{await changing.prepare('SELECT * FROM "users"').all();return objects.get(key);}}},'candidate-changed');
 clear();manifest=await current();await passed(options(manifest));
 // Already dispatched custody is unresolved even if independent history is empty.
 const exchange=id();await db.prepare("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state) VALUES(?,?,'github','fixture','unknown','fixture-current',1,'dispatched')").bind(exchange,owner.account).run();
 clear();manifest=await current();await held(options(manifest),'uncertain-effect');
 await assert.rejects(db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).run(),/connection_outcome_required/);
 await db.prepare("INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,'rejected','bad_verification_code',200,created_at FROM connection_oauth_exchanges WHERE token_id=?").bind(exchange).run();
 await db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(exchange).run();
 // Only independently recorded exact terminal evidence reconciles this operation.
 clear();manifest=await current();event('external-effect',{effectId:exchange,store:'connection_oauth_exchanges',state:'unknown',receipt:null});await held(options(manifest),'uncertain-effect');
 const outcome=await db.prepare('SELECT * FROM connection_oauth_outcomes WHERE id=?').bind(exchange).first();
 event('external-effect',{effectId:exchange,store:'connection_oauth_exchanges',state:'reconciled',receipt:{sha256:rowHash({...outcome,client_id:'other-client'})}});await held(options(manifest),'uncertain-effect');
 event('external-effect',{effectId:exchange,store:'connection_oauth_exchanges',state:'reconciled',receipt:{sha256:rowHash(outcome)}});await passed(options(manifest));
 const requestId=id();await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-02','2026-10-02')").bind(requestId,owner.account,'a'.repeat(64)).run();
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(requestId).run();await db.prepare("UPDATE standard_ai_requests SET state='uncertain' WHERE id=?").bind(requestId).run();
 clear();manifest=await current();await held(options(manifest),'uncertain-effect');await db.prepare('DELETE FROM standard_ai_requests WHERE id=?').bind(requestId).run();
 // Publication and cancelled-review checks use actual current rows.
 let revision=(await m.readChat(scope,owner.account)).state.revision,review=id();
 assert.equal((await m.sendChat(scope,owner.account,{id:review,revision,content:'/publish '+version})).status,200);
 clear();manifest=await current();event('record-suppressed',{table:'publication_actions',key:{id:review}});await held(options(manifest),'suppressed-record');
 clear();revision=(await m.readChat(scope,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(scope,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:review}})).status,200);
 manifest=await current();event('publication-withdrawn',{projectId:project,surface:'site'});await held(options(manifest),'withdrawn-publication');
 // A later explicit independent current receipt supersedes a past withdrawal.
 const publication=await db.prepare('SELECT * FROM publications WHERE project_id=?').bind(project).first();
 event('record-current',{table:'publications',key:{project_id:project},sha256:rowHash(publication)});await passed(options(manifest));
 // Substitution remains undecryptable even when a matching data manifest is registered.
 const substituted=id();await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')").bind(substituted,owner.account,tokenRow.ciphertext).run();
 clear();manifest=await current();await held(options(manifest),'credential-authentication');
 await db.prepare('DELETE FROM github_token_vault WHERE id=?').bind(substituted).run();
 clear();manifest=await current();await db.prepare('CREATE TABLE unclassified_restore_data(id TEXT)').run();await held(options(manifest),'current-schema');await db.prepare('DROP TABLE unclassified_restore_data').run();
 await passed(options(manifest));
 if(fixture.sql){
  const directory=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-isolated-restore-');let restored;
  try{
   const path=join(directory,'current-snapshot.sqlite');await backup(fixture.sql,path);
   const bytes=await readFile(path);assert.ok(!bytes.includes(canary));assert.ok(!bytes.includes(JSON.parse(keyring).keys[0].secret));
   restored=new DatabaseSync(path,{readOnly:true});const copy=sqliteD1Adapter(restored);
   await passed({...options(manifest),db:copy});await held({...options(manifest),db:copy,keyBackup:undefined},'key-backup-binding');
   // Revoke in the current source after the archive exists. The independent
   // service records that action; the unchanged historical copy still has it.
   await owner.revoke();event('record-suppressed',{table:'identity_sessions',key:{id:owner.authority}});
   assert.equal(await db.prepare('SELECT id FROM identity_sessions WHERE id=?').bind(owner.authority).first(),null);
   assert.ok(await copy.prepare('SELECT id FROM identity_sessions WHERE id=?').bind(owner.authority).first());
   await held({...options(manifest),db:copy},'suppressed-record');
   assert.ok((await readFile(path)).equals(bytes),'Verification cannot rewrite or sanitize the archived database silently');
  }finally{restored?.close();await rm(directory,{recursive:true,force:true});}
 }
 // Retained keys are current-format versions. An interrupted rotation requires
 // the source key even after its write policy has moved to the new key.
 const modules=await currentFixtureModules(['src/connection-rotation.ts']),rotation=await modules.module('src/connection-rotation.ts');
 const next=fixtureKeyring('cd'.repeat(32),'fixture-next',JSON.parse(keyring).keys);
 await rotation.registerConnectionKeys(db,next,'restore-rotation-review');
 await rotation.beginConnectionRotation(db,next,{id:'restore-rotation',reviewId:'restore-rotation-review',expectedRevision:1});
 keyBackup=(await backupFixture.create(next)).proof;clear();manifest=await current();
 await heldWithBackup(manifest,(await backupFixture.create(fixtureKeyring('cd'.repeat(32),'fixture-next'))).proof,'credential-authentication');
 await held(options(manifest),'key-rotation-unsettled');
 await rotation.rotateConnectionBatch(db,next,'restore-rotation','restore-batch');
 clear();manifest=await current();const rotated=await passed(options(manifest));assert.deepEqual(rotated.keys.keyIds,['fixture-current','fixture-next']);
 console.log(`Isolated current restore admission passed: ${refusals} holds, four authenticated credential stores, complete schema/compiler manifest, independent synthetic archive/event service, stale identity/deletion/review/publication/effect checks, private object integrity and readback races. No serving, provider dispatch, key retirement or operational backup claim.`);
}finally{globalThis.fetch=originalFetch;journal.close();await backupFixture.close();await fixture.close();}

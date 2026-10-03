import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
const modules=await currentFixtureModules(['src/connection-rotation.ts','src/connection-vault.ts','src/connection-write-policy.ts','src/workspace-identity/admission.ts']);
const r=await modules.module('src/connection-rotation.ts'),v=await modules.module('src/connection-vault.ts'),w=await modules.module('src/connection-write-policy.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const keyA={id:'key-a',secret:'ab'.repeat(32)},keyB={id:'key-b',secret:'cd'.repeat(32)},keyC={id:'key-c',secret:'ef'.repeat(32)};
const a=fixtureKeyring(keyA.secret,keyA.id),b=fixtureKeyring(keyB.secret,keyB.id,[keyA]),c=fixtureKeyring(keyC.secret,keyC.id,[keyA,keyB]);
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const tables=[['github_token_vault','ciphertext','id','github','token'],['cloudflare_token_vault','ciphertext','id','cloudflare','token'],['github_oauth_states','verifier_ciphertext','state_hash','github','pkce'],['cloudflare_oauth_states','verifier_ciphertext','state_hash','cloudflare','pkce']];
const request=(name,revision)=>({id:name,reviewId:'review-'+name,expectedRevision:revision});
// Measure the actual adapter metadata; never infer remote CPU from elapsed time.
const measurement={statements:0,reportedRowsRead:0,reportedRowsWritten:0,providerMetricsAvailable:true};
function measuredDB(base){
 const originals=new WeakMap();
 const record=results=>{for(const result of results){measurement.statements++;const meta=result.meta??{};if(!Number.isFinite(meta.rows_read)||!Number.isFinite(meta.rows_written))measurement.providerMetricsAvailable=false;measurement.reportedRowsRead+=meta.rows_read??0;measurement.reportedRowsWritten+=meta.rows_written??0;}return results;};
 function prepare(q){function wrap(statement){const wrapped={bind:(...v)=>wrap(statement.bind(...v)),run:async()=>record([await statement.run()])[0],all:async()=>record([await statement.all()])[0],first:async()=>record([await statement.all()])[0].results[0]??null};originals.set(wrapped,statement);return wrapped;}return wrap(base.prepare(q));}
 return {prepare,batch:async statements=>record(await base.batch(statements.map(s=>originals.get(s))))};
}
let assertions=0;async function refuses(p,pattern){await assert.rejects(p,pattern);assertions++;}
try{
 const owner=await workspaceFixture(db,modules.identity),scope=await owner.scope(),authority=(await modules.module('src/workspace-identity/admission.ts')).workspacePrincipal(scope,owner.account).authorityId;
 await refuses(w.sealConnectionWrite(db,a,`whumpo:github:token:${owner.account}:unadmitted`,'synthetic'),{code:'write-key'});
 await r.initializeConnectionKeys(db,a,'initial-review');
 assert.deepEqual({...await r.initializeConnectionKeys(db,a,'initial-review')},{active_key:'key-a',revision:1,review_id:'initial-review'});
 await refuses(r.registerConnectionKeys(scope,b,'customer-review'),/maintenance authority/);
 await refuses(r.registerConnectionKeys(db,fixtureKeyring(keyB.secret,keyA.id),'rebind'),/unavailable/);
 await refuses(run("UPDATE connection_key_registry SET fingerprint=? WHERE id='key-a'",'aa'.repeat(32)),/connection_key_identity/);
 await refuses(run("DELETE FROM connection_key_registry WHERE id='key-a'"),/connection_key_custody_required/);
 await refuses(w.sealConnectionWrite(db,fixtureKeyring(keyB.secret,keyA.id),`whumpo:github:token:${owner.account}:unadmitted`,'synthetic'),{code:'write-key'});
 await r.registerConnectionKeys(db,b,'next-review');
 const original=new Map(),records=new Map();
 for(const [table,cipher,record,provider,purpose] of tables){
  const recordId=purpose==='pkce'?id().replaceAll('-','').repeat(2):id(),context=`whumpo:${provider}:${purpose}:${owner.account}:${recordId}`;
  const ciphertext=await v.seal(a,context,'PRIVATE_ROTATION_CANARY_'+table);records.set(table,recordId);
  if(purpose==='pkce')await run(`INSERT INTO ${table}(user_id,state_hash,authority_id,verifier_ciphertext,expires_at) VALUES(?,?,?,?,'2099-01-01T00:00:00.000Z')`,owner.account,recordId,authority,ciphertext);
  else if(provider==='github')await run("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01T00:00:00.000Z','active')",recordId,owner.account,ciphertext);
  else await run("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,'2099-01-01T00:00:00.000Z','2026-10-02T00:00:00.000Z','staged')",recordId,owner.account,ciphertext);
  original.set(table,await row(`SELECT * FROM ${table} WHERE ${record}=?`,recordId));
 }
 await run("INSERT INTO github_token_staging VALUES(?,?,'2099-01-01T00:00:00.000Z')",records.get('github_token_vault'),'synthetic-state');
 await run("INSERT INTO github_revocation_claims VALUES(?,?,'2099-01-01T00:00:00.000Z')",records.get('github_token_vault'),'synthetic-claim');
 await refuses(r.beginConnectionRotation(db,a,request('same-key',1)),/unavailable/);
 await refuses(r.beginConnectionRotation(db,b,request('wrong-revision',2)),/unavailable/);
 // Already dispatched exchanges survive flow deletion, sign-out and elapsed time.
 const exchange=id();await run("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state,created_at) VALUES(?,?,'github','fixture','unknown','key-a',1,'dispatched','2000-01-01')",exchange,owner.account);
 await refuses(r.beginConnectionRotation(db,b,request('first',1)),/unavailable/);
 assert.equal((await r.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,1);
 await refuses(run('DELETE FROM connection_oauth_exchanges WHERE token_id=?',exchange),/connection_outcome_required/);
 // Synthetic terminal provider response fixture, never expiry or independent proof.
 await run("INSERT INTO connection_oauth_outcomes(id,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at) SELECT token_id,user_id,provider,client_id,state_hash,key_id,revision,'rejected','bad_verification_code',200,created_at FROM connection_oauth_exchanges WHERE token_id=?",exchange);
 await run('DELETE FROM connection_oauth_exchanges WHERE token_id=?',exchange);
 const corrupt='000-corrupt';await run("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')",corrupt,owner.account,'wv2.key-a.not-a-valid-iv.corrupt');
 const lostBegin=interceptDatabase(db,/INSERT INTO connection_key_rotations/,async()=>{},async()=>{throw Error('lost activation reply');});
 assert.equal((await r.beginConnectionRotation(lostBegin,b,request('first',1))).revision,2);
 assert.equal((await r.beginConnectionRotation(db,b,request('first',1))).revision,2);
 await refuses(r.beginConnectionRotation(db,b,{...request('first',1),reviewId:'different-review'}),/unavailable/);
 await refuses(r.rotateConnectionBatch(db,b,'first','corrupt-source'),{code:'ciphertext'});assert.equal(await row("SELECT 1 FROM connection_rotation_batches WHERE id='corrupt-source'"),null);await run('DELETE FROM github_token_vault WHERE id=?',corrupt);
 // Stale writes fail at SQL commit even if crypto was computed before activation.
 for(const [table,cipher,record] of tables){
  const current=original.get(table),next=await v.seal(b,`whumpo:${table.startsWith('github')?'github':'cloudflare'}:${record==='id'?'token':'pkce'}:${owner.account}:${records.get(table)}`,'unreviewed replacement');
  await refuses(run(`UPDATE ${table} SET ${cipher}=? WHERE ${record}=?`,next,records.get(table)),/connection_rotation_required/);
  if(record==='id')await refuses(run(`INSERT INTO ${table}(id,user_id,ciphertext,expires_at${table.startsWith('cloudflare')?',created_at':''},state) VALUES(?,?,?,'2099-01-01'${table.startsWith('cloudflare')?",'2026-10-02'":''},'active')`,id(),owner.account,current[cipher]),/connection_write_key_changed/);
  else await refuses(run(`UPDATE ${table} SET state_hash=?,${cipher}=? WHERE user_id=?`,id(),current[cipher],owner.account),/connection_write_key_changed/);
 }
 await refuses(w.sealConnectionWrite(db,a,`whumpo:github:token:${owner.account}:stale`,'synthetic'),{code:'write-key'});
 await refuses(run("UPDATE cloudflare_token_vault SET expires_at='2098-01-01' WHERE id=?",records.get('cloudflare_token_vault')),/cloudflare_vault_immutable/);
 // Unknown source keys and corrupt payloads cannot produce any replacement receipt.
 await refuses(r.rotateConnectionBatch(db,fixtureKeyring(keyB.secret,keyB.id),'first','missing-source'),{code:'missing-key'});
 // Wrong-current-key is refused independently of data selection.
 await refuses(r.rotateConnectionBatch(db,a,'first','wrong-active'),/unavailable/);
 const fault={prepare:db.prepare.bind(db),batch:statements=>db.batch([...statements,db.prepare("UPDATE connection_key_registry SET review_id='forbidden'")])};
 await refuses(r.rotateConnectionBatch(fault,b,'first','interrupted',2),/unavailable/);
 assert.equal(await row("SELECT 1 FROM connection_rotation_batches WHERE id='interrupted'"),null);
 assert.equal((await row('SELECT COUNT(*) AS n FROM connection_rotation_guards')).n,0);
 assert.equal((await row('SELECT ciphertext FROM github_token_vault WHERE id=?',records.get('github_token_vault'))).ciphertext,original.get('github_token_vault').ciphertext);
 // Disconnect/lease changes between read and CAS are preserved and retried later.
 let raced=false;const racing=interceptDatabase(db,/INSERT INTO connection_rotation_batches/,async()=>{if(!raced){raced=true;await run("UPDATE github_token_vault SET state='revoking' WHERE id=?",records.get('github_token_vault'));await run("UPDATE cloudflare_token_vault SET state='revoking',revoke_attempt='new-attempt',revoke_after='2099-01-01' WHERE id=?",records.get('cloudflare_token_vault'));}});
 const skipped=await r.rotateConnectionBatch(racing,b,'first','raced',2);assert.equal(skipped.changed_count,0);assert.equal(skipped.selected_count,2);
 const lost=interceptDatabase(db,/INSERT INTO connection_rotation_batches/,async()=>{},async()=>{throw Error('lost batch acknowledgement');});
 const receipt=await r.rotateConnectionBatch(lost,b,'first','interrupted',2);assert.equal(receipt.changed_count,2);
 assert.deepEqual(await r.rotateConnectionBatch(db,b,'first','interrupted',2),receipt);
 assert.equal((await row('SELECT COUNT(*) AS n FROM connection_rotation_guards')).n,0);
 const cpuStart=process.cpuUsage();const second=await r.rotateConnectionBatch(measuredDB(db),b,'first','remaining',20);const cpu=process.cpuUsage(cpuStart);assert.equal(second.changed_count,2);
 const status=await r.connectionRotationStatus(db,'first');assert.deepEqual({state:status.state,remaining:status.remaining,rotated:status.rotated,skipped:status.skipped},{state:'complete',remaining:0,rotated:4,skipped:2});
 for(const [table,cipher,record,provider,purpose] of tables){
  const after=await row(`SELECT * FROM ${table} WHERE ${record}=?`,records.get(table)),before=original.get(table);
  assert.equal(v.connectionCiphertextKeyId(after[cipher]),'key-b');
  assert.equal(await v.unseal(b,`whumpo:${provider}:${purpose}:${owner.account}:${records.get(table)}`,after[cipher]),'PRIVATE_ROTATION_CANARY_'+table);
  for(const field of Object.keys(before).filter(f=>f!==cipher&&!['state','revoke_attempt','revoke_after'].includes(f)))assert.equal(after[field],before[field]);
 }
 assert.equal((await row('SELECT state FROM github_token_vault WHERE id=?',records.get('github_token_vault'))).state,'revoking');
 assert.equal((await row('SELECT revoke_attempt FROM cloudflare_token_vault WHERE id=?',records.get('cloudflare_token_vault'))).revoke_attempt,'new-attempt');
 assert.equal((await row('SELECT claim_id FROM github_revocation_claims WHERE token_id=?',records.get('github_token_vault'))).claim_id,'synthetic-claim');
 assert.ok(await row('SELECT 1 FROM github_token_staging WHERE token_id=?',records.get('github_token_vault')));
 const retirement=await r.connectionKeyRetirementStatus(db,'key-a');assert.equal(retirement.liveReferences,0);assert.equal(retirement.retirementAllowed,false);assert.equal(retirement.independentRestoreEvidence,'required');
 await refuses(run("DELETE FROM connection_key_registry WHERE id='key-a'"),/connection_key_custody_required/);
 assert.doesNotMatch(JSON.stringify({status,receipt,retirement}),/PRIVATE_ROTATION|wv2\.|fingerprint|abababab|cdcdcdcd/);
 // A newer worker may finish rotation and activate C after an old worker reads.
 // The old worker then fails the same atomic generation boundary.
 const reused=fixtureKeyring(keyA.secret,keyA.id,[keyB]);await refuses(r.beginConnectionRotation(db,reused,request('reused-key',2)),/unavailable/);
 const d=fixtureKeyring('12'.repeat(32),'key-d',[keyA,keyB,keyC]);await r.registerConnectionKeys(db,d,'fourth-review');
 await r.registerConnectionKeys(db,c,'third-review');await r.beginConnectionRotation(db,c,request('second',2));
 let advanced=false;const newer=interceptDatabase(db,/INSERT INTO connection_rotation_batches/,async()=>{if(!advanced){advanced=true;await r.rotateConnectionBatch(db,c,'second','winner',20);await r.beginConnectionRotation(db,d,request('third',3));}});
 await refuses(r.rotateConnectionBatch(newer,c,'second','stale-batch',20),/unavailable/);
 const historical=await r.connectionRotationStatus(db,'second');assert.equal(historical.state,'complete');assert.equal(historical.current,false);assert.equal(historical.remaining,null);
 assert.equal(await row("SELECT 1 FROM connection_rotation_batches WHERE id='stale-batch'"),null);
 await refuses(r.rotateConnectionBatch(db,c,'second','interrupted'),/unavailable/);
 let deleted=false;const replacementFlow=id().replaceAll('-','').repeat(2);
 const deleting=interceptDatabase(db,/INSERT INTO connection_rotation_batches/,async()=>{if(!deleted){deleted=true;
  await run('DELETE FROM cloudflare_token_vault WHERE id=?',records.get('cloudflare_token_vault'));
  const ciphertext=await v.seal(d,`whumpo:github:pkce:${owner.account}:${replacementFlow}`,'new-flow');
  await run('UPDATE github_oauth_states SET state_hash=?,verifier_ciphertext=?,claimed=0 WHERE user_id=?',replacementFlow,ciphertext,owner.account);
 }});
 const last=await r.rotateConnectionBatch(deleting,d,'third','deleted-and-replaced',20);assert.equal(last.selected_count,4);assert.equal(last.changed_count,2);
 assert.equal(await row('SELECT 1 FROM cloudflare_token_vault WHERE id=?',records.get('cloudflare_token_vault')),null);
 assert.equal((await row('SELECT state_hash FROM github_oauth_states WHERE user_id=?',owner.account)).state_hash,replacementFlow);
 assert.equal((await r.connectionRotationStatus(db,'third')).state,'complete');
 const duplicates=await Promise.all([r.rotateConnectionBatch(db,d,'third','deleted-and-replaced'),r.rotateConnectionBatch(db,d,'third','deleted-and-replaced')]);assert.deepEqual(duplicates,[last,last]);
 assert.equal((await r.connectionKeyRetirementStatus(db,'key-d')).active,true);

 console.log(JSON.stringify({test:'connection rotation',backend:process.argv.includes('--d1')?'local D1':'SQLite',explicitRefusals:assertions,stores:4,receipts:status.batches,rowsChanged:status.rotated,casSkips:status.skipped,encryptedBytesBefore:receipt.bytes_before+second.bytes_before,encryptedBytesAfter:receipt.bytes_after+second.bytes_after,cryptoElapsedMs:receipt.crypto_ms+second.crypto_ms,runnerCpuMicroseconds:cpu.user+cpu.system,batchMeasurement:measurement,scope:'synthetic current schema; no deployed key changes'}));
}finally{await fixture.close();}

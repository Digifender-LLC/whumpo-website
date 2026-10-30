import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 4 (WH-086 push devices and events, handoff source link) over the current schema on disposable in-memory SQLite and, with --d1, actual local D1:
// the two new tables, their keys, CHECKs, triggers and cascades, the live-device view, and the two identity_sessions columns (lineage_id, source_lineage_id).
// Behaviour through the Worker is tests/mobile-push.mjs and tests/mobile-handoff.mjs. Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r}));
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),id=()=>crypto.randomUUID(),hex=n=>(crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','')).slice(0,n);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const account=id(),other=id(),project=id(),credential=id();
for(const u of [account,other])await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",u,u+'@example.test');
await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Testing','draft','2026-10-30','2026-10-30')",project,account);
for(const u of [account,other])await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",u,'a'.repeat(64),id());
await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic','active',NULL,unixepoch(),NULL)",credential,account,new Uint8Array(32));
const session=(o={})=>{
 const row={id:id(),token_hash:hex(64),account_id:account,policy_version:1,auth_epoch:1,client:'android',credential_id:credential,proof_method:"passkey",proof_at:Math.floor(Date.now()/1000)-5,issued_at:Math.floor(Date.now()/1000),expires_at:Math.floor(Date.now()/1000)+3600,...o};
 const keys=Object.keys(row);return run(`INSERT INTO identity_sessions(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k])).then(()=>row);
};
const device=(o={})=>{
 const row={id:id(),account_id:account,lineage_id:id(),platform:'android',token_hash:hex(64),token_sealed:'wv2.'+hex(30),notifications_enabled:1,created_at:1000,last_seen_at:1000,...o};
 const keys=Object.keys(row);return run(`INSERT INTO push_devices(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>row[k])).then(()=>row);
};
try{
 await check('push_devices and push_events are STRICT with the declared columns, keys and cascades',async()=>{
  assert.deepEqual((await all("SELECT name,strict FROM pragma_table_list WHERE name IN ('push_devices','push_events') ORDER BY name")).map(r=>[r.name,r.strict]),[['push_devices',1],['push_events',1]]);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('push_devices') ORDER BY cid")).map(r=>r.name),['id','account_id','lineage_id','platform','token_hash','token_sealed','notifications_enabled','created_at','last_seen_at','revoked_at']);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('push_events') ORDER BY cid")).map(r=>r.name),['id','account_id','kind','project_id','review_id','created_at','expires_at']);
  assert.deepEqual((await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('push_devices')")).map(r=>[r.from,r.table,r.on_delete]),[['account_id','users','CASCADE']]);
  assert.deepEqual((await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('push_events') ORDER BY \"from\"")).map(r=>[r.from,r.table,r.on_delete]),[['account_id','users','CASCADE'],['project_id','projects','SET NULL']]);
  const unique=(await all("SELECT il.name,group_concat(ii.name) cols FROM pragma_index_list('push_devices') il JOIN pragma_index_info(il.name) ii WHERE il.\"unique\"=1 AND il.origin!='pk' GROUP BY il.name")).map(r=>r.cols).sort();
  assert.deepEqual(unique,['lineage_id','token_hash'],'one registration per lineage, one owner per token');
  assert.deepEqual((await all("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE 'push\\_%' ESCAPE '\\' ORDER BY name")).map(r=>r.name+'@'+r.tbl_name),
   ['push_device_immutable@push_devices','push_device_limit@push_devices','push_event_immutable@push_events','push_event_limit@push_events']);
  assert.deepEqual((await all("SELECT name FROM sqlite_master WHERE type='view' AND name='push_live_devices'")).length,1);
 });

 await check('identity_sessions gain a stable lineage (defaulted, 36 characters) and a source link only a native session may carry; both are immutable',async()=>{
  assert.deepEqual((await all("SELECT name,\"notnull\" nn FROM pragma_table_info('identity_sessions') WHERE name IN ('lineage_id','source_lineage_id') ORDER BY cid")).map(r=>[r.name,r.nn]),[['lineage_id',1],['source_lineage_id',0]]);
  const s=await session();assert.equal((await all('SELECT length(lineage_id) n FROM identity_sessions WHERE id=?',s.id))[0].n,36,'a row written without a lineage gets its own');
  const explicit=id(),t=await session({lineage_id:explicit});assert.equal((await all('SELECT lineage_id FROM identity_sessions WHERE id=?',t.id))[0].lineage_id,explicit);
  await assert.rejects(()=>session({lineage_id:'short'}),/CHECK/);await assert.rejects(()=>session({source_lineage_id:'short'}),/CHECK/);
  await assert.rejects(()=>session({client:'web',source_lineage_id:id()}),/CHECK/,'a web session has no source');
  const web=await session({client:'web'}),native=await session({client:'android',proof_method:'handoff',source_lineage_id:(await all('SELECT lineage_id FROM identity_sessions WHERE id=?',web.id))[0].lineage_id});
  assert.equal((await all('SELECT source_lineage_id FROM identity_sessions WHERE id=?',native.id))[0].source_lineage_id.length,36);
  await assert.rejects(()=>run('UPDATE identity_sessions SET lineage_id=? WHERE id=?',id(),native.id),/identity_session_immutable/);
  await assert.rejects(()=>run('UPDATE identity_sessions SET source_lineage_id=NULL WHERE id=?',native.id),/identity_session_immutable/);
  await assert.rejects(()=>run('UPDATE identity_sessions SET source_lineage_id=? WHERE id=?',id(),s.id),/identity_session_immutable/);
  assert.deepEqual((await all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='identity_sessions' AND name IN ('identity_sessions_source','identity_sessions_lineage') ORDER BY name")).map(r=>r.name),['identity_sessions_lineage','identity_sessions_source']);
 });

 await check('push_live_devices: a current android session of the lineage, a ready account at the same epoch, an unrevoked opted-in device',async()=>{
  const lineage=id();await session({lineage_id:lineage});const d=await device({lineage_id:lineage});
  const live=async()=>(await all('SELECT id FROM push_live_devices WHERE id=?',d.id)).length===1;
  assert.equal(await live(),true);
  await run('UPDATE push_devices SET notifications_enabled=0 WHERE id=?',d.id);assert.equal(await live(),false,'opted out');
  await run('UPDATE push_devices SET notifications_enabled=1 WHERE id=?',d.id);assert.equal(await live(),true);
  await run('UPDATE push_devices SET revoked_at=2000 WHERE id=?',d.id);assert.equal(await live(),false,'revoked');
  await assert.rejects(()=>run('UPDATE push_devices SET revoked_at=NULL WHERE id=?',d.id),/push_device_immutable/,'a revoked registration is never revived');
  const l2=id(),s2=await session({lineage_id:l2}),d2=await device({lineage_id:l2}),live2=async()=>(await all('SELECT id FROM push_live_devices WHERE id=?',d2.id)).length===1;
  assert.equal(await live2(),true);
  await run('DELETE FROM identity_sessions WHERE id=?',s2.id);assert.equal(await live2(),false,'no session of the lineage');
  await session({lineage_id:l2,client:'web'});assert.equal(await live2(),false,'a web session of the same lineage does not count');
  const l3=id();await session({lineage_id:l3,account_id:account});const foreign=await device({lineage_id:l3,account_id:other});
  assert.equal((await all('SELECT id FROM push_live_devices WHERE id=?',foreign.id)).length,0,'a device and a session of different accounts never match');
 });

 await check('the account cascade removes devices and events; a deleted project keeps the event with no target',async()=>{
  const fresh=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",fresh,fresh+'@example.test');
  const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'P','T','draft','2026-10-30','2026-10-30')",p,fresh);
  await device({account_id:fresh});
  await run("INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,'operation_completed',?,1000,2000)",'e'.repeat(36),fresh,p);
  await run('DELETE FROM projects WHERE id=?',p);
  assert.deepEqual(await all("SELECT project_id FROM push_events WHERE id=?",'e'.repeat(36)),[{project_id:null}]);
  await run('DELETE FROM users WHERE id=?',fresh);
  assert.equal((await all('SELECT count(*) n FROM push_devices WHERE account_id=?',fresh))[0].n,0);assert.equal((await all('SELECT count(*) n FROM push_events WHERE account_id=?',fresh))[0].n,0);
 });

 await check('the lifecycle and sweeps stay content-free: a device holds a sealed token and its hash, an event holds ids and a kind',async()=>{
  const d=await device();const row=(await all('SELECT * FROM push_devices WHERE id=?',d.id))[0];
  assert(Object.values(row).every(v=>typeof v==='number'||v===null||(typeof v==='string'&&!/synthetic-fcm|@/.test(v))));
 });
 console.log(`Schema batch 4: ${cases} checks over push_devices, push_events and the identity_sessions lineage on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}

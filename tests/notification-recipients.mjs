import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
Error.stackTraceLimit=0;
// WH-157 (schema batch 3c): recipient derivation and cross-scope suppression over the actual current schema on disposable SQLite and, with
// --d1, actual local D1. Owner, staff and submitter recipients come only from the notification_recipients view; the per-account suppression
// list excludes an address in every scope; staff role revocation removes the opt-in; a public record cannot consent; an unverified address is
// excluded; verification while delivery is inactive answers delivery_unavailable and stores nothing. Nothing is sent: no provider, network
// or sender exists. Synthetic rows only.
const m=await currentSiteFixtureHandlers(),R=m.notificationRecipients,fixture=await databaseFixture(),db=fixture.db;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=async(sql,...v)=>{const r=await db.prepare(sql).bind(...v).first();return r&&{...r};};
const at=Math.floor(Date.now()/1000),iso=new Date().toISOString(),sha=c=>c.repeat(64);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const fails=(promise,status)=>assert.rejects(promise,e=>{assert.equal(e?.status,status,String(e?.stack??e));return true;});
const sha256=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');

async function project(){
 const user=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",user,user+'@example.test');
 const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recipients','Synthetic','draft',?,?)",p,user,iso,iso);
 const instance=(resource,local,kind,config,dependencies)=>run("INSERT INTO module_instances(id,project_id,local_id,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,config_revision,source_version_id,source_spec_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'{}',?,?,1,?,?,?,?)",
  resource,p,local,kind,sha('a'),sha('b'),JSON.stringify(config),sha('c'),sha('d'),JSON.stringify(dependencies),id(),sha('e'),at,at);
 const access=id(),records=id();
 await instance(access,'members','access',{roles:['staff'],enrollment:'invitation'},[]);
 await instance(records,'requests','records',{retentionDays:30,schemas:[{id:'request',fieldsRevision:1,fields:[],staffWrite:[]}],forms:[{id:'plain-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'public-form',recordId:'request',submit:'public',uploadCollectionId:null}],views:[]},[access]);
 for(const resource of [access,records])await run("INSERT INTO module_activations(instance_id,state,revision,review_id,descriptor_digest,config_revision,updated_at) VALUES(?,'active',1,?,?,1,?)",resource,id(),sha('d'),at);
 await run('INSERT INTO module_access_states(instance_id,project_id,revision,updated_at) VALUES(?,?,1,?)',access,p,at);
 const o={user,p,access,records};
 o.visitor=async()=>{const v=id();await run("INSERT INTO app_visitors(id,project_id,access_id) VALUES(?,?,?)",v,p,access);return v;};
 o.staff=async v=>run("INSERT INTO module_access_roles(instance_id,visitor_id,project_id,role,state,review_id,access_revision,granted_at,updated_at) VALUES(?,?,?,'staff','granted',?,1,?,?)",access,v,p,id(),at,at);
 o.address=async(v,address,verified=true)=>{await run('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)',v,address);if(verified)await verify(v);};
 o.owner=async address=>{const d=id();await run('INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,?)',d,user,p,address,iso);await run("UPDATE contact_notification_destinations SET state='verified',verified_at=? WHERE id=?",iso,d);return d;};
 o.record=async(v,{consent=1,form='plain-form',kind='visitor'}={})=>{const e=id(),r=id();
  await run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at,receipt_consent) VALUES(?,?,?,'request',?,1,?,?,'{}',1,?,?,unixepoch(),unixepoch(),unixepoch()+2592000,?)",e,records,p,form,kind,kind==='public'?null:v,r,r,consent);return e;};
 return o;
}
// A verified address needs a delivered code, which cannot exist while delivery is inactive; the suite stores the code hash the sender would have.
async function verify(v){
 const code='ABCD2345';await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?',await sha256(code),v);
 await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',v);
}
const recipients=async(o,scope)=>(await R.notificationRecipients(db,o.p,scope)).map(r=>[r.scope,r.ref,r.address]).sort();
const suppress=(o,address,reason='bounce')=>run('INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,?,?)',o.user,address,reason,iso);

// Seeding writes grants and visitors directly: the reviewed Chat paths that normally write them are off for the seed and restored in finally.
const seeded=await all("SELECT name,sql FROM sqlite_master WHERE name IN ('app_visitor_admit','module_access_role_insert')");
for(const t of seeded)await run('DROP TRIGGER '+t.name);
try{
 await check('the objects exist; consent is a 0/1 column defaulting to 0',async()=>{
  const names=(await all("SELECT type,name FROM sqlite_master WHERE name IN ('visitor_notification_addresses','staff_notification_optins','notification_recipients','module_record_consent_admit','staff_notification_optin_revoked') ORDER BY name")).map(r=>r.type+':'+r.name);
  assert.deepEqual(names.sort(),['table:staff_notification_optins','table:visitor_notification_addresses','trigger:module_record_consent_admit','trigger:staff_notification_optin_revoked','view:notification_recipients']);
  const column=(await all("SELECT name,\"notnull\",dflt_value FROM pragma_table_info('module_records') WHERE name='receipt_consent'"))[0];
  assert.deepEqual([column.notnull,column.dflt_value],[1,'0']);
  const fks=await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('visitor_notification_addresses')");
  assert.deepEqual(fks.map(r=>[r.from,r.table,r.on_delete]),[['visitor_id','app_visitors','CASCADE']]);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('staff_notification_optins') ORDER BY cid")).map(r=>r.name),['instance_id','visitor_id','opted_in_at']);
 });

 await check('recipients for each scope come only from current verified, consented records',async()=>{
  const o=await project(),owner=await o.owner('owner@example.test');
  const staff=await o.visitor(),submitter=await o.visitor(),plain=await o.visitor();
  await o.staff(staff);await o.address(staff,'staff@example.test');await R.optInStaff(db,o.p,o.access,staff);
  await o.address(submitter,'guest@example.test');const entry=await o.record(submitter);
  assert.deepEqual(await recipients(o),[['owner',owner,'owner@example.test'],['staff',staff,'staff@example.test'],['submitter',entry,'guest@example.test']].sort());
  assert.deepEqual(await recipients(o,'staff'),[['staff',staff,'staff@example.test']]);
  assert.deepEqual(await recipients(o,'submitter'),[['submitter',entry,'guest@example.test']]);
  // Nothing else qualifies: a staff holder who did not opt in, a record without consent, an unverified address, an unverified owner address.
  const quiet=await o.visitor();await o.staff(quiet);await o.address(quiet,'quiet@example.test');
  await o.record(submitter,{consent:0});
  const unverified=await o.visitor();await o.address(unverified,'unverified@example.test',false);await o.record(unverified);
  await o.record(plain);
  const pending=await project();await run('INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,?)',id(),pending.user,pending.p,'pending@example.test',iso);
  assert.deepEqual(await recipients(pending),[]);
  assert.equal((await recipients(o)).length,3);
  // Another project's recipients are never returned, whatever the caller passes.
  const other=await project();await other.owner('other@example.test');
  assert.deepEqual((await recipients(other)).map(r=>r[2]),['other@example.test']);
  assert.deepEqual(await R.notificationRecipients(db,'not-a-uuid'),[]);
 });

 await check('a public record cannot consent, and an anonymous submitter is never a recipient',async()=>{
  const o=await project(),v=await o.visitor();
  const admit=await one("SELECT sql FROM sqlite_master WHERE name='module_record_admit'");await run('DROP TRIGGER module_record_admit');
  try{
   await assert.rejects(o.record(null,{kind:'public',form:'public-form',consent:1}),/CHECK constraint/);
   await assert.rejects(run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at,receipt_consent) VALUES(?,?,?,'request','public-form',1,'public',NULL,'{}',1,?,?,unixepoch(),unixepoch(),unixepoch()+2592000,2)",id(),o.records,o.p,id(),id()),/CHECK constraint/);
   const anonymous=await o.record(null,{kind:'public',form:'public-form',consent:0});
   assert.equal((await one('SELECT receipt_consent n FROM module_records WHERE id=?',anonymous)).n,0);
  }finally{await run(admit.sql);}
  assert.deepEqual(await recipients(o),[]);
  // The consent never changes after submission.
  await o.address(v,'v@example.test');const entry=await o.record(v,{consent:0});
  await assert.rejects(run('UPDATE module_records SET receipt_consent=1,revision=2,last_request_id=?,updated_at=unixepoch() WHERE id=?',id(),entry),/module_request_stale/);
 });

 await check('verification while delivery is inactive returns delivery_unavailable and stores no code; the address stays excluded',async()=>{
  const o=await project(),v=await o.visitor(),staff=await o.visitor();await o.staff(staff);
  await fails(R.startVisitorVerification(db,o.p,v),404); // no address yet
  assert.deepEqual(await R.setVisitorAddress(db,o.p,v,'  Guest@Example.TEST '),{address:'guest@example.test',verified:false});
  await fails(R.setVisitorAddress(db,o.p,v,'a@b.c, d@e.f'),400);
  assert.deepEqual(await R.startVisitorVerification(db,o.p,v),{status:'delivery_unavailable'});
  assert.deepEqual(await R.startVisitorVerification(db,o.p,v),{status:'delivery_unavailable'});
  assert.deepEqual(await one('SELECT code_hash,code_expires_at,code_failures,verified_at FROM visitor_notification_addresses WHERE visitor_id=?',v),{code_hash:null,code_expires_at:null,code_failures:0,verified_at:null});
  await fails(R.completeVisitorVerification(db,o.p,v,'ABCD2345'),400);
  await o.record(v);assert.deepEqual(await recipients(o),[]);
  // Staff opt-in needs a verified address.
  await R.setVisitorAddress(db,o.p,staff,'staff@example.test');await fails(R.optInStaff(db,o.p,o.access,staff),403);
  assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',staff)).n,0);
  assert.equal(network,0,'no provider call');
 });

 await check('completing verification: hashed code, expiry, five wrong tries, no direct verification',async()=>{
  const o=await project(),v=await o.visitor();
  await R.setVisitorAddress(db,o.p,v,'guest@example.test');
  await assert.rejects(run('UPDATE visitor_notification_addresses SET verified_at=unixepoch() WHERE visitor_id=?',v),/notification_address_state/);
  const code='ABCD2345';
  await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?',await sha256(code),v);
  assert.ok(!JSON.stringify(await all('SELECT * FROM visitor_notification_addresses WHERE visitor_id=?',v)).includes(code),'only the hash is stored');
  await fails(R.completeVisitorVerification(db,o.p,v,'WRONG234'),400);await fails(R.completeVisitorVerification(db,o.p,v,'short'),400);
  assert.equal((await one('SELECT code_failures n FROM visitor_notification_addresses WHERE visitor_id=?',v)).n,2);
  for(let i=0;i<5;i++)await fails(R.completeVisitorVerification(db,o.p,v,'WRONG234'),400);
  await fails(R.completeVisitorVerification(db,o.p,v,code),400); // locked out after five wrong tries
  await run('UPDATE visitor_notification_addresses SET code_failures=0 WHERE visitor_id=?',v);
  await fails(R.completeVisitorVerification(db,o.p+'0',v,code),404);
  assert.deepEqual(await R.completeVisitorVerification(db,o.p,v,' abcd2345 '),{verified:true});
  assert.deepEqual(await one('SELECT code_hash,verified_at IS NOT NULL ok FROM visitor_notification_addresses WHERE visitor_id=?',v),{code_hash:null,ok:1});
  await fails(R.completeVisitorVerification(db,o.p,v,code),400); // a code works once
  // Expired codes fail.
  const late=await o.visitor();await R.setVisitorAddress(db,o.p,late,'late@example.test');
  await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+1 WHERE visitor_id=?',await sha256(code),late);
  await fails(R.completeVisitorVerification(db,o.p,late,code,at+3600),400);
  // Changing the address drops the verification.
  await R.setVisitorAddress(db,o.p,v,'new@example.test');
  assert.equal((await one('SELECT verified_at v FROM visitor_notification_addresses WHERE visitor_id=?',v)).v,null);
 });

 await check('suppression excludes an address in every scope and refuses it at admission',async()=>{
  const o=await project(),shared='shared@example.test';
  await o.owner(shared);
  const staff=await o.visitor(),submitter=await o.visitor();
  await o.staff(staff);await o.address(staff,shared);await R.optInStaff(db,o.p,o.access,staff);
  await o.address(submitter,shared);await o.record(submitter);
  assert.deepEqual((await recipients(o)).map(r=>r[0]).sort(),['owner','staff','submitter']);
  await suppress(o,shared);
  assert.deepEqual(await recipients(o),[]);
  // Another account's suppression of the same address does not apply to this project.
  const other=await project();await other.owner(shared);assert.deepEqual((await recipients(other)).map(r=>r[2]),[shared]);
  // Admission: a suppressed address cannot be set, changed to, opted in with or consented with.
  const fresh=await o.visitor();await fails(R.setVisitorAddress(db,o.p,fresh,shared),409);
  await assert.rejects(run('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)',fresh,shared),/notification_address_suppressed/);
  await R.setVisitorAddress(db,o.p,fresh,'fine@example.test');await fails(R.setVisitorAddress(db,o.p,fresh,shared),409);
  await assert.rejects(run("UPDATE visitor_notification_addresses SET address=? WHERE visitor_id=?",shared,fresh),/notification_address_suppressed/);
  const again=await o.visitor();await o.staff(again);await o.address(again,'again@example.test');
  await suppress(o,'again@example.test','complaint');await fails(R.optInStaff(db,o.p,o.access,again),409);
  await assert.rejects(o.record(submitter),/notification_address_suppressed/);
  // The suppression is final: it cannot be changed or deleted by the owner.
  await assert.rejects(run('DELETE FROM contact_notification_suppressions WHERE user_id=?',o.user),/contact_suppression_final/);
 });

 await check('staff role revocation removes the opt-in, and a re-grant does not opt in again',async()=>{
  const o=await project(),staff=await o.visitor(),keep=await o.visitor();
  for(const v of [staff,keep]){await o.staff(v);await o.address(v,v.slice(0,8)+'@example.test');await R.optInStaff(db,o.p,o.access,v);}
  assert.equal((await recipients(o,'staff')).length,2);
  await run("UPDATE module_access_roles SET state='revoked',review_id=NULL,access_revision=2,updated_at=unixepoch() WHERE visitor_id=?",staff);
  assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',staff)).n,0);
  assert.deepEqual((await recipients(o,'staff')).map(r=>r[1]),[keep]);
  await fails(R.optInStaff(db,o.p,o.access,staff),403);
  await run("UPDATE module_access_roles SET state='granted',review_id=?,access_revision=3,updated_at=unixepoch() WHERE visitor_id=?",id(),staff);
  assert.deepEqual((await recipients(o,'staff')).map(r=>r[1]),[keep],'granting the role does not opt anyone in');
  // Opt-out is idempotent; revoking the visitor revokes the grant and the opt-in; changing or removing the address drops the opt-in.
  await R.optOutStaff(db,o.p,o.access,keep);await R.optOutStaff(db,o.p,o.access,keep);assert.deepEqual(await recipients(o,'staff'),[]);
  await R.optInStaff(db,o.p,o.access,keep);await R.optInStaff(db,o.p,o.access,keep);assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',keep)).n,1);
  await run('UPDATE app_visitors SET revoked=1 WHERE id=?',keep);
  assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',keep)).n,0);assert.deepEqual(await recipients(o),[]);
  const mover=await o.visitor();await o.staff(mover);await o.address(mover,'mover@example.test');await R.optInStaff(db,o.p,o.access,mover);
  await R.setVisitorAddress(db,o.p,mover,'moved@example.test');assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',mover)).n,0);
  await R.setVisitorAddress(db,o.p,mover,'mover@example.test');
  const leaver=await o.visitor();await o.staff(leaver);await o.address(leaver,'leaver@example.test');await R.optInStaff(db,o.p,o.access,leaver);
  await R.removeVisitorAddress(db,o.p,leaver);assert.equal((await one('SELECT count(*) n FROM staff_notification_optins WHERE visitor_id=?',leaver)).n,0);
 });

 await check('two tenants and the visitor identity: no cross-project access, and everything leaves with the visitor or the project',async()=>{
  const a=await project(),b=await project(),va=await a.visitor(),vb=await b.visitor();
  await fails(R.setVisitorAddress(db,b.p,va,'x@example.test'),404);await fails(R.startVisitorVerification(db,a.p,vb),404);await fails(R.optInStaff(db,a.p,a.access,vb),404);
  await fails(R.optInStaff(db,a.p,b.access,va),403); // an access instance of another project never admits
  await a.staff(va);await a.address(va,'va@example.test');await R.optInStaff(db,a.p,a.access,va);const entry=await a.record(va);
  await b.address(vb,'vb@example.test');await b.record(vb);
  assert.deepEqual((await recipients(a)).map(r=>r[2]).sort(),['va@example.test','va@example.test']);
  assert.deepEqual((await recipients(b)).map(r=>r[2]),['vb@example.test']);
  await run('DELETE FROM app_visitors WHERE id=?',va);
  for(const t of ['visitor_notification_addresses','staff_notification_optins'])assert.equal((await one(`SELECT count(*) n FROM ${t} WHERE visitor_id=?`,va)).n,0,t);
  assert.equal((await one('SELECT count(*) n FROM module_records WHERE id=?',entry)).n,0);
  await run('DELETE FROM projects WHERE id=?',b.p);
  assert.equal((await one('SELECT count(*) n FROM visitor_notification_addresses WHERE visitor_id=?',vb)).n,0);
 });
 console.log(`Notification recipients: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; owner, staff and submitter recipients derived by the notification_recipients view, cross-scope suppression, staff revocation, public-record consent refusal, unverified exclusion and delivery_unavailable verification. No provider call.`);
}finally{
  for(const t of seeded)await run(t.sql);
  globalThis.fetch=originalFetch;await fixture.close();
}

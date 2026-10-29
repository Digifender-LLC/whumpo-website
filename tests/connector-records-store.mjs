import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-143: the lookup_consents and connector_receipts tables over the current schema on disposable in-memory SQLite and, with --d1,
// actual local D1. Synthetic rows only: no provider, network, credential, model or real address. Adapter wiring is not built, so
// this proves the schema guards (tenant, credential, operation, parameter digest, destination, expiry, single use, state order),
// retention and bounded maintenance, and that the lifecycle closure removes both tables with the account.
const bundle=await build({stdin:{contents:"export * from './src/connector-records-maintenance';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const hex=c=>c.repeat(64),rejects=(p,re)=>assert.rejects(p,re),day=86400000;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const user=async()=>{const u=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",u,u+'@example.test');return u;};
const consent=(o,x={})=>run("INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,?,?,?,?,?,1)",
 x.id??id(),o,x.provider??'gmail',x.op??'messages.search',x.cred??'credential-1',x.digest??hex('a'),x.dest??'owner-panel',x.at??Date.now(),(x.at??Date.now())+(x.ttl??600000),x.state??'issued');
const step=(cid,to,extra='')=>run(`UPDATE lookup_consents SET state=?,revision=revision+1${extra} WHERE consent_id=?`,to,cid);
const receipt=(o,x={})=>run("INSERT INTO connector_receipts(receipt_id,owner_id,provider,operation_id,authority,rule_revision,credential_id,provider_account_id,destination_id,operation_digest,request_digest,review_digest,price_units,price_basis,state,created_at,expires_at,updated_at,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
 x.id??id(),o,x.provider??'gmail',x.op??'message.send',x.authority??'owner-request',x.rule??null,'credential-1','account-1','dest-1',hex('1'),hex('2'),hex('3'),x.units??0,x.basis??'plan-inclusion',x.state??'review',x.at??Date.now(),(x.at??Date.now())+3600000,x.at??Date.now());
const move=(rid,to,extra='')=>run(`UPDATE connector_receipts SET state=?,revision=revision+1,updated_at=?${extra} WHERE receipt_id=?`,to,Date.now(),rid);
try{
 await check('consent: issued unconfirmed, bound, at most 15 minutes, unknown provider and github refused',async()=>{
  const o=await user();await consent(o);
  await rejects(consent(o,{state:'confirmed'}),/lookup_consent_new|CHECK/);
  await rejects(consent(o,{ttl:900001}),/CHECK/);await consent(o,{ttl:900000});
  await rejects(consent(o,{provider:'github'}),/CHECK/);await rejects(consent(o,{dest:'chat-reply'}),/CHECK/);await rejects(consent(o,{digest:'z'.repeat(64)}),/CHECK/);
  await rejects(consent(id()),/FOREIGN KEY/);
 });
 await check('consent: single use, in order, binding columns frozen, nothing after used or voided',async()=>{
  const o=await user(),cid=id();await consent(o,{id:cid});
  await rejects(step(cid,'used',',confirmed_at=1,settled_at=2'),/lookup_consent_guard/);  // cannot skip the owner's confirmation
  for(const col of ["credential_id='other'","operation_id='message.get'","params_digest='"+hex('b')+"'","destination='model-context'","owner_id='x'","provider='hubspot'","expires_at=expires_at+1"])
   await rejects(run(`UPDATE lookup_consents SET ${col},revision=revision+1 WHERE consent_id=?`,cid),/lookup_consent_guard|FOREIGN KEY/,col);
  const now=Date.now();await step(cid,'confirmed',`,confirmed_at=${now}`);
  await step(cid,'used',`,settled_at=${now+1}`);
  await rejects(step(cid,'used',`,settled_at=${now+2}`),/lookup_consent_guard/);await rejects(step(cid,'confirmed'),/lookup_consent_guard/);await rejects(step(cid,'voided',`,settled_at=${now+2}`),/lookup_consent_guard/);
 });
 await check('consent: an expired row cannot be confirmed or used; voiding stays possible',async()=>{
  const o=await user(),at=Date.now()-700000,a=id(),b=id();await consent(o,{id:a,at});await consent(o,{id:b,at});
  await rejects(step(a,'confirmed',`,confirmed_at=${at+1}`),/lookup_consent_guard/);await step(b,'voided',`,settled_at=${Date.now()}`);
 });
 await check('consent: an owner holds at most 20 unexpired; expired and settled ones do not count',async()=>{
  const o=await user();for(let n=0;n<20;n++)await consent(o,{at:Date.now()-700000-n});
  for(let n=0;n<20;n++)await consent(o);
  await rejects(consent(o),/lookup_consent_new/);
 });
 await check('consent: kept seven days past use or expiry, then deletable; maintenance is bounded',async()=>{
  const o=await user(),fresh=id();await consent(o,{id:fresh});
  await rejects(run('DELETE FROM lookup_consents WHERE consent_id=?',fresh),/lookup_consent_retained/);
  for(let n=0;n<3;n++)await consent(o,{at:Date.now()-8*day-n});
  assert.equal((await m.maintainConnectorRecords(db,2)).consents,2);assert.equal((await m.maintainConnectorRecords(db,2)).consents,1);
  assert.equal((await m.maintainConnectorRecords(db,2)).consents,0);assert.ok(await one('SELECT 1 x FROM lookup_consents WHERE consent_id=?',fresh));
  await rejects(m.maintainConnectorRecords(db,0),/Invalid/);await rejects(m.maintainConnectorRecords(db,1001),/Invalid/);
 });
 await check('receipt: starts in review, binding and digests shaped, rule revision only for rules, quoted price only when quoted',async()=>{
  const o=await user();await receipt(o);
  await rejects(receipt(o,{state:'applied'}),/connector_receipt_new/);
  await rejects(receipt(o,{authority:'approved-rule'}),/CHECK/);await rejects(receipt(o,{rule:3}),/CHECK/);await receipt(o,{authority:'approved-rule',rule:3});
  await rejects(receipt(o,{units:5}),/CHECK/);await receipt(o,{units:5,basis:'quoted'});
  await rejects(receipt(o,{provider:'cloudflare'}),/CHECK/);
  const cols=(await db.prepare('PRAGMA table_info(connector_receipts)').all()).results.map(c=>c.name);
  assert.equal(cols.some(c=>/body|content|recipient|attendee|message|error|token|secret/.test(c)),false,'identifiers and digests only');
 });
 await check('receipt: review -> dispatching -> settled; uncertain only reconciles; settled and expired rows are final; binding frozen',async()=>{
  const o=await user(),r=id(),u=id(),e=id();await receipt(o,{id:r});
  for(const col of ["review_digest='"+hex('9')+"'","request_digest='"+hex('9')+"'","operation_digest='"+hex('9')+"'","credential_id='other'","destination_id='other'","price_units=1","provider_account_id='x'","expires_at=expires_at+1"])
   await rejects(run(`UPDATE connector_receipts SET ${col},revision=revision+1 WHERE receipt_id=?`,r),/connector_receipt_guard|CHECK/,col);
  await rejects(move(r,'applied'),/connector_receipt_guard/);await rejects(move(r,'expired'),/connector_receipt_guard/);  // not dispatched; not yet expired
  await move(r,'dispatching');await rejects(move(r,'review'),/connector_receipt_guard/);
  await move(r,'applied',",provider_object_id='obj-1'");
  await rejects(move(r,'failed'),/connector_receipt_guard/);await rejects(move(r,'dispatching'),/connector_receipt_guard/);
  await receipt(o,{id:u});await move(u,'dispatching');await move(u,'uncertain');await rejects(move(u,'applied'),/connector_receipt_guard/);await move(u,'observed',",provider_object_id='obj-2'");
  const past=Date.now()-7200000;await receipt(o,{id:e,at:past});
  await rejects(move(e,'dispatching'),/connector_receipt_guard/);await move(e,'expired');  // an expired review cannot be claimed
  await rejects(move(e,'cancelled'),/connector_receipt_guard/);
 });
 await check('receipt: kept 400 days, never deleted while dispatching or uncertain; an owner holds at most 2000; maintenance is bounded',async()=>{
  const o=await user(),recent=id(),stuck=id();await receipt(o,{id:recent});
  await rejects(run('DELETE FROM connector_receipts WHERE receipt_id=?',recent),/connector_receipt_retained/);
  const old=Date.now()-401*day;for(let n=0;n<3;n++)await receipt(o,{at:old-n});
  await receipt(o,{id:stuck});await move(stuck,'dispatching');await rejects(run('DELETE FROM connector_receipts WHERE receipt_id=?',stuck),/connector_receipt_retained/);
  const first=await m.maintainConnectorRecords(db,2);assert.equal(first.receipts,2);assert.equal((await m.maintainConnectorRecords(db,5)).receipts,1);
  assert.ok(await one('SELECT 1 x FROM connector_receipts WHERE receipt_id=?',recent));assert.ok(await one('SELECT 1 x FROM connector_receipts WHERE receipt_id=?',stuck),'a dispatched receipt is kept');
  const big=await user(),t=Date.now();
  await run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000) INSERT INTO connector_receipts(receipt_id,owner_id,provider,operation_id,authority,credential_id,provider_account_id,destination_id,operation_digest,request_digest,review_digest,price_units,price_basis,state,created_at,expires_at,updated_at,revision) SELECT 'bulk-'||i,?,'gmail','message.send','owner-request','credential-1','account-1','dest-1',?,?,?,0,'plan-inclusion','review',?,?,?,1 FROM n",big,hex('1'),hex('2'),hex('3'),t,t+3600000,t);
  await rejects(receipt(big),/connector_receipt_new/);
 });
 await check('closure: deleting the account removes its consents and receipts',async()=>{
  const o=await user();await consent(o);await receipt(o);
  await run('DELETE FROM users WHERE id=?',o);
  assert.equal((await one('SELECT count(*) n FROM lookup_consents WHERE owner_id=?',o)).n,0);assert.equal((await one('SELECT count(*) n FROM connector_receipts WHERE owner_id=?',o)).n,0);
 });
 console.log(`Connector records store passed (${cases} cases, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): lookup consent binding, expiry, single use and state order; minimized receipt states, price and digest shape; retention, bounded maintenance and account closure.`);
}finally{await fixture.close();}

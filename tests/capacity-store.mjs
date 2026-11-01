import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-043: the persistent form of the capacity ledger (src/capacity-store.ts). One row per account, compare-and-set on `revision`; the pure operations stay in capacity-ledger.ts.
// Synthetic terms, local D1 only: no route, invoice or admission path reads or writes it.
const b=await build({stdin:{contents:"export * from './src/capacity-store';export {grant,reserve,settle,capacityView} from './src/capacity-ledger';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture({d1:true}),db=fixture.db;
const T=1_000_000,DAY=86400000;
const owner=async()=>{const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,id+'@example.invalid').run();return id;};
const row=user=>db.prepare('SELECT revision,length(state_json) n FROM capacity_ledgers WHERE user_id=?').bind(user).first();
const monthly={id:'m1',kind:'monthly',periodKey:'2026-11',units:100*T,at:1,expiresAt:30*DAY};
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
try{
 await check('an account with no ledger reads as empty at revision 0 and the first change creates revision 1',async()=>{
  const user=await owner();assert.deepEqual(await m.loadLedger(db,user).then(x=>x.revision),0);assert.equal(await row(user),null);
  const first=await m.updateLedger(db,user,l=>m.grant(l,monthly));assert.equal(first.revision,1);
  const saved=await m.loadLedger(db,user);assert.equal(saved.revision,1);assert.equal(m.capacityView(saved.ledger,2,'complete').availableUnits,100*T);
 });
 await check('a replayed operation writes nothing; a different body under the same id is refused and writes nothing',async()=>{
  const user=await owner();await m.updateLedger(db,user,l=>m.grant(l,monthly));
  const again=await m.updateLedger(db,user,l=>m.grant(l,monthly));assert.equal(again.revision,1);assert.equal((await row(user)).revision,1);
  await assert.rejects(m.updateLedger(db,user,l=>m.grant(l,{...monthly,units:5*T})),e=>e.code==='OP_CONFLICT');assert.equal((await row(user)).revision,1);
 });
 await check('changes accumulate by revision and survive a reload (hold, then settle)',async()=>{
  const user=await owner();await m.updateLedger(db,user,l=>m.grant(l,monthly));
  await m.updateLedger(db,user,l=>m.reserve(l,{id:'r1',units:30*T,at:10}));
  const s=await m.updateLedger(db,user,l=>m.settle(l,{id:'r1',actualUnits:20*T,at:11}));assert.equal(s.revision,3);
  const view=m.capacityView((await m.loadLedger(db,user)).ledger,12,'complete');assert.equal(view.availableUnits,80*T);
 });
 await check('two writers that started from the same revision cannot both win',async()=>{
  const user=await owner();await m.updateLedger(db,user,l=>m.grant(l,monthly));
  // The racing writer lands between this request's read and its write.
  const racing={prepare:sql=>{const st=db.prepare(sql);if(!sql.startsWith('UPDATE capacity_ledgers'))return st;return {bind:(...a)=>({run:async()=>{await db.prepare('UPDATE capacity_ledgers SET revision=revision+1 WHERE user_id=?').bind(user).run();return st.bind(...a).run();}})};}};
  await assert.rejects(m.updateLedger(racing,user,l=>m.reserve(l,{id:'r2',units:T,at:10})),e=>e.status===409&&e.code==='revision_conflict');
  const saved=await m.loadLedger(db,user);assert.equal(Object.hasOwn(saved.ledger.reservations,'r2'),false,'the losing write left no trace');
 });
 await check('a refused operation writes nothing',async()=>{
  const user=await owner();await m.updateLedger(db,user,l=>m.grant(l,monthly));
  await assert.rejects(m.updateLedger(db,user,l=>m.reserve(l,{id:'big',units:999*T,at:10})),e=>e.code==='INSUFFICIENT_CAPACITY');assert.equal((await row(user)).revision,1);
 });
 await check('the table refuses a skipped revision, a foreign state version and an unreadable state; an unreadable saved version is not read',async()=>{
  const user=await owner();await m.updateLedger(db,user,l=>m.grant(l,monthly));
  await assert.rejects(db.prepare('UPDATE capacity_ledgers SET revision=5 WHERE user_id=?').bind(user).run(),/capacity_ledger_revision/);
  await assert.rejects(db.prepare("UPDATE capacity_ledgers SET revision=revision+1,state_json='{\"version\":2}' WHERE user_id=?").bind(user).run());
  await assert.rejects(db.prepare("UPDATE capacity_ledgers SET revision=revision+1,state_json='not json' WHERE user_id=?").bind(user).run());
  await assert.rejects(db.prepare("INSERT INTO capacity_ledgers(user_id,revision,state_json,updated_at) VALUES(?,1,'{\"a\":1}',1)").bind(await owner()).run());
  const other=await owner();await db.prepare("INSERT INTO capacity_ledgers(user_id,revision,state_json,updated_at) VALUES(?,1,'{\"version\":1,\"terms\":\"other\"}',1)").bind(other).run();
  await assert.rejects(m.loadLedger(db,other),e=>e.code==='ledger_unreadable');
 });
 await check('ledgers are per account and go with the account',async()=>{
  const a=await owner(),c=await owner();await m.updateLedger(db,a,l=>m.grant(l,monthly));
  assert.equal((await m.loadLedger(db,c)).revision,0,'another account sees nothing');
  await db.prepare('DELETE FROM users WHERE id=?').bind(a).run();assert.equal(await row(a),null);
 });
 console.log(`Capacity store passed (${cases} cases): empty-to-first-write, replay and conflict write nothing, compare-and-set between racing writers, refused operations leave no trace, table checks (revision, version, JSON), per-account isolation and cascade; synthetic terms, local D1, not wired.`);
}finally{await fixture.close();}

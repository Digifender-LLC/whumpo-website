import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSchema} from '../tools/current-schema.mjs';

// WH-043: stale and concurrent writers against the merged src/capacity-store.ts on real databases: two connections to one SQLite file
// (default) or actual local D1 (--d1). Only scheduling is controlled: both writers finish their real read before either real write runs.
// Synthetic terms; no route, invoice, admission, purchased balance or provider is involved.
const bundle=await build({stdin:{contents:"export * from './src/capacity-store';export * from './src/capacity-ledger';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1});
let directory,connections=[],A=fixture.db,B=fixture.db;
if(!d1){
 directory=await mkdtemp(join(tmpdir(),'whumpo-capacity-races-'));
 const open=()=>{const sql=new DatabaseSync(join(directory,'capacity.sqlite'));sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');return sql;};
 const a=open();a.exec('PRAGMA journal_mode=WAL');a.exec(await currentSchema());connections=[a,open()];
 A=sqliteD1Adapter(connections[0]);B=sqliteD1Adapter(connections[1]);
}
const owner=async()=>{const id=crypto.randomUUID();await A.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-11-01')").bind(id,id+'@example.test').run();return id;};
const sum=(xs,f)=>xs.reduce((n,x)=>n+f(x),0);
function conserved(l){
 const rs=Object.values(l.reservations);
 assert.equal(sum(l.lots,x=>x.granted-x.carriedUnits),sum(l.lots,x=>x.remaining+x.expiredUnits)+sum(rs.filter(r=>r.state==='held'),r=>r.units)+sum(rs,r=>r.settledUnits-r.refundedUnits));
 for(const x of l.lots)assert.ok(x.remaining>=0&&x.remaining+x.expiredUnits+x.carriedUnits<=x.granted,`per-lot conservation: ${x.id}`);
 assert.equal(l.terms,'synthetic-proposal');
}
const load=async(user,db=A)=>{const saved=await m.loadLedger(db,user);conserved(saved.ledger);return saved;};
const update=async(user,op,input,db=A)=>{const result=await m.updateLedger(db,user,l=>m[op](l,input));conserved(result.ledger);return result;};
const conflict=e=>e.status===409&&e.code==='revision_conflict';
const code=c=>e=>e.code===c;
// Holds each client's first ledger read until both clients have read, so both act on the same revision.
async function race(user,left,right){
 let arrived=0,release;const ready=new Promise(r=>release=r),revisions=[];
 const client=db=>{let first=true;return {prepare:q=>{const p=db.prepare(q);if(!q.startsWith('SELECT revision,state_json FROM capacity_ledgers'))return p;
  return {bind:(...v)=>{const bound=p.bind(...v);return {first:async()=>{const row=await bound.first();if(first){first=false;revisions.push(row?.revision??0);if(++arrived===2)release();await ready;}return row;}};}};}};};
 const results=await Promise.allSettled([update(user,...left,client(A)),update(user,...right,client(B))]);
 assert.deepEqual(revisions.length,2);assert.equal(revisions[0],revisions[1],'both writers read the same revision');
 const won=results.filter(r=>r.status==='fulfilled'),lost=results.filter(r=>r.status==='rejected');
 assert.equal(won.length,1,'exactly one same-base writer commits');assert.ok(conflict(lost[0].reason),String(lost[0].reason));
 return {winner:results.findIndex(r=>r.status==='fulfilled'),revision:won[0].value.revision};
}
const grant=(id,units,expiresAt)=>['grant',{id,kind:'monthly',periodKey:id,units,at:1,expiresAt}];
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
try{
 await check('the first write of an empty ledger admits one same-base writer; the loser re-reads and both grants persist',async()=>{
  const user=await owner(),{winner}=await race(user,grant('a',10,100),grant('b',20,100));
  assert.equal((await load(user)).ledger.lots.length,1);
  await update(user,...[grant('a',10,100),grant('b',20,100)][1-winner],B);
  const saved=await load(user,B);assert.equal(saved.revision,2);assert.equal(m.capacityView(saved.ledger,2,'complete').availableUnits,30);
 });
 await check('same-base reservations cannot overspend: the stale writer is refused and its retry sees the shortfall',async()=>{
  const user=await owner();await update(user,...grant('m',100,100));
  const {winner}=await race(user,['reserve',{id:'a',units:70,at:2}],['reserve',{id:'b',units:70,at:2}]);
  await assert.rejects(update(user,'reserve',{id:winner?'a':'b',units:70,at:2},B),code('INSUFFICIENT_CAPACITY'));
  const saved=await load(user);assert.equal(saved.revision,2);assert.equal(m.capacityView(saved.ledger,3,'complete').availableUnits,30);
 });
 await check('nonconflicting stale reservations lose no update after the loser retries',async()=>{
  const user=await owner();await update(user,...grant('m',100,100));
  const {winner}=await race(user,['reserve',{id:'a',units:40,at:2}],['reserve',{id:'b',units:50,at:2}]);
  await update(user,'reserve',winner?{id:'a',units:40,at:2}:{id:'b',units:50,at:2},B);
  const saved=await load(user);assert.equal(saved.revision,3);assert.equal(m.capacityView(saved.ledger,3,'complete').availableUnits,10);
 });
 await check('a duplicated settlement commits once; its retry is a replay that writes nothing, a changed body is refused',async()=>{
  const user=await owner();await update(user,...grant('m',100,100));await update(user,'reserve',{id:'r',units:60,at:2});
  const s={id:'r',actualUnits:40,at:3};await race(user,['settle',s],['settle',s]);
  const again=await update(user,'settle',s,B);assert.equal(again.replayed,true);assert.equal(again.revision,3);
  await assert.rejects(update(user,'settle',{...s,actualUnits:41}),code('OP_CONFLICT'));
  assert.equal((await load(user)).revision,3);assert.equal(m.capacityView((await load(user)).ledger,4,'complete').availableUnits,60);
 });
 await check('settle versus release and two refunds of the same units serialize terminal transitions and the refund cap',async()=>{
  const user=await owner();await update(user,...grant('m',100,100));await update(user,'reserve',{id:'t',units:50,at:2});
  const terminal=await race(user,['settle',{id:'t',actualUnits:50,at:3}],['release',{id:'t',at:3}]);
  await assert.rejects(terminal.winner?update(user,'settle',{id:'t',actualUnits:50,at:3},B):update(user,'release',{id:'t',at:3},B),code('ALREADY_SETTLED'));
  await update(user,'reserve',{id:'s',units:30,at:4});await update(user,'settle',{id:'s',actualUnits:30,at:5});
  const refunds=await race(user,['refund',{id:'x',reservationId:'s',units:20,at:6}],['refund',{id:'y',reservationId:'s',units:20,at:6}]);
  await assert.rejects(update(user,'refund',{id:refunds.winner?'x':'y',reservationId:'s',units:20,at:6},B),code('REFUND_EXCEEDS_SETTLEMENT'));
  assert.equal((await load(user)).ledger.reservations.s.refundedUnits,20);
 });
 await check('successive persisted partial refunds return each consumed unit once and never revive an expired lot',async()=>{
  const user=await owner();await update(user,...grant('early',50,10));await update(user,...grant('late',50,100));
  await update(user,'reserve',{id:'both',units:100,at:2});await update(user,'settle',{id:'both',actualUnits:100,at:3});
  for(const [id,units,at,db] of [['one',30,4,A],['two',40,11,B],['three',30,12,A]])await update(user,'refund',{id,reservationId:'both',units,at},db);
  assert.deepEqual((await load(user,B)).ledger.lots.map(x=>[x.id,x.remaining,x.expiredUnits]),[['early',0,50],['late',50,0]]);
 });
 await check('prototype-like reservation IDs survive persistence as own state and an unknown one is refused',async()=>{
  const user=await owner();await update(user,...grant('m',100,100));
  await assert.rejects(update(user,'settle',{id:'toString',actualUnits:1,at:2}),code('UNKNOWN_RESERVATION'));
  for(const id of ['__proto__','constructor']){await update(user,'reserve',{id,units:10,at:2});await update(user,'settle',{id,actualUnits:10,at:3},B);await update(user,'refund',{id:id+'-refund',reservationId:id,units:5,at:4});}
  const saved=await load(user,B);assert.ok(Object.hasOwn(saved.ledger.reservations,'__proto__')&&Object.hasOwn(saved.ledger.reservations,'constructor'));
  assert.equal(saved.ledger.reservations.__proto__.refundedUnits,5);assert.equal(m.capacityView(saved.ledger,5,'complete').availableUnits,90);
 });
 await check('writers for different owners never conflict or attribute across owners',async()=>{
  const a=await owner(),b=await owner();await update(a,...grant('m',100,100));await update(b,...grant('m',100,100));
  await Promise.all([update(a,'reserve',{id:'same',units:40,at:2},A),update(b,'reserve',{id:'same',units:10,at:2},B)]);
  assert.equal((await load(a)).ledger.reservations.same.units,40);assert.equal((await load(b)).ledger.reservations.same.units,10);
 });
 console.log(`Capacity store races passed: ${cases} cases on ${d1?'actual local D1':'file SQLite with two connections'} against src/capacity-store.ts. Synthetic/offline only; no billing, admission, provider, customer balance or cutover.`);
}finally{for(const c of connections)c.close();await fixture.close?.();if(directory)await rm(directory,{recursive:true,force:true});}

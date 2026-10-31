import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSchema} from '../tools/current-schema.mjs';

// WH-197 slice, evidence level SYNTHETIC: the whole purchase journey over the actual current schema, with the in-memory synthetic registrar and a stubbed payment
// (a funding hold row is the whole payment: no Stripe key, SDK, request or sandbox is involved). Two tenants; the failure list of the WH-197 scope (duplicate consent, timeouts before and after the registrar acts, interrupted worker, price change, expiry, foreign owner, cancellation, premium exclusion);
// maintainer inference unavailable (every network call and every AI binding is absent, and a single call fails the test); one server review reader
// (no Chat card or Domains page reads it yet). A stub is not a Stripe sandbox and the synthetic registrar is not a registrar: the connected run with owner-approved sandbox credentials stays
// blocked on WH-197 V1 and A1 (see docs/roadmap/backlog.json).
const bundle=await build({stdin:{contents:"export * from './src/domain-purchase/store';export * from './src/domain-purchase/lifecycle';export * from './src/domain-purchase/order';export * from './src/domain-purchase/quote';export * from './src/domain-purchase/registrar';export {bindings} from './src/chat-interactions/protocol';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1});
let networkCalls=0;const realFetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw new Error('maintainer inference and every provider are unavailable in this journey');};
let directory,files=[],A=fixture.db,B=fixture.db;
if(!d1){
 directory=await mkdtemp(join(tmpdir(),'whumpo-domain-journey-'));
 const open=()=>{const sql=new DatabaseSync(join(directory,'domain.sqlite'));sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');return sql;};
 const first=open();first.exec('PRAGMA journal_mode=WAL');first.exec(await currentSchema());const second=open();files=[first,second];
 A=sqliteD1Adapter(first);B=sqliteD1Adapter(second);
}
const run=(sql,...v)=>A.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await A.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>A.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>Object.values(await one(sql,...v))[0];
const refuse=(p,re)=>assert.rejects(p,re);
let steps=0;const step=async(name,fn)=>{try{await fn();steps++;}catch(e){console.error('FAILED:',name);throw e;}};

const T0=1_800_000_000_000,MINUTE=60000,HOUR=3600000;
const policy={pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium:false};
const tenants={a:{id:'tenant-a',project:'project-a',pm:'pm-a'},b:{id:'tenant-b',project:'project-b',pm:'pm-b'}};
for(const t of Object.values(tenants)){
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-31')",t.id,t.id+'@example.test');
 await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Synthetic','2026-10-31','2026-10-31')",t.project,t.id);
}
const funding=t=>({coverage:null,paymentMethod:{kind:'payment-method',id:tenants[t].pm}});
const actor=t=>({kind:'owner',ownerId:tenants[t].id});
const project=t=>({projectId:tenants[t].project,ownerId:tenants[t].id,revision:1});
const names=Object.fromEntries(['happy-a','happy-b','dup','before','after','crash','price','late','expired','moved','cancel','late-cancel'].map(n=>[n,`synthetic-j-${n}.com`]));
const PREMIUM='synthetic-j-premium.com';
const registrar=m.createSyntheticRegistrar({clock:()=>T0,prices:{...Object.fromEntries(Object.values(names).map(n=>[n,{registration:1200,renewal:1200}])),[PREMIUM]:{registration:45000,renewal:45000,premium:true}}});
let seq=0;const id=p=>`${p}-${String(++seq).padStart(4,'0')}`;
const prepare=(t,hostname,now=T0)=>m.prepareDomainPurchase({actor:actor(t),request:{contractVersion:1,projectId:tenants[t].project,hostname},project:project(t),owner:funding(t),registrar,policy,ids:{quoteId:id('quote'),reviewId:id('review')},now}).then(async p=>{await m.saveReview(A,p.quote,p.review,now);return p;});
const accept=p=>({contractVersion:1,reviewId:p.review.reviewId,quoteDigest:p.review.quoteDigest,consentTextDigest:p.review.consentTextDigest,decision:'accept'});
const consent=(db,t,p,now=T0+1)=>m.consent({db,actor:actor(t),submission:accept(p),reviewId:p.review.reviewId,project:project(t),owner:funding(t),registrar,policy,orderId:id('order'),now});
const dispatch=(db,t,orderId,now=T0+3)=>m.dispatch({db,ownerId:tenants[t].id,orderId,owner:funding(t),project:project(t),registrar,policy,now});
async function toReserved(t,hostname,db=A){const p=await prepare(t,hostname),s=await consent(db,t,p);await m.reserve(db,tenants[t].id,s.order.orderId,T0+2);return {p,orderId:s.order.orderId};}
const state=async orderId=>(await one('SELECT state FROM domain_orders WHERE order_id=?',orderId)).state;
const hold=async orderId=>{const r=await one('SELECT state FROM domain_funding_holds WHERE order_id=?',orderId);return r&&r.state;};

try{
 await step('two tenants buy different names at the same time: one registration, one captured hold each',async()=>{
  const [a,b]=await Promise.all([toReserved('a',names['happy-a'],A),toReserved('b',names['happy-b'],B)]);
  await Promise.all([dispatch(A,'a',a.orderId),dispatch(B,'b',b.orderId)]);
  for(const [o,host] of [[a,names['happy-a']],[b,names['happy-b']]]){assert.equal(await state(o.orderId),'registered');assert.equal(await hold(o.orderId),'captured');assert.equal(registrar.registerLog.filter(h=>h===host).length,1);}
  assert.equal(await count("SELECT count(*) FROM domain_registrations WHERE owner_user_id='tenant-a'"),1);assert.equal(await count("SELECT count(*) FROM domain_registrations WHERE owner_user_id='tenant-b'"),1);
  assert.equal((await one("SELECT auto_renew FROM domain_registrations WHERE hostname=?",names['happy-a'])).auto_renew,0,'a new registration never auto-renews');
 });

 await step('duplicate consent (two tabs, two connections) makes one order and one registration',async()=>{
  const p=await prepare('a',names.dup);const [x,y]=await Promise.all([consent(A,'a',p),consent(B,'a',p)]);
  assert.equal(x.order.orderId,y.order.orderId);await m.reserve(A,tenants.a.id,x.order.orderId,T0+2);
  await Promise.all([dispatch(A,'a',x.order.orderId),dispatch(B,'a',x.order.orderId)]);
  assert.equal(registrar.registerLog.filter(h=>h===names.dup).length,1);assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',names.dup),1);
 });

 await step('timeout before the registrar acted: the hold stays, reads find nothing, the bound ends in unresolved, authenticated evidence frees the name',async()=>{
  const {orderId}=await toReserved('a',names.before);registrar.next('timeout-before');
  assert.equal((await dispatch(A,'a',orderId)).order.state,'unknown-outcome');assert.equal(await hold(orderId),'held');
  await refuse(dispatch(A,'a',orderId),/NO_REDISPATCH/);
  for(let i=0;i<3;i++)await m.reconcileUnknown(A,registrar,T0+(8+7*i)*HOUR);
  assert.equal(await state(orderId),'unresolved');assert.equal(await hold(orderId),'held');
  await refuse(run('DELETE FROM projects WHERE id=?',tenants.a.project),/domain_order_unresolved|domain_registration_active/);
  assert.deepEqual(await m.receiveRegistrarEvent(A,{eventId:'j-evt-1',orderId,attemptId:`${orderId}:a1`,type:'failed',authenticated:true},T0+20),{applied:true});
  assert.equal(await state(orderId),'failed');assert.equal(await hold(orderId),'released');assert.equal(registrar.registerLog.filter(h=>h===names.before).length,1);
 });

 await step('timeout after the registrar acted: reconciliation reads the registration and captures the hold; register ran once',async()=>{
  const {orderId}=await toReserved('b',names.after);registrar.next('timeout-after');
  assert.equal((await dispatch(A,'b',orderId)).order.state,'unknown-outcome');
  assert.equal((await m.reconcileUnknown(A,registrar,T0+7*HOUR)).moved,1);
  assert.equal(await state(orderId),'registered');assert.equal(await hold(orderId),'captured');assert.equal(registrar.registerLog.filter(h=>h===names.after).length,1);
 });

 await step('interrupted worker: the claim stands, the sweep makes it unknown once, no second register',async()=>{
  const {orderId}=await toReserved('a',names.crash);
  const original=registrar.register;registrar.register=()=>new Promise(()=>{});
  dispatch(A,'a',orderId).catch(()=>{});
  for(let i=0;i<1000&&await state(orderId)==="reserved";i++)await new Promise(r=>setTimeout(r,10));// wait for the claim itself (a fixed short wait raced under load)
  registrar.register=original;assert.equal(await state(orderId),'dispatching');
  const swept=await Promise.all([m.sweepLeases(A,T0+3+MINUTE),m.sweepLeases(B,T0+3+MINUTE)]);assert.equal(swept[0].moved+swept[1].moved,1);
  assert.equal(await state(orderId),'unknown-outcome');assert.equal(await hold(orderId),'held');
  await refuse(dispatch(A,'a',orderId,T0+3+MINUTE),/NO_REDISPATCH/);
 });

 await step('price change: refused at consent, cancelled before dispatch with the hold released; expiry: refused at consent and expired when reserved late',async()=>{
  const stale=await prepare('a',names.price);registrar.setPrice(names.price,{registration:1500});
  await refuse(consent(A,'a',stale),/PRICE_CHANGED/);registrar.setPrice(names.price,{registration:1200});
  const {orderId}=await toReserved('a',names.price);registrar.setPrice(names.price,{registration:1500});
  assert.equal((await dispatch(A,'a',orderId)).order.state,'cancelled');assert.equal(await hold(orderId),'released');registrar.setPrice(names.price,{registration:1200});
  const e1=await prepare('b',names.expired);await refuse(consent(A,'b',e1,e1.review.expiresAt+1),/QUOTE_EXPIRED/);
  const late=await prepare('b',names.late),s=await consent(A,'b',late);
  assert.equal((await m.reserve(A,tenants.b.id,s.order.orderId,late.quote.expiresAt+1)).state,'expired');assert.equal(await hold(s.order.orderId),null);
 });

 await step('a project that changed since the review cancels the order before the register call and releases the hold',async()=>{
  const {orderId}=await toReserved('a',names.moved);
  const r=await m.dispatch({db:A,ownerId:tenants.a.id,orderId,owner:funding('a'),project:{...project('a'),revision:2},registrar,policy,now:T0+3});
  assert.equal(r.order.state,'cancelled');assert.equal(registrar.registerLog.includes(names.moved),false);assert.equal(await hold(orderId),'released');
 });

 await step('foreign owner, cancellation and premium: another tenant can neither consent nor cancel, cancel works only before the call, premium is never offered',async()=>{
  const p=await prepare('a',names.cancel);
  await refuse(consent(A,'b',p),/UNKNOWN_REVIEW/);
  const s=await consent(A,'a',p);await refuse(m.cancel(A,actor('b'),s.order.orderId,T0+2),/FOREIGN_OWNER/);
  await m.reserve(A,tenants.a.id,s.order.orderId,T0+2);assert.equal((await m.cancel(A,actor('a'),s.order.orderId,T0+3)).state,'cancelled');assert.equal(await hold(s.order.orderId),'released');
  const {orderId}=await toReserved('b',names['late-cancel']);await dispatch(A,'b',orderId);assert.equal(await state(orderId),'registered');
  await refuse(m.cancel(A,actor('b'),orderId,T0+4),/CANNOT_RECALL/);
  await refuse(prepare('a',PREMIUM),/PREMIUM_NOT_OFFERED/);assert.equal(registrar.registerLog.includes(PREMIUM),false);
 });

 // No Chat card or Domains page reads this yet: this proves the one server reader both are meant to share and the binding registered to it, nothing more.
 await step('one server review reader: the registered binding points at it and two connections read identical output',async()=>{
  const row=await one("SELECT review_id FROM domain_reviews WHERE owner_user_id='tenant-a' LIMIT 1");
  const chat=await m.readDomainReview(A,tenants.a.id,row.review_id,T0+1),domains=await m.readDomainReview(B,tenants.a.id,row.review_id,T0+1);
  assert.deepEqual(chat,domains);assert.equal(await m.readDomainReview(A,tenants.b.id,row.review_id,T0+1),null);
  const binding=m.bindings['domain.purchase-review@1'];assert.deepEqual([binding.mode,binding.handler,binding.source],['read','readDomainReview','src/domain-purchase/store.ts']);
  assert.equal(typeof m.readDomainReview,'function');
 });

 await step('the books balance: one registration per registered order, captured holds only for them, unresolved orders keep theirs, nothing touched the network',async()=>{
  const registered=await all("SELECT order_id,hostname FROM domain_orders WHERE state='registered'");
  for(const o of registered){assert.equal(registrar.registerLog.filter(h=>h===o.hostname).length,1,o.hostname);assert.equal(await count('SELECT count(*) FROM domain_registrations WHERE order_id=?',o.order_id),1);assert.equal(await hold(o.order_id),'captured');}
  assert.equal(await count("SELECT count(*) FROM domain_registrations"),registered.length);
  assert.equal(await count("SELECT count(*) FROM domain_funding_holds WHERE state='captured'"),registered.length);
  for(const o of await all("SELECT order_id FROM domain_orders WHERE state IN ('reserved','dispatching','unknown-outcome','unresolved')"))assert.equal(await hold(o.order_id),'held');
  for(const o of await all("SELECT order_id FROM domain_orders WHERE state IN ('failed','cancelled','expired')"))assert.notEqual(await hold(o.order_id),'held');
  const hostCounts=new Map();for(const h of registrar.registerLog)hostCounts.set(h,(hostCounts.get(h)??0)+1);assert.ok([...hostCounts.values()].every(n=>n===1),'no name was registered twice');
  assert.equal(networkCalls,0,'maintainer inference and every provider stayed unavailable and untouched');
 });
}finally{globalThis.fetch=realFetch;for(const f of files)f.close();if(directory)await rm(directory,{recursive:true,force:true});}
console.log(`Domain purchase journey passed: ${steps} steps on ${d1?'actual local D1':'SQLite'}, SYNTHETIC level (synthetic registrar, stubbed payment, no Stripe, no network). Registrations: ${registrar.registerLog.length} register calls.`);
process.exit(0);

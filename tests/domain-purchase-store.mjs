import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSchema} from '../tools/current-schema.mjs';

// WH-194: domain quotes, reviews, orders, funding holds, attempts, events and registrations over the actual current schema. On SQLite the two
// clients are two real connections to one file; with --d1 they share the actual local D1. D1 cannot read and then branch inside one commit,
// so this proves the guarded single statements and the triggers: concurrent consent, dispatch and sweep never make two orders or two register
// calls, an unknown order keeps its hold and blocks purge, and forged writes are refused. Synthetic registrar and names only: no network,
// registrar, payment provider, Stripe key or real domain.
const bundle=await build({stdin:{contents:"export * from './src/domain-purchase/store';export * from './src/domain-purchase/order';export * from './src/domain-purchase/quote';export * from './src/domain-purchase/registrar';export * from './src/domain-purchase/renewal';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1});
let directory,files=[],A=fixture.db,B=fixture.db;
if(!d1){
 directory=await mkdtemp(join(tmpdir(),'whumpo-domain-store-'));
 const open=()=>{const sql=new DatabaseSync(join(directory,'domain.sqlite'));sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');return sql;};
 const first=open();first.exec('PRAGMA journal_mode=WAL');first.exec(await currentSchema());const second=open();files=[first,second];
 A=sqliteD1Adapter(first);B=sqliteD1Adapter(second);
}
const run=(sql,...v)=>A.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await A.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>A.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>Object.values(await one(sql,...v))[0];
const refuse=(p,re)=>assert.rejects(p,re);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};

const P1='synthetic-p1.com',P2='synthetic-p2.com',P3='synthetic-p3.com',P4='synthetic-p4.com';
const T0=1_800_000_000_000,NAME='synthetic-bakery.com',CAFE='synthetic-cafe.com',SHOP='synthetic-shop.com',PREMIUM='synthetic-premium.com',MINUTE=60000;
const policy={pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium:false};
const owners={a:{id:'owner-a',project:'project-a',pm:'pm-a'},b:{id:'owner-b',project:'project-b',pm:'pm-b'}};
for(const o of Object.values(owners)){
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-31')",o.id,o.id+'@example.test');
 await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Synthetic','2026-10-31','2026-10-31')",o.project,o.id);
}
const fundingOf=o=>({coverage:null,paymentMethod:{kind:'payment-method',id:owners[o].pm}});
const actorOf=o=>({kind:'owner',ownerId:owners[o].id});
const projectOf=(o,revision=1)=>({projectId:owners[o].project,ownerId:owners[o].id,revision});
let seq=0;const id=p=>`${p}-${String(++seq).padStart(4,'0')}`;
const extra=Object.fromEntries(['p1','p2','p3','p4'].map(n=>[`synthetic-${n}.com`,{registration:1500,renewal:1500}]));
function registrar(clock=()=>T0){
 return m.createSyntheticRegistrar({clock,prices:{...extra,[NAME]:{registration:1050,renewal:1150},[CAFE]:{registration:2400,renewal:2400},[SHOP]:{registration:1500,renewal:1500},[PREMIUM]:{registration:45000,renewal:45000,premium:true}}});
}
/** Prepare and persist a quote and its review through the pure module. */
async function prepare(reg,o='a',hostname=NAME,now=T0){
 const prep=await m.prepareDomainPurchase({actor:actorOf(o),request:{contractVersion:1,projectId:owners[o].project,hostname},project:projectOf(o),owner:fundingOf(o),registrar:reg,policy,ids:{quoteId:id('quote'),reviewId:id('review')},now});
 await m.saveReview(A,prep.quote,prep.review,now);return prep;
}
const accept=prep=>({contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept'});
const consent=(db,reg,prep,o='a',now=T0+1,revision=1)=>m.consent({db,actor:actorOf(o),submission:accept(prep),reviewId:prep.review.reviewId,project:projectOf(o,revision),owner:fundingOf(o),registrar:reg,policy,orderId:id('order'),now});
async function reserved(reg,o='a',hostname=NAME,db=A){
 const prep=await prepare(reg,o,hostname),step=await consent(db,reg,prep,o);
 const order=await m.reserve(db,owners[o].id,step.order.orderId,T0+2);assert.equal(order.state,'reserved');return {prep,orderId:order.orderId};
}
const dispatch=(db,reg,orderId,o='a',now=T0+3)=>m.dispatch({db,ownerId:owners[o].id,orderId,owner:fundingOf(o),registrar:reg,policy,now});
const state=async orderId=>(await one('SELECT state FROM domain_orders WHERE order_id=?',orderId)).state;
const hold=async orderId=>{const r=await one('SELECT state,amount_cents,source_id FROM domain_funding_holds WHERE order_id=?',orderId);return r&&{...r};};

try{
 await check('a prepared review round-trips and only its owner can load it; the quote and review are frozen',async()=>{
  const reg=registrar(),prep=await prepare(reg);
  const loaded=await m.loadReview(A,owners.a.id,prep.review.reviewId);
  assert.deepEqual(loaded.review,prep.review);assert.equal(loaded.quote.hostname,NAME);assert.equal(await m.loadReview(A,owners.b.id,prep.review.reviewId),null);
  // Chat and the Domains page read the same server review.
  const view=await m.readDomainReview(A,owners.a.id,prep.review.reviewId,T0+1);
  assert.deepEqual([view.hostname,view.open,view.orderState,view.autoRenew,view.renewalGuaranteed,view.consentText,view.consentTextDigest],[NAME,true,null,false,false,prep.consentText,prep.review.consentTextDigest]);
  assert.equal(await m.readDomainReview(A,owners.b.id,prep.review.reviewId,T0+1),null);assert.equal((await m.readDomainReview(A,owners.a.id,prep.review.reviewId,prep.review.expiresAt)).open,false);
  assert.doesNotMatch(JSON.stringify(view),/auth|secret|token|password/i);
  await refuse(run('UPDATE domain_quotes SET expires_at=expires_at+1 WHERE quote_id=?',prep.quote.quoteId),/domain_quote_frozen/);
  await refuse(run('UPDATE domain_reviews SET hostname=? WHERE review_id=?',CAFE,prep.review.reviewId),/domain_review_frozen/);
 });

 await check('storage repeats the contract: a foreign project, a changed digest, a premium or auto-renew quote and a review past its quote are refused',async()=>{
  const reg=registrar(),prep=await prepare(reg);const q=prep.quote,r=prep.review;
  const insertQuote=(quote,{owner=q.ownerId,project=q.projectId,digest=r.quoteDigest}={})=>run('INSERT INTO domain_quotes(quote_id,owner_user_id,project_id,hostname,quote_json,quote_digest,quoted_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',quote.quoteId,owner,project,quote.hostname,JSON.stringify(quote),digest,quote.quotedAt,quote.expiresAt);
  await refuse(insertQuote({...q,quoteId:id('quote')},{owner:owners.b.id}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),ownerId:owners.b.id},{owner:owners.b.id}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),premium:true}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),autoRenew:true}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),funding:{...q.funding,benefitCents:100}}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),funding:{...q.funding,customerChargeCents:1}}),/domain_quote_scope/);
  await refuse(insertQuote({...q,quoteId:id('quote'),expiresAt:q.quotedAt+MINUTE*60}),/CHECK|domain_quote/);
  const review=(over)=>run('INSERT INTO domain_reviews(review_id,quote_id,quote_digest,owner_user_id,project_id,project_revision,hostname,funding_source_id,consent_text_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
   over.reviewId??id('review'),q.quoteId,over.digest??r.quoteDigest,over.owner??r.ownerId,r.projectId,1,r.hostname,over.source??r.fundingSourceId,r.consentTextDigest,T0,over.expiresAt??T0+MINUTE);
  await refuse(review({digest:'0'.repeat(64)}),/domain_review_scope|UNIQUE/);
  await refuse(review({owner:owners.b.id}),/domain_review_scope|UNIQUE/);
  await refuse(review({source:'pm-other'}),/domain_review_scope|UNIQUE/);
 });

 await check('concurrent identical consents make one order; the loser replays it; a second review of the name is refused',async()=>{
  const reg=registrar(),prep=await prepare(reg);
  const [x,y]=await Promise.all([consent(A,reg,prep),consent(B,reg,prep)]);
  assert.equal(x.order.orderId,y.order.orderId,'both callers hold the same order');assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',NAME),1);
  const replay=await consent(A,reg,prep);assert.equal(replay.replayed,true);assert.equal(replay.order.orderId,x.order.orderId);
  const second=await prepare(reg,'a',NAME,T0+10);
  await refuse(consent(A,reg,second,'a',T0+11),/ORDER_IN_PROGRESS/);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',NAME),1);
  await m.cancel(A,actorOf('a'),x.order.orderId,T0+12);assert.equal(await state(x.order.orderId),'cancelled');
  const third=await consent(A,reg,second,'a',T0+13);assert.equal(third.order.state,'consented','a cancelled order frees the name');
  await m.cancel(A,actorOf('a'),third.order.orderId,T0+14);
 });

 await check('two tenants racing for one name make one order and the loser is refused',async()=>{
  const reg=registrar(),a=await prepare(reg,'a',CAFE),b=await prepare(reg,'b',CAFE);
  const results=await Promise.allSettled([consent(A,reg,a,'a'),consent(B,reg,b,'b')]);
  assert.deepEqual(results.map(r=>r.status).sort(),['fulfilled','rejected']);assert.match(String(results.find(r=>r.status==='rejected').reason.code),/ORDER_IN_PROGRESS|ALREADY_REGISTERED/);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',CAFE),1);
  const winner=results.find(r=>r.status==='fulfilled').value.order;
  await m.cancel(A,{kind:'owner',ownerId:winner.ownerId},winner.orderId,T0+20);
 });

 await check('consent is refused for a foreign owner, a model, a stale project revision, a changed payment method, an expired review and a forged insert',async()=>{
  const reg=registrar(),prep=await prepare(reg,'a',SHOP);
  await refuse(consent(A,reg,prep,'b'),/UNKNOWN_REVIEW/);
  await refuse(m.consent({db:A,actor:{kind:'model',ownerId:owners.a.id},submission:accept(prep),reviewId:prep.review.reviewId,project:projectOf('a'),owner:fundingOf('a'),registrar:reg,policy,orderId:id('order'),now:T0+1}),/MODEL_CANNOT_CONSENT/);
  await refuse(consent(A,reg,prep,'a',T0+1,2),/STALE_REVIEW/);
  await refuse(m.consent({db:A,actor:actorOf('a'),submission:accept(prep),reviewId:prep.review.reviewId,project:projectOf('a'),owner:{coverage:null,paymentMethod:{kind:'payment-method',id:'pm-new'}},registrar:reg,policy,orderId:id('order'),now:T0+1}),/FUNDING_CHANGED/);
  await refuse(consent(A,reg,prep,'a',prep.review.expiresAt+1),/QUOTE_EXPIRED/);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',SHOP),0);
  // Skipping the module: the statement's own binds and triggers still refuse.
  const raw=(over={})=>{const v={order:id('order'),key:'a'.repeat(64),review:prep.review.reviewId,quote:prep.quote.quoteId,digest:prep.review.quoteDigest,owner:owners.a.id,project:owners.a.project,host:SHOP,at:T0+1,state:'consented',history:'["quoted","consented"]',...over};
   return run('INSERT INTO domain_orders(order_id,idempotency_key,review_id,quote_id,quote_digest,owner_user_id,project_id,hostname,state,history_json,consented_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',v.order,v.key,v.review,v.quote,v.digest,v.owner,v.project,v.host,v.state,v.history,v.at,v.at);};
  await refuse(raw({owner:owners.b.id}),/domain_order_scope/);await refuse(raw({host:CAFE}),/domain_order_scope/);await refuse(raw({digest:'1'.repeat(64)}),/domain_order_scope/);
  await refuse(raw({at:prep.review.expiresAt}),/domain_order_scope/);await refuse(raw({state:'reserved'}),/domain_order_state|CHECK/);await refuse(raw({history:'["quoted","consented","registered"]'}),/domain_order_state/);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE hostname=?',SHOP),0);
 });

 await check('reserve places one hold for exactly the consented charge; forged and backward transitions are refused',async()=>{
  const reg=registrar(),prep=await prepare(reg,'a',SHOP),step=await consent(A,reg,prep,'a');
  assert.equal(await hold(step.order.orderId),null);
  const [r1,r2]=await Promise.all([m.reserve(A,owners.a.id,step.order.orderId,T0+2),m.reserve(B,owners.a.id,step.order.orderId,T0+2)]);
  assert.equal(r1.state,'reserved');assert.equal(r2.state,'reserved');
  assert.deepEqual(await hold(step.order.orderId),{state:'held',amount_cents:prep.quote.funding.customerChargeCents,source_id:prep.quote.funding.sourceId});assert.equal(await count('SELECT count(*) FROM domain_funding_holds WHERE order_id=?',step.order.orderId),1);
  const set=(sql,...v)=>run(`UPDATE domain_orders SET ${sql} WHERE order_id=?`,...v,step.order.orderId);
  await refuse(set("state='registered',attempt_id='x:a1',version=version+1"),/domain_order_transition/);
  await refuse(set("state='consented',version=version+1"),/domain_order_transition/);
  await refuse(set("state='dispatching',attempts=1,attempt_id='wrong',attempt_started_at=5,version=version+1"),/domain_order_dispatch/);
  await refuse(set("state='cancelled'"),/domain_order_version/);
  await refuse(set("hostname='other.com',version=version+1"),/domain_order_identity/);
  await refuse(run("UPDATE domain_funding_holds SET state='captured',settled_at=5 WHERE order_id=?",step.order.orderId),/domain_hold_settle/);
  await refuse(run("UPDATE domain_funding_holds SET state='released',settled_at=5 WHERE order_id=?",step.order.orderId),/domain_hold_settle/);
  await refuse(run("INSERT INTO domain_funding_holds(order_id,source_id,amount_cents,state,placed_at) VALUES(?,?,1,'held',5)",id('order'),'pm-a'),/FOREIGN KEY|domain_hold_admit/);
  await refuse(run('DELETE FROM domain_orders WHERE order_id=?',step.order.orderId),/domain_order_unresolved/);
  const cancelled=await m.cancel(A,actorOf('a'),step.order.orderId,T0+3);assert.equal(cancelled.state,'cancelled');
  assert.equal((await hold(step.order.orderId)).state,'released','cancel releases the hold in the same statement');
  await refuse(m.cancel(A,actorOf('a'),step.order.orderId,T0+4),/CANNOT_RECALL/);
  await refuse(set("state='reserved',version=version+1"),/domain_order_final/);
 });

 await check('concurrent dispatches and sweeps make exactly one register call, one registration and one captured hold',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',NAME);
  const results=await Promise.all([dispatch(A,reg,orderId),dispatch(B,reg,orderId),dispatch(A,reg,orderId),dispatch(B,reg,orderId),m.sweepLeases(B,T0+3)]);
  assert.equal(reg.calls.register,1,'one registrar purchase call');assert.deepEqual(reg.registerLog,[NAME]);
  assert.equal(results.slice(0,4).filter(r=>r.claimed).length,1);assert.equal(await state(orderId),'registered');
  assert.equal(await count('SELECT count(*) FROM domain_order_attempts WHERE order_id=?',orderId),1);
  assert.equal((await hold(orderId)).state,'captured');
  const registration=await one('SELECT * FROM domain_registrations WHERE order_id=?',orderId);
  assert.equal(registration.hostname,NAME);assert.equal(registration.auto_renew,0);assert.equal(registration.state,'active');assert.equal(registration.charge_mismatch,0);assert.ok(registration.expires_at>T0);
  await dispatch(A,reg,orderId);assert.equal(reg.calls.register,1,'a later dispatch never registers again');
  await refuse(run('UPDATE domain_order_attempts SET order_id=? WHERE order_id=?',id('order'),orderId),/domain_attempt_frozen/);
  await refuse(run("INSERT INTO domain_order_attempts(attempt_id,order_id,started_at) VALUES('again',?,5)",orderId),/UNIQUE/);
  const fresh=registrar(),other=await prepare(fresh,'b',NAME,T0+30);await refuse(consent(A,fresh,other,'b',T0+31),/ALREADY_REGISTERED/);
 });

 await check('an order owner can read only their own orders',async()=>{
  const row=await one("SELECT order_id FROM domain_orders WHERE state='registered' LIMIT 1");
  assert.ok(await m.loadOrder(A,owners.a.id,row.order_id));assert.equal(await m.loadOrder(A,owners.b.id,row.order_id),null);
 });

 await check('a lost response after the registrar acted keeps the hold, blocks purge, and reconciliation finds the registration',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'b',CAFE);reg.next('timeout-after');
  const r=await dispatch(A,reg,orderId,'b');assert.equal(r.order.state,'unknown-outcome');assert.equal(reg.calls.register,1);
  assert.equal((await hold(orderId)).state,'held');
  await refuse(run('DELETE FROM projects WHERE id=?',owners.b.project),/domain_order_unresolved/);await refuse(run('DELETE FROM users WHERE id=?',owners.b.id),/domain_order_unresolved/);
  await refuse(dispatch(A,reg,orderId,'b'),/NO_REDISPATCH/);assert.equal(reg.calls.register,1);
  const done=await m.reconcileUnknown(A,reg,T0+10);assert.equal(done.moved,1);
  assert.equal(await state(orderId),'registered');assert.equal((await hold(orderId)).state,'captured');assert.equal(reg.calls.register,1,'reconciliation is read-only');
 });

 await check('a definite refusal fails the order and releases the hold; a pending workflow waits for evidence',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',SHOP);reg.next('rejected');
  const r=await dispatch(A,reg,orderId);assert.equal(r.order.state,'failed');assert.equal((await hold(orderId)).state,'released');assert.equal(await count('SELECT count(*) FROM domain_registrations WHERE hostname=?',SHOP),0);
  const again=await reserved(reg,'a',SHOP);reg.next('pending');
  assert.equal((await dispatch(A,reg,again.orderId)).order.state,'unknown-outcome');
  reg.finishPending(SHOP,false);assert.equal((await m.reconcileUnknown(A,reg,T0+10)).moved,1);assert.equal(await state(again.orderId),'failed');assert.equal((await hold(again.orderId)).state,'released');
 });

 await check('a worker that dies after the claim is swept to unknown-outcome once; no redispatch follows',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',SHOP);
  reg.register=()=>new Promise(()=>{});// the worker never comes back
  dispatch(A,reg,orderId).catch(()=>{});
  for(let i=0;i<1000&&await state(orderId)==="reserved";i++)await new Promise(r=>setTimeout(r,10));// wait for the claim itself (a fixed short wait raced under load)
  assert.equal(await state(orderId),'dispatching');assert.equal(await count('SELECT count(*) FROM domain_order_attempts WHERE order_id=?',orderId),1);
  assert.equal((await m.sweepLeases(A,T0+3+MINUTE-1)).moved,0,'inside the lease');
  const swept=await Promise.all([m.sweepLeases(A,T0+3+MINUTE),m.sweepLeases(B,T0+3+MINUTE)]);
  assert.equal(swept[0].moved+swept[1].moved,1,'exactly one sweep moves it');assert.equal(await state(orderId),'unknown-outcome');
  assert.equal((await hold(orderId)).state,'held');
  // Three read-only lookups that find nothing end in unresolved, which still holds the funds and blocks purge.
  const quiet=registrar();for(let i=0;i<3;i++)await m.reconcileUnknown(A,quiet,T0+MINUTE*5+i);
  assert.equal(await state(orderId),'unresolved');assert.equal((await hold(orderId)).state,'held');assert.equal(quiet.calls.register,0);
  await refuse(run('DELETE FROM users WHERE id=?',owners.a.id),/domain_order_unresolved|domain_registration_active/);
  // Only authenticated evidence ends it; a duplicate, a stale attempt and an unauthenticated event do nothing more.
  const event={eventId:'evt-1',orderId,attemptId:`${orderId}:a1`,type:'failed',authenticated:true};
  const [e1,e2]=await Promise.all([m.receiveRegistrarEvent(A,event,T0+MINUTE*6),m.receiveRegistrarEvent(B,event,T0+MINUTE*6)]);
  assert.equal([e1,e2].filter(e=>e.applied).length,1,'applied once');assert.equal(await state(orderId),'failed');assert.equal((await hold(orderId)).state,'released');
  assert.deepEqual(await m.receiveRegistrarEvent(A,event,T0+MINUTE*7),{applied:false,duplicate:true});
  await refuse(m.receiveRegistrarEvent(A,{...event,eventId:'evt-2',authenticated:false},T0),/EVENT_NOT_AUTHENTICATED/);
  assert.deepEqual(await m.receiveRegistrarEvent(A,{...event,eventId:'evt-3',attemptId:'old:a0',type:'registered'},T0+MINUTE*7),{applied:false,stale:true});
  assert.equal(await state(orderId),'failed');assert.equal(await count('SELECT count(*) FROM domain_registrar_events WHERE order_id=?',orderId),2);
 });

 await check('a late failure never undoes a registration; an authenticated registered event completes an unresolved order',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',SHOP);reg.next('timeout-before');
  assert.equal((await dispatch(A,reg,orderId)).order.state,'unknown-outcome');
  const e={eventId:'evt-10',orderId,attemptId:`${orderId}:a1`,type:'registered',authenticated:true,expiresAt:T0+365*86400000};
  assert.deepEqual(await m.receiveRegistrarEvent(A,e,T0+10),{applied:true});assert.equal(await state(orderId),'registered');assert.equal((await hold(orderId)).state,'captured');
  assert.equal((await one('SELECT expires_at,auto_renew FROM domain_registrations WHERE order_id=?',orderId)).auto_renew,0);
  assert.deepEqual(await m.receiveRegistrarEvent(A,{...e,eventId:'evt-11',type:'failed'},T0+11),{applied:false,ignored:true});assert.equal(await state(orderId),'registered');
 });

 await check('a price change before dispatch cancels the order and releases the hold without calling register; an expired quote expires it',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',P1);reg.setPrice(P1,{registration:1600});
  const r=await dispatch(A,reg,orderId);assert.equal(r.order.state,'cancelled');assert.equal(reg.calls.register,0);assert.equal((await hold(orderId)).state,'released');
  const late=await prepare(reg,'a',P1,T0+100),step=await consent(A,reg,late,'a',T0+101);
  const stale=await m.reserve(A,owners.a.id,step.order.orderId,late.quote.expiresAt+1);assert.equal(stale.state,'expired');assert.equal(await hold(step.order.orderId),null);
  const placed=await prepare(reg,'a',P1,T0+200),s2=await consent(A,reg,placed,'a',T0+201);await m.reserve(A,owners.a.id,s2.order.orderId,T0+202);
  const e=await dispatch(A,reg,s2.order.orderId,'a',placed.quote.expiresAt+1);assert.equal(e.order.state,'expired');assert.equal(reg.calls.register,0);assert.equal((await hold(s2.order.orderId)).state,'released');
 });

 await check('registrant contact: owner-only, required fields, before consent, not exposed, removed with an unused draft',async()=>{
  const reg=registrar(),prep=await prepare(reg,'a',P2,T0+300);
  const contact={name:'Synthetic Owner',street:'1 Test Street',city:'Testville',country:'US',phone:'+1.5550100',email:'owner@example.test',region:'TS',postalCode:'00000'};
  await refuse(m.saveRegistrantContact(A,{kind:'model',ownerId:owners.a.id},prep.review.reviewId,contact,T0+301),/HUMAN_REVIEW_REQUIRED/);
  await refuse(m.saveRegistrantContact(A,actorOf('b'),prep.review.reviewId,contact,T0+301),/INVALID_CONTACT/);
  await refuse(m.saveRegistrantContact(A,actorOf('a'),prep.review.reviewId,{...contact,authCode:'x'},T0+301),/UNKNOWN_FIELD/);
  await refuse(m.saveRegistrantContact(A,actorOf('a'),prep.review.reviewId,{...contact,country:'usa'},T0+301),/INVALID_CONTACT/);
  await m.saveRegistrantContact(A,actorOf('a'),prep.review.reviewId,contact,T0+301);
  await refuse(m.saveRegistrantContact(A,actorOf('a'),prep.review.reviewId,contact,T0+302),/INVALID_CONTACT/);
  await refuse(run('UPDATE domain_registrant_contacts SET city=? WHERE review_id=?','Elsewhere',prep.review.reviewId),/domain_contact_frozen/);
  // No column of any domain table can hold an auth code, registrar credential or card number.
  for(const t of ['domain_quotes','domain_reviews','domain_orders','domain_funding_holds','domain_order_attempts','domain_registrar_events','domain_registrations','domain_registrant_contacts'])
   assert.deepEqual((await all(`SELECT name FROM pragma_table_info('${t}')`)).map(r=>r.name).filter(n=>/auth|epp|secret|token|password|card|credential/i.test(n)),[],t);
  assert.deepEqual(await m.pruneDomainDrafts(A,prep.quote.expiresAt+1,100),{quotes:0},'inside the retention window');
  const later=prep.quote.expiresAt+m.domainDraftRetentionMs;
  const used=await prepare(reg,'a',P3,T0+300),usedStep=await consent(A,reg,used,'a',T0+301);
  const pruned=await m.pruneDomainDrafts(A,later,100);assert.ok(pruned.quotes>=1);
  assert.equal(await count('SELECT count(*) FROM domain_reviews WHERE review_id=?',prep.review.reviewId),0);assert.equal(await count('SELECT count(*) FROM domain_registrant_contacts WHERE review_id=?',prep.review.reviewId),0);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE order_id=?',usedStep.order.orderId),1,'an ordered quote is never pruned');
  await m.cancel(A,actorOf('a'),usedStep.order.orderId,T0+302);
 });

 await check('an active registration blocks project and account purge until it is transferred out; a settled order does not',async()=>{
  const reg=registrar(),{orderId}=await reserved(reg,'a',P4);await dispatch(A,reg,orderId);assert.equal(await state(orderId),'registered');
  await refuse(run('DELETE FROM projects WHERE id=?',owners.a.project),/domain_registration_active/);await refuse(run('DELETE FROM users WHERE id=?',owners.a.id),/domain_registration_active/);
  await refuse(run("UPDATE domain_registrations SET auto_renew=1 WHERE order_id=?",orderId),/CHECK|domain_registration_renewal/);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE order_id=?',orderId),1);
  await run("UPDATE domain_registrations SET state='transferred-out' WHERE order_id=?",orderId);
  await refuse(run("UPDATE domain_registrations SET state='active' WHERE order_id=?",orderId),/domain_registration_final/);
  for(const r of await all("SELECT order_id FROM domain_registrations WHERE owner_user_id=? AND state='active'",owners.a.id))await run("UPDATE domain_registrations SET state='transferred-out' WHERE order_id=?",r.order_id);
  await run('DELETE FROM users WHERE id=?',owners.a.id);
  assert.equal(await count('SELECT count(*) FROM domain_orders WHERE owner_user_id=?',owners.a.id),0);assert.equal(await count('SELECT count(*) FROM domain_quotes WHERE owner_user_id=?',owners.a.id),0);
 });
}catch(error){throw error;}
finally{for(const f of files)f.close();if(directory)await rm(directory,{recursive:true,force:true});}
console.log(`Domain purchase store passed: ${cases} cases on ${d1?'actual local D1':'SQLite'}.`);
process.exit(0);

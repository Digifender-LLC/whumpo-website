import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// WH-034 / WH-193 domain purchase conformance harness, run against the source module src/domain-purchase/*.ts.
// Synthetic registrar, names, prices and identifiers only: no database, network, credential, payment, registrar
// account or model. The in-memory driver below only stores the plain records the source steps return; every decision
// is made by the source. It proves the contract's quote, consent and order rules, not D1 atomicity, payment holds, a
// real registrar adapter or any purchase (WH-194 to WH-197). Every suite check also runs against deliberately broken
// copies of the source (mutants below), each of which must be caught by the check written for that property.
const root=fileURLToPath(new URL('..',import.meta.url));
const moduleFiles=['src/domain-purchase/quote.ts','src/domain-purchase/order.ts','src/domain-purchase/registrar.ts','src/domain-purchase/renewal.ts'];
const entry=moduleFiles.map(f=>`export * from './${f.replace(/\.ts$/,'')}';`).join('')+"export {domainBenefit,quoteDomainBenefit} from './src/plans';";
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const OWNER={kind:'owner',ownerId:'owner-a'},OWNER_B={kind:'owner',ownerId:'owner-b'},MODEL={kind:'model',ownerId:'owner-a'};
const NAME='synthetic-bakery.com',PREMIUM='synthetic-premium.com',CAFE='synthetic-cafe.com';
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const DAY=86400000;
class Interrupted extends Error {}

/** Test driver: holds plain records in memory and applies the steps returned by the source. No decision logic. */
function createRuntime(m,{registrar,policy,time}){
 const s={owners:{},projects:{},quotes:{},reviews:{},orders:{},holds:{},registrations:{},renewalReviews:{},events:new Set(),seq:0};
 const nextId=prefix=>`${prefix}-${String(++s.seq).padStart(4,'0')}`;
 const clone=v=>v===undefined?undefined:structuredClone(v);
 const project=id=>s.projects[id]&&{projectId:id,...s.projects[id]};
 function apply(step){
  const id=step.order.orderId;s.orders[id]=step.order;
  if(step.hold?.kind==='place')s.holds[id]=step.hold.hold;else if(step.hold)s.holds[id]=m.settleHold(s.holds[id],step.hold.kind);
  if(step.registration)s.registrations[step.registration.hostname]=step.registration;
  return clone(step.order);
 }
 return {
  get now(){return time.now;},
  advance(ms){time.now+=ms;},
  addOwner(ownerId,{coverage=null,paymentMethod=null}={}){s.owners[ownerId]={coverage,paymentMethod};},
  setPaymentMethod(ownerId,paymentMethod){s.owners[ownerId].paymentMethod=paymentMethod??null;},
  addProject(projectId,ownerId){s.projects[projectId]={ownerId,revision:1};},
  transferProject(projectId,ownerId){s.projects[projectId]={ownerId,revision:s.projects[projectId].revision+1};},
  async prepare(actor,request){
   const r=await m.prepareDomainPurchase({actor,request,project:project(request?.projectId),owner:s.owners[actor?.ownerId],registrar,policy,ids:{quoteId:nextId('quote'),reviewId:nextId('review')},now:time.now});
   s.quotes[r.quote.quoteId]=r.quote;s.reviews[r.review.reviewId]=r.review;return clone(r);
  },
  async consent(actor,submission){
   const review=s.reviews[submission?.reviewId];
   return apply(await m.consentToOrder({actor,submission,review,quote:review&&s.quotes[review.quoteId],project:review&&project(review.projectId),owner:review&&s.owners[review.ownerId],
    related:Object.values(s.orders),registrar,policy,orderId:nextId('order'),now:time.now}));
  },
  reserve(orderId){const o=s.orders[orderId];return apply(m.reserveOrder({order:o,quote:s.quotes[o.quoteId],now:time.now}));},
  /** `interrupt` simulates a worker stopping right after the claim commits. */
  async dispatch(orderId,{interrupt=false}={}){
   const o=s.orders[orderId];
   const claim=claimed=>{if(s.orders[orderId].state!=='reserved')return false;s.orders[orderId]=claimed;if(interrupt)throw new Interrupted();return true;};
   try{return apply(await m.dispatchOrder({order:o,quote:s.quotes[o.quoteId],owner:s.owners[o.ownerId],registrar,policy,now:time.now,claim}));}
   catch(error){if(error instanceof Interrupted)return clone(s.orders[orderId]);throw error;}
  },
  sweep(){for(const o of Object.values(s.orders))apply(m.expireDispatchLease({order:o,now:time.now}));},
  async reconcile(orderId){return apply(await m.reconcileOrder({order:s.orders[orderId],registrar,now:time.now}));},
  applyRegistrarEvent(event){
   const r=m.applyRegistrarEvent({order:s.orders[event.orderId],event,seen:s.events.has(event.eventId),now:time.now});
   s.events.add(event.eventId);if(r.step)apply(r.step);return r.outcome;
  },
  cancel(actor,orderId){return apply(m.cancelOrder({actor,order:s.orders[orderId]}));},
  async prepareAutoRenew(actor,hostname){
   const r=await m.prepareAutoRenew({actor,registration:s.registrations[hostname],registrar,policy,reviewId:nextId('renewal'),now:time.now});
   s.renewalReviews[r.review.reviewId]=r.review;return clone(r);
  },
  async confirmAutoRenew(actor,submission){
   const review=s.renewalReviews[submission?.reviewId];
   const r=await m.confirmAutoRenew({actor,submission,review,registration:review&&s.registrations[review.hostname],registrar,policy,now:time.now});
   s.registrations[r.hostname]=r;return clone(r);
  },
  async renewalDecision(hostname){const r=await m.renewalDecision({registration:s.registrations[hostname],registrar,policy});s.registrations[hostname]=r.registration;return r.decision;},
  requestTransferOut(actor,hostname){const r=m.requestTransferOut({actor,registration:s.registrations[hostname],now:time.now});s.registrations[hostname]=r.registration;return r.result;},
  order:id=>clone(s.orders[id]),
  orders:()=>Object.keys(s.orders),
  hold:id=>clone(s.holds[id]),
  registration:name=>clone(s.registrations[name]),
 };
}

async function suite(m){
 let count=0;
 const bounds=m.domainPurchaseBounds;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
 function setup({allowPremium=false,coverage={planId:'personal',interval:'year'}}={}){
  const time={now:1_000_000};
  const reg=m.createSyntheticRegistrar({clock:()=>time.now,prices:{[NAME]:{registration:1050,renewal:1150},[CAFE]:{registration:2400,renewal:2400},[PREMIUM]:{registration:45000,renewal:45000,premium:true}}});
  const rt=createRuntime(m,{registrar:reg,policy:{pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium},time});
  rt.addOwner('owner-a',{coverage,paymentMethod:{kind:'payment-method',id:'pm-a'}});
  rt.addOwner('owner-b',{coverage,paymentMethod:{kind:'payment-method',id:'pm-b'}});
  rt.addProject('project-a','owner-a');rt.addProject('project-b','owner-b');
  return {rt,reg};
 }
 const req=(o={})=>({contractVersion:1,projectId:'project-a',hostname:NAME,...o});
 const accept=(prep,o={})=>({contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept',...o});
 async function reserved(rt,hostname=NAME,actor=OWNER,projectId='project-a'){
  const prep=await rt.prepare(actor,req({hostname,projectId}));const order=await rt.consent(actor,accept(prep));rt.reserve(order.orderId);return {prep,orderId:order.orderId};
 }
 async function registered(rt){const {orderId}=await reserved(rt);await rt.dispatch(orderId);assert.equal(rt.order(orderId).state,'registered');return orderId;}

 await test('frozen vocabularies and transitions',()=>{
  for(const s of ['quoted','consented','reserved','dispatching','registered','failed','unknown-outcome','unresolved','cancelled','expired'])assert.ok(m.orderStates.includes(s),s);
  assert.deepEqual(Object.keys(m.transitions).sort(),[...m.orderStates].sort());
  for(const [from,to] of Object.entries(m.transitions))for(const t of to)assert.ok(m.orderStates.includes(t),`${from}->${t}`);
  for(const s of ['unknown-outcome','unresolved'])for(const back of ['quoted','consented','reserved','dispatching'])assert.ok(!m.transitions[s].includes(back),`${s} cannot return to ${back}`);
  for(const s of ['registered','failed','cancelled','expired'])assert.deepEqual(m.transitions[s],[]);
  assert.equal(m.contractVersion,1);assert.equal(bounds.quoteTtlMs,15*60000);assert.equal(bounds.reviewTtlMs,10*60000);assert.equal(bounds.leaseMs,60000);
  assert.equal(bounds.reconcileReads,3);assert.equal(bounds.reconcileWindowMs,72*3600000);
 });

 await test('unknown or stale contract versions are rejected',async()=>{
  const {rt}=setup();
  for(const v of [0,2,'1',undefined,null])await rejects(()=>m.validateQuoteRequest(req({contractVersion:v})),'UNSUPPORTED_VERSION');
  const {contractVersion:_,...missing}=req();await rejects(()=>m.validateQuoteRequest(missing),'UNSUPPORTED_VERSION');
  await rejects(()=>rt.prepare(OWNER,req({contractVersion:2})),'UNSUPPORTED_VERSION');
  await rejects(()=>m.validateQuoteRequest(req({note:'hello'})),'UNKNOWN_FIELD');
  const prep=await rt.prepare(OWNER,req());
  await rejects(()=>m.validateQuote({...prep.quote,contractVersion:2}),'UNSUPPORTED_VERSION');
  await rejects(()=>m.validateQuote({...prep.quote,legacyPrice:1}),'UNKNOWN_FIELD');
  await rejects(()=>rt.consent(OWNER,accept(prep,{contractVersion:0})),'UNSUPPORTED_VERSION');
  await rejects(()=>rt.consent(OWNER,accept(prep,{decision:'maybe'})),'INVALID_DECISION');
  assert.equal(rt.orders().length,0);
  assert.deepEqual(Object.keys(m).filter(k=>/legacy|v0|migrat|upgrade|decodeOld|reviewDomainPurchaseQuote|matchesDomainPurchaseReview/i.test(k)),[]);
 });

 await test('clients and models cannot set price, funding or authority',async()=>{
  const {rt,reg}=setup();
  for(const extra of [{priceCents:1},{total_cents:1},{funding:{payer:'platform'}},{fundingSourceId:'pm-x'},{paymentMethod:'pm-x'},{benefitCents:2000},{premium:false},{acknowledgePremium:true},{autoRenew:true},{auto_renew:true},{approved:true},{decision:'accept'},{reviewId:'review-0001'},{quote:{}},{currency:'EUR'},{taxStatus:'computed'},{nested:{'retail-cents':1}},{list:[{coupon:'FREE'}]}])
   for(const actor of [OWNER,MODEL])await rejects(()=>rt.prepare(actor,req(extra)),'CLIENT_AUTHORITY');
  const prep=await rt.prepare(MODEL,req());
  assert.equal(prep.quote.initial.wholesaleCents,1050);assert.equal(prep.quote.initial.totalCents,1050+30+86);
  assert.equal(prep.quote.funding.sourceId,'pm-a');assert.equal(reg.calls.register,0);
  await rejects(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,payer:'platform'}}),'INVALID_FUNDING');
  for(const extra of [{priceCents:1},{autoRenew:true},{approved:true},{fundingSourceId:'pm-x'}])await rejects(()=>rt.consent(OWNER,accept(prep,extra)),'UNKNOWN_FIELD');
  assert.equal(rt.orders().length,0);
 });

 await test('only the human owner can consent',async()=>{
  const {rt,reg}=setup();const prep=await rt.prepare(MODEL,req());
  await rejects(()=>rt.consent(MODEL,accept(prep)),'MODEL_CANNOT_CONSENT');
  await rejects(()=>rt.consent({kind:'visitor',ownerId:'owner-a'},accept(prep)),'HUMAN_REVIEW_REQUIRED');
  await rejects(()=>rt.consent({kind:'service',ownerId:'owner-a'},accept(prep)),'HUMAN_REVIEW_REQUIRED');
  assert.equal(rt.orders().length,0);assert.equal(reg.calls.register,0);
  assert.equal((await rt.consent(OWNER,accept(prep))).state,'consented');
 });

 await test('consent binds the exact consent text digest',async()=>{
  const {rt}=setup();const prep=await rt.prepare(OWNER,req());
  assert.equal(prep.review.consentTextDigest,sha(prep.consentText));
  assert.equal(m.consentText(prep.quote),prep.consentText);
  for(const phrase of ['$11.66','Auto-renew is off','not applied','cannot be refunded','synthetic-registrar'])assert.ok(prep.consentText.includes(phrase),phrase);
  await rejects(()=>rt.consent(OWNER,accept(prep,{consentTextDigest:sha(prep.consentText+' ')})),'CONSENT_MISMATCH');
  await rejects(()=>rt.consent(OWNER,accept(prep,{quoteDigest:'0'.repeat(64)})),'REVIEW_MISMATCH');
  assert.equal(rt.orders().length,0);
  assert.equal((await rt.consent(OWNER,accept(prep))).state,'consented');
 });

 await test('an expired quote requires a new review',async()=>{
  let {rt,reg}=setup();let prep=await rt.prepare(OWNER,req());
  rt.advance(bounds.reviewTtlMs);await rejects(()=>rt.consent(OWNER,accept(prep)),'QUOTE_EXPIRED');
  prep=await rt.prepare(OWNER,req());assert.equal((await rt.consent(OWNER,accept(prep))).state,'consented');
  ({rt,reg}=setup());prep=await rt.prepare(OWNER,req());const order=await rt.consent(OWNER,accept(prep));
  rt.advance(bounds.quoteTtlMs);assert.equal(rt.reserve(order.orderId).state,'expired');assert.equal(rt.hold(order.orderId),undefined);
  ({rt,reg}=setup());const {orderId}=await reserved(rt);rt.advance(bounds.quoteTtlMs);
  assert.equal((await rt.dispatch(orderId)).state,'expired');assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,0);
 });

 await test('a changed price requires a new review',async()=>{
  let {rt,reg}=setup();let prep=await rt.prepare(OWNER,req());
  reg.setPrice(NAME,{registration:1100});await rejects(()=>rt.consent(OWNER,accept(prep)),'PRICE_CHANGED');
  const fresh=await rt.prepare(OWNER,req());assert.notEqual(fresh.review.quoteDigest,prep.review.quoteDigest);
  assert.equal((await rt.consent(OWNER,accept(fresh))).state,'consented');
  ({rt,reg}=setup());prep=await rt.prepare(OWNER,req());reg.setPrice(NAME,{renewal:1300});await rejects(()=>rt.consent(OWNER,accept(prep)),'PRICE_CHANGED');
  ({rt,reg}=setup());const {orderId}=await reserved(rt);reg.setPrice(NAME,{registration:900});
  const o=await rt.dispatch(orderId);assert.equal(o.state,'cancelled');assert.ok(o.history.includes('cancelled:price-changed'));
  assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,0);
 });

 await test('stale or foreign authority is refused',async()=>{
  let {rt}=setup();let prep=await rt.prepare(OWNER,req());
  await rejects(()=>rt.consent(OWNER_B,accept(prep)),'FOREIGN_OWNER');
  await rejects(()=>rt.prepare(OWNER_B,req()),'FOREIGN_OWNER');
  await rejects(()=>rt.prepare({kind:'owner',ownerId:'owner-b'},req({projectId:'project-missing'})),'FOREIGN_OWNER');
  rt.transferProject('project-a','owner-b');await rejects(()=>rt.consent(OWNER,accept(prep)),'STALE_REVIEW');
  ({rt}=setup());prep=await rt.prepare(OWNER,req());rt.setPaymentMethod('owner-a',{kind:'payment-method',id:'pm-a2'});await rejects(()=>rt.consent(OWNER,accept(prep)),'FUNDING_CHANGED');
  ({rt}=setup());const {orderId}=await reserved(rt);await rejects(()=>rt.cancel(OWNER_B,orderId),'FOREIGN_OWNER');
  assert.equal(rt.order(orderId).state,'reserved');
 });

 await test('the happy path registers once and captures the hold',async()=>{
  const {rt,reg}=setup();const {orderId}=await reserved(rt);
  assert.deepEqual(rt.hold(orderId),{orderId,sourceId:'pm-a',amountCents:1166,state:'held'});
  const o=await rt.dispatch(orderId);assert.equal(o.state,'registered');assert.deepEqual(o.history,['quoted','consented','reserved','dispatching','registered']);
  assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
  const r=rt.registration(NAME);assert.equal(r.ownerId,'owner-a');assert.equal(r.projectId,'project-a');assert.equal(r.chargeMismatch,false);
 });

 await test('duplicate consent and dispatch never create a second purchase',async()=>{
  const {rt,reg}=setup();const prep=await rt.prepare(OWNER,req());
  const a=await rt.consent(OWNER,accept(prep)),b=await rt.consent(OWNER,accept(prep));
  assert.equal(a.orderId,b.orderId);assert.equal(rt.orders().length,1);
  rt.reserve(a.orderId);rt.reserve(a.orderId);assert.equal(rt.hold(a.orderId).amountCents,1166);
  const second=await rt.prepare(OWNER,req());await rejects(()=>rt.consent(OWNER,accept(second)),'ORDER_IN_PROGRESS');
  rt.addProject('project-b2','owner-b');const other=await rt.prepare(OWNER_B,req({projectId:'project-b2'}));await rejects(()=>rt.consent(OWNER_B,accept(other)),'ORDER_IN_PROGRESS');
  // A worker that loses the claim race never calls register.
  const lost=await m.dispatchOrder({order:rt.order(a.orderId),quote:prep.quote,owner:{coverage:null,paymentMethod:{kind:'payment-method',id:'pm-a'}},registrar:reg,policy:{pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium:false},now:rt.now,claim:()=>false});
  assert.equal(lost.claimed,false);assert.equal(lost.order.state,'reserved');assert.equal(reg.calls.register,0);
  await rt.dispatch(a.orderId);await rt.dispatch(a.orderId);assert.equal(reg.calls.register,1);
  assert.equal((await rt.consent(OWNER,accept(prep))).orderId,a.orderId);
  await rejects(()=>rt.prepare(OWNER,req()),'UNAVAILABLE');
  await rejects(()=>rt.consent(OWNER,accept(second)),'ALREADY_REGISTERED');
  assert.equal(reg.calls.register,1);assert.equal(rt.orders().length,1);
 });

 await test('a lost registrar response holds and never redispatches',async()=>{
  for(const kind of ['timeout-before','timeout-after','pending','malformed']){
   const {rt,reg}=setup();const {orderId}=await reserved(rt);reg.next(kind);
   assert.equal((await rt.dispatch(orderId)).state,'unknown-outcome',kind);
   assert.equal(rt.hold(orderId).state,'held',kind);
   await rejects(()=>rt.dispatch(orderId),'NO_REDISPATCH');
   await rejects(()=>rt.cancel(OWNER,orderId),'CANNOT_RECALL');
   assert.equal(reg.calls.register,1,kind);
  }
 });

 await test('an interrupted worker becomes unknown-outcome',async()=>{
  const {rt,reg}=setup();const {orderId}=await reserved(rt);
  assert.equal((await rt.dispatch(orderId,{interrupt:true})).state,'dispatching');
  rt.advance(bounds.leaseMs-1);rt.sweep();assert.equal(rt.order(orderId).state,'dispatching');
  rt.advance(1);rt.sweep();assert.equal(rt.order(orderId).state,'unknown-outcome');
  assert.equal(rt.hold(orderId).state,'held');await rejects(()=>rt.dispatch(orderId),'NO_REDISPATCH');
  assert.ok(reg.calls.register<=1);
 });

 await test('reconciliation is read-only and bounded',async()=>{
  let {rt,reg}=setup();let {orderId}=await reserved(rt);reg.next('timeout-before');await rt.dispatch(orderId);
  for(let i=1;i<=bounds.reconcileReads;i++){rt.advance(3600000);await rt.reconcile(orderId);}
  assert.equal(rt.order(orderId).state,'unresolved');assert.equal(rt.hold(orderId).state,'held');
  assert.equal(reg.calls.lookup,bounds.reconcileReads);assert.equal(reg.calls.register,1);
  await rt.reconcile(orderId);assert.equal(reg.calls.lookup,bounds.reconcileReads);
  ({rt,reg}=setup());({orderId}=await reserved(rt));reg.next('timeout-before');await rt.dispatch(orderId);
  rt.advance(bounds.reconcileWindowMs);await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'unresolved');assert.equal(reg.calls.lookup,0);assert.equal(rt.hold(orderId).state,'held');
  ({rt,reg}=setup());({orderId}=await reserved(rt));reg.next('timeout-after');await rt.dispatch(orderId);await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'registered');assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
  ({rt,reg}=setup());({orderId}=await reserved(rt));reg.next('pending');await rt.dispatch(orderId);await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'unknown-outcome');reg.finishPending(NAME,false);await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'failed');assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,1);
  ({rt,reg}=setup());({orderId}=await reserved(rt));reg.next('timeout-before');await rt.dispatch(orderId);reg.takeBy(NAME);await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'failed');assert.ok(rt.order(orderId).history.includes('failed:registered-elsewhere'));assert.equal(reg.calls.register,1);
  // A registration with no reference, or an answer we cannot read, is not proof it is someone else's: the order ends in the bound with its hold kept.
  ({rt,reg}=setup());({orderId}=await reserved(rt));reg.next('timeout-before');await rt.dispatch(orderId);reg.takeBy(NAME,null);for(let i=0;i<4;i++)await rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'unresolved');assert.equal(rt.hold(orderId).state,'held');
 });

 await test('reordered and duplicate registrar events are ignored',async()=>{
  const {rt,reg}=setup();const {orderId}=await reserved(rt);reg.next('pending');await rt.dispatch(orderId);
  const attemptId=rt.order(orderId).attempt.attemptId;
  await rejects(()=>rt.applyRegistrarEvent({eventId:'e0',orderId,attemptId,type:'registered',authenticated:false}),'EVENT_NOT_AUTHENTICATED');
  assert.equal(rt.order(orderId).state,'unknown-outcome');
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e1',orderId,attemptId:'stale',type:'failed',authenticated:true}),{applied:false,stale:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e2',orderId,attemptId,type:'registered',authenticated:true}),{applied:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e2',orderId,attemptId,type:'registered',authenticated:true}),{applied:false,duplicate:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e3',orderId,attemptId,type:'failed',authenticated:true}),{applied:false,ignored:true});
  assert.equal(rt.order(orderId).state,'registered');assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
  assert.equal((await rt.dispatch(orderId)).state,'registered');assert.equal(reg.calls.register,1);
 });

 await test('definite rejection releases the hold',async()=>{
  const {rt,reg}=setup();const {orderId}=await reserved(rt);reg.next('rejected');
  assert.equal((await rt.dispatch(orderId)).state,'failed');assert.equal(rt.hold(orderId).state,'released');
  const again=await rt.prepare(OWNER,req());assert.equal((await rt.consent(OWNER,accept(again))).state,'consented');assert.equal(reg.calls.register,1);
 });

 await test('premium domains are excluded from the annual benefit',async()=>{
  await rejects(()=>setup().rt.prepare(OWNER,req({hostname:PREMIUM})),'PREMIUM_NOT_OFFERED');
  const {rt,reg}=setup({allowPremium:true});const prep=await rt.prepare(OWNER,req({hostname:PREMIUM}));
  assert.equal(prep.quote.premium,true);assert.deepEqual(prep.quote.benefit,{eligible:false,coverableWholesaleCents:0,redemption:'not-enabled'});
  assert.ok(prep.consentText.includes('premium domain'));
  const o=await rt.consent(OWNER,accept(prep));rt.reserve(o.orderId);assert.equal((await rt.dispatch(o.orderId)).state,'registered');assert.equal(reg.calls.register,1);
  assert.deepEqual((await rt.prepare(OWNER,req())).quote.benefit,{eligible:true,coverableWholesaleCents:1050,redemption:'not-enabled'});
  assert.equal((await rt.prepare(OWNER,req({hostname:CAFE}))).quote.benefit.coverableWholesaleCents,2000);
  assert.equal((await setup({coverage:{planId:'personal',interval:'month'}}).rt.prepare(OWNER,req())).quote.benefit.eligible,false);
  assert.equal((await setup({coverage:null}).rt.prepare(OWNER,req())).quote.benefit.eligible,false);
  await rejects(()=>m.validateQuote({...prep.quote,benefit:{eligible:true,coverableWholesaleCents:2000,redemption:'not-enabled'}}),'PREMIUM_BENEFIT');
 });

 await test('benefit redemption is not claimed and funding is a payment method',async()=>{
  const {rt}=setup();const prep=await rt.prepare(OWNER,req());
  assert.equal(prep.quote.benefit.eligible,true);assert.equal(prep.quote.funding.benefitCents,0);
  assert.equal(prep.quote.funding.customerChargeCents,prep.quote.initial.totalCents);assert.equal(prep.quote.funding.payer,'customer');
  assert.deepEqual([...m.fundingSourceKinds],['payment-method']);assert.equal(m.domainBenefit.redemptionEnabled,false);
  await rejects(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,benefitCents:500}}),'BENEFIT_NOT_ENABLED');
  await rejects(()=>m.validateQuote({...prep.quote,benefit:{...prep.quote.benefit,redemption:'redeemed'}}),'BENEFIT_NOT_ENABLED');
  for(const kind of ['premium-credit','build-credit','plan-benefit'])await rejects(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,sourceKind:kind}}),'INVALID_FUNDING');
  for(const kind of ['premium-credit','build-credit','plan-benefit']){
   const fresh=setup();fresh.rt.setPaymentMethod('owner-a',{kind,id:'x-a'});await rejects(()=>fresh.rt.prepare(OWNER,req()),'NO_FUNDING_SOURCE');
  }
  const none=setup();none.rt.setPaymentMethod('owner-a',undefined);await rejects(()=>none.rt.prepare(OWNER,req()),'NO_FUNDING_SOURCE');
 });

 await test('auto-renew is off by default and needs an exact opt-in',async()=>{
  const {rt,reg}=setup();await registered(rt);
  assert.equal(rt.registration(NAME).autoRenew,false);assert.deepEqual(await rt.renewalDecision(NAME),{renew:false,reason:'auto-renew-off'});
  const draft=await rt.prepareAutoRenew(MODEL,NAME);
  const confirm=(o={})=>({contractVersion:1,reviewId:draft.review.reviewId,consentTextDigest:draft.review.consentTextDigest,...o});
  await rejects(()=>rt.confirmAutoRenew(MODEL,confirm()),'MODEL_CANNOT_CONSENT');
  await rejects(()=>rt.confirmAutoRenew(OWNER_B,confirm()),'FOREIGN_OWNER');
  await rejects(()=>rt.confirmAutoRenew(OWNER,confirm({consentTextDigest:'0'.repeat(64)})),'CONSENT_MISMATCH');
  await rejects(()=>rt.confirmAutoRenew(OWNER,confirm({contractVersion:2})),'UNSUPPORTED_VERSION');
  reg.setPrice(NAME,{renewal:1200});await rejects(()=>rt.confirmAutoRenew(OWNER,confirm()),'PRICE_CHANGED');
  assert.equal(rt.registration(NAME).autoRenew,false);
  const exact=await rt.prepareAutoRenew(OWNER,NAME);assert.equal(exact.review.consentTextDigest,sha(exact.consentText));
  assert.equal((await rt.confirmAutoRenew(OWNER,{contractVersion:1,reviewId:exact.review.reviewId,consentTextDigest:exact.review.consentTextDigest})).autoRenew,true);
  assert.deepEqual(await rt.renewalDecision(NAME),{renew:true});
  reg.setPrice(NAME,{renewal:1500});assert.deepEqual(await rt.renewalDecision(NAME),{renew:false,reason:'renewal-price-changed'});
  assert.equal(rt.registration(NAME).autoRenew,false);
 });

 await test('transfer-out honours the ICANN 60-day lock',async()=>{
  const {rt}=setup();await registered(rt);
  await rejects(()=>rt.requestTransferOut(OWNER,NAME),'TRANSFER_LOCKED');
  await rejects(()=>rt.requestTransferOut(OWNER_B,NAME),'FOREIGN_OWNER');
  await rejects(()=>rt.requestTransferOut(MODEL,NAME),'FOREIGN_OWNER');
  rt.advance(60*DAY);const out=rt.requestTransferOut(OWNER,NAME);
  assert.deepEqual(out,{hostname:NAME,state:'auth-code-issued',delivery:'owner-only'});
  assert.equal(rt.registration(NAME).autoRenew,false);
 });

 await test('the quote shape is closed and server-computed',async()=>{
  const {rt}=setup();const q=(await rt.prepare(OWNER,req())).quote;
  assert.deepEqual(m.validateQuote(structuredClone(q)),q);
  assert.equal(q.expiresAt-q.quotedAt,bounds.quoteTtlMs);assert.equal(q.renewal.guaranteed,false);assert.equal(q.taxStatus,'computed');
  assert.equal(q.autoRenew,false);assert.equal(q.privacy,'redacted');assert.deepEqual(q.registrar,{adapterId:'synthetic-registrar',adapterVersion:1});
  for(const name of ['www.synthetic-bakery.com','SYNTHETIC.COM','whumpo.com','bakery.test','https://bakery.com','bakery',''])await rejects(()=>m.registrableName(name),'INVALID_HOSTNAME');
  await rejects(()=>m.validateQuote({...q,taxStatus:'unknown'}),'TAX_UNKNOWN');
  await rejects(()=>m.validateQuote({...q,initial:{...q.initial,totalCents:q.initial.totalCents-1}}),'INVALID_TOTAL');
  await rejects(()=>m.validateQuote({...q,expiresAt:q.quotedAt+bounds.quoteTtlMs+1}),'INVALID_EXPIRY');
  await rejects(()=>m.validateQuote({...q,renewal:{...q.renewal,guaranteed:true}}),'RENEWAL_GUARANTEE');
  await rejects(()=>m.validateQuote({...q,autoRenew:true}),'AUTO_RENEW_DEFAULT');
  await rejects(()=>m.validateQuote({...q,initial:{...q.initial,taxCents:1.5}}),'INVALID_AMOUNT');
 });
 return count;
}

const source=await load();
const suiteCount=await suite(source);
let total=suiteCount;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const read=file=>readFileSync(join(root,file),'utf8');

await checkOnce('the quote benefit comes from the src/plans.ts policy',()=>{
 assert.deepEqual({...source.domainBenefit},{wholesaleCapCents:2000,currency:'USD',premiumEligible:false,redemptionEnabled:false});
 assert.equal(source.quoteDomainBenefit('personal','year',2500,true).eligible,false);
 assert.equal(source.quoteDomainBenefit('personal','year',2500,false).coveredCents,2000);
 assert.equal(source.quoteDomainBenefit('personal','month',1000,false).eligible,false);
 assert.equal(source.quoteDomainBenefit('personal','year',1000,false).redemptionEnabled,false);
 assert.match(read('src/domain-purchase/quote.ts'),/import \{quoteDomainBenefit\} from '\.\.\/plans';/);
});
await checkOnce('the replaced quote shape is gone',()=>{
 assert.ok(!existsSync(join(root,'src/domain-purchase-quote.ts')));
 const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
 for(const file of [...walk(join(root,'src')),...walk(join(root,'frontend/src'))])assert.ok(!/domain-purchase-quote|reviewDomainPurchaseQuote|matchesDomainPurchaseReview|DomainQuoteError/.test(readFileSync(file,'utf8')),file);
});
await checkOnce('the module is pure and no Worker entry reaches it',async()=>{
 const allowed=new Set(['../project-specification/v2/json','../plans','./quote','./order','./registrar']);
 for(const file of moduleFiles){
  const text=read(file);
  const specifiers=[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
  assert.ok(specifiers.every(s=>allowed.has(s)),`${file} imports ${specifiers}`);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+/.test(text),file);
 }
 for(const worker of ['src/index.ts','src/site-host.ts','src/app-host.ts','src/runtime/worker.ts']){
  const out=await build({entryPoints:[join(root,worker)],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent',external:['cloudflare:*','*.wasm']});
  const inputs=Object.keys(out.metafile.inputs);assert.ok(inputs.length>5,worker);
  assert.deepEqual(inputs.filter(p=>/domain-purchase/.test(p)),[],`${worker} reaches the domain purchase module`);
 }
});

// ---------- Mutation check: each deliberately broken copy of the source must fail the suite ----------
const Q='src/domain-purchase/quote.ts',O='src/domain-purchase/order.ts',R='src/domain-purchase/renewal.ts',P='src/plans.ts';
const mutants=[
 ['client authority keys accepted',Q,"check(!authorityKeys.has(key.toLowerCase().replace(/[-_]/g,'')),'CLIENT_AUTHORITY'","check(true,'CLIENT_AUTHORITY'"],
 ['unknown request version accepted',Q,"check(request.contractVersion===contractVersion,'UNSUPPORTED_VERSION','request.contractVersion');",''],
 ['model may consent',O,"check(plain(actor)&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');\n check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');",''],
 ['consent digest not bound',O,"check(accepted.consentTextDigest===review.consentTextDigest&&await consentTextDigest(consentText(quote))===review.consentTextDigest,'CONSENT_MISMATCH',review.reviewId);",''],
 ['expired quote accepted',O,"check(now<review.expiresAt&&now<quote.expiresAt,'QUOTE_EXPIRED',review.reviewId);",''],
 ['expired reservation dispatched',O,"if(now>=quote.expiresAt)return {...step(moved(order,'expired','quote-expired'),'release'),claimed:false};",''],
 ['price change ignored at consent',O,"check(await pricesUnchanged(quote,{owner,registrar,policy,now}),'PRICE_CHANGED',review.reviewId);",''],
 ['price change ignored before dispatch',O,"if(!await pricesUnchanged(quote,{owner,registrar,policy,now}))return {...step(moved(order,'cancelled','price-changed'),'release'),claimed:false};",''],
 ['foreign owner may consent',O,"check(review.ownerId===actor.ownerId,'FOREIGN_OWNER',accepted.reviewId);",''],
 ['stale project authority accepted',O,"check(project&&project.projectId===review.projectId&&project.ownerId===review.ownerId&&project.revision===review.projectRevision,'STALE_REVIEW',review.projectId);",''],
 ['duplicate consent creates another order',O,"if(existing)return {...step(existing),replayed:true};",''],
 ['lost response treated as failure',O,"return step({...moved(order,'unknown-outcome','uncertain'),uncertainAt:now});","return step(moved(order,'failed','uncertain'),'release');"],
 ['hold released on uncertainty',O,"return step({...moved(order,'unknown-outcome','uncertain'),uncertainAt:now});","return step({...moved(order,'unknown-outcome','uncertain'),uncertainAt:now},'release');"],
 ['redispatch after unknown outcome',O,"check(!inFlight.includes(order.state),'NO_REDISPATCH',order.state);","if(order.state==='unknown-outcome')return dispatchOrder({...input,order:{...order,state:'reserved'}});"],
 ['interrupted dispatch requeued',O,"return step({...moved(order,'unknown-outcome','interrupted'),uncertainAt:now});","return step({...order,state:'reserved',history:[...order.history,'reserved']});"],
 ['reconciliation re-sends the purchase',O,"const found=await registrar.lookup(order.hostname);","const found=(await registrar.register({hostname:order.hostname,orderRef:order.orderId,acknowledgePremium:false,autoRenew:false,privacy:'redaction'}),await registrar.lookup(order.hostname));"],
 ['not found treated as proof of failure',O,"if(!ours&&plain(found)&&found.status==='registered'&&typeof found.orderRef==='string'&&found.orderRef.length>0&&found.orderRef!==order.orderId)return step(moved(read,'failed','registered-elsewhere'),'release');","return step(moved(read,'failed','not-found'),'release');"],
 ['a missing reference treated as someone else\'s registration',O,"if(!ours&&plain(found)&&found.status==='registered'&&typeof found.orderRef==='string'&&found.orderRef.length>0&&found.orderRef!==order.orderId)","if(plain(found)&&found.status==='registered')"],
 ['reconciliation read bound not applied',O,"if(read.reconcileReads>=domainPurchaseBounds.reconcileReads)return step(moved(read,'unresolved','reconcile-bound'));",''],
 ['reconciliation window not applied',O,"||now-since>=domainPurchaseBounds.reconcileWindowMs",''],
 ['unauthenticated events applied',O,"check(plain(event)&&event.authenticated===true,'EVENT_NOT_AUTHENTICATED','event');",''],
 ['duplicate events re-applied',O,"if(seen)return {outcome:{applied:false,duplicate:true},step:null};",''],
 ['premium receives the benefit',P,"const eligible = interval === 'year' && plan.annualDomains > 0 && !premium;","const eligible = interval === 'year' && plan.annualDomains > 0;"],
 ['AI or build credit funds a domain',Q,"export const fundingSourceKinds:readonly string[]=Object.freeze(['payment-method']);","export const fundingSourceKinds:readonly string[]=Object.freeze(['payment-method','premium-credit','build-credit','plan-benefit']);"],
 ['registration auto-renews by default',O,"createdAt,expiresAt,autoRenew:false,renewalOptIn:null,chargeMismatch","createdAt,expiresAt,autoRenew:true,renewalOptIn:null,chargeMismatch"],
 ['renewal opt-in survives a price rise',R,"if(await currentRenewalTotal(registration.hostname,registrar,policy)>optIn.renewalTotalCents)","if(false)"],
 ['transfer lock ignored',R,"check(now-registration.createdAt>=domainPurchaseBounds.transferLockMs,'TRANSFER_LOCKED',registration.hostname);",''],
];
// Each mutant must be caught by the check written for that property, not by an unrelated failure.
const killedBy={
 'client authority keys accepted':'clients and models cannot set price','unknown request version accepted':'unknown or stale contract versions',
 'model may consent':'only the human owner can consent','consent digest not bound':'consent binds the exact consent text digest',
 'expired quote accepted':'an expired quote requires a new review','expired reservation dispatched':'an expired quote requires a new review',
 'price change ignored at consent':'a changed price requires a new review','price change ignored before dispatch':'a changed price requires a new review',
 'foreign owner may consent':'stale or foreign authority is refused','stale project authority accepted':'stale or foreign authority is refused',
 'duplicate consent creates another order':'duplicate consent and dispatch never create a second purchase',
 'lost response treated as failure':'a lost registrar response holds and never redispatches','hold released on uncertainty':'a lost registrar response holds and never redispatches',
 'redispatch after unknown outcome':'a lost registrar response holds and never redispatches','interrupted dispatch requeued':'an interrupted worker becomes unknown-outcome',
 'reconciliation re-sends the purchase':'reconciliation is read-only and bounded','not found treated as proof of failure':'reconciliation is read-only and bounded','a missing reference treated as someone else\'s registration':'reconciliation is read-only and bounded',
 'reconciliation read bound not applied':'reconciliation is read-only and bounded','reconciliation window not applied':'reconciliation is read-only and bounded',
 'unauthenticated events applied':'reordered and duplicate registrar events are ignored','duplicate events re-applied':'reordered and duplicate registrar events are ignored',
 'premium receives the benefit':'premium domains are excluded from the annual benefit','AI or build credit funds a domain':'benefit redemption is not claimed and funding is a payment method',
 'registration auto-renews by default':'auto-renew is off by default','renewal opt-in survives a price rise':'auto-renew is off by default',
 'transfer lock ignored':'transfer-out honours the ICANN 60-day lock',
};
let killed=0;
for(const [name,file,find,replace] of mutants){
 const text=read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 const mutant=await load({[file]:text.replace(find,()=>replace)});
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`domain-purchase-contract: ${suiteCount} source checks and ${total-suiteCount} policy/static checks passed against src/domain-purchase; ${killed}/${mutants.length} source mutants caught (synthetic registrar; no database, network, payment, credential or model).`);

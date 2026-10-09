import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

// WH-034 / WH-192 offline domain purchase conformance harness. Synthetic registrar, names, prices and identifiers only:
// no database, network, credential, payment, registrar account or model. It proves the frozen contract and the
// reference runtime, plus agreement with the existing plan benefit and quote helper source. It does not prove D1
// atomicity, payment holds, a registrar adapter or any purchase; the implementation slices must run equivalent checks
// against their handlers. Every suite check also runs against deliberately broken copies of the reference (mutants
// below), each of which must be caught by the check written for that property.
const prototypeURL=new URL('../tools/prototypes/domain-purchase.mjs',import.meta.url);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const OWNER={kind:'owner',ownerId:'owner-a'},OWNER_B={kind:'owner',ownerId:'owner-b'},MODEL={kind:'model',ownerId:'owner-a'};
const NAME='synthetic-bakery.com',PREMIUM='synthetic-premium.com',CAFE='synthetic-cafe.com';
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const DAY=86400000;

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
 function setup({allowPremium=false,plan={interval:'year',annualDomains:1}}={}){
  const reg=m.createSyntheticRegistrar({prices:{[NAME]:{registration:1050,renewal:1150},[CAFE]:{registration:2400,renewal:2400},[PREMIUM]:{registration:45000,renewal:45000,premium:true}}});
  const rt=m.createReferenceRuntime({registrar:reg,pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium});
  rt.addOwner('owner-a',{plan,paymentMethod:{kind:'payment-method',id:'pm-a'}});
  rt.addOwner('owner-b',{plan,paymentMethod:{kind:'payment-method',id:'pm-b'}});
  rt.addProject('project-a','owner-a');rt.addProject('project-b','owner-b');
  return {rt,reg};
 }
 const req=(o={})=>({contractVersion:1,projectId:'project-a',hostname:NAME,...o});
 const accept=(prep,o={})=>({contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept',...o});
 function reserved(rt,hostname=NAME,actor=OWNER,projectId='project-a'){
  const prep=rt.prepare(actor,req({hostname,projectId}));const order=rt.consent(actor,accept(prep));rt.reserve(order.orderId);return {prep,orderId:order.orderId};
 }
 function registered(rt,reg){const {orderId}=reserved(rt);rt.dispatch(orderId);assert.equal(rt.order(orderId).state,'registered');return orderId;}

 await test('frozen vocabularies and transitions',()=>{
  for(const s of ['quoted','consented','reserved','dispatching','registered','failed','unknown-outcome','unresolved','cancelled','expired'])assert.ok(m.orderStates.includes(s),s);
  assert.deepEqual(Object.keys(m.transitions).sort(),[...m.orderStates].sort());
  for(const [from,to] of Object.entries(m.transitions))for(const t of to)assert.ok(m.orderStates.includes(t),`${from}->${t}`);
  for(const s of ['unknown-outcome','unresolved'])for(const back of ['quoted','consented','reserved','dispatching'])assert.ok(!m.transitions[s].includes(back),`${s} cannot return to ${back}`);
  for(const s of ['registered','failed','cancelled','expired'])assert.deepEqual(m.transitions[s],[]);
  assert.equal(m.contractVersion,1);assert.equal(m.bounds.quoteTtlMs,15*60000);assert.equal(m.bounds.reconcileReads,3);
 });

 await test('unknown or stale contract versions are rejected',()=>{
  const {rt}=setup();
  for(const v of [0,2,'1',undefined,null])throws(()=>m.validateQuoteRequest(req({contractVersion:v})),'UNSUPPORTED_VERSION');
  const {contractVersion:_,...missing}=req();throws(()=>m.validateQuoteRequest(missing),'UNSUPPORTED_VERSION');
  throws(()=>rt.prepare(OWNER,req({contractVersion:2})),'UNSUPPORTED_VERSION');
  throws(()=>m.validateQuoteRequest(req({note:'hello'})),'UNKNOWN_FIELD');
  const prep=rt.prepare(OWNER,req());
  throws(()=>m.validateQuote({...prep.quote,contractVersion:2}),'UNSUPPORTED_VERSION');
  throws(()=>m.validateQuote({...prep.quote,legacyPrice:1}),'UNKNOWN_FIELD');
  throws(()=>rt.consent(OWNER,accept(prep,{contractVersion:0})),'UNSUPPORTED_VERSION');
  throws(()=>rt.consent(OWNER,accept(prep,{decision:'maybe'})),'INVALID_DECISION');
  assert.equal(rt.orders().length,0);
  assert.deepEqual(Object.keys(m).filter(k=>/legacy|v0|migrat|upgrade|decodeOld/i.test(k)),[]);
 });

 await test('clients and models cannot set price, funding or authority',()=>{
  const {rt,reg}=setup();
  for(const extra of [{priceCents:1},{total_cents:1},{funding:{payer:'platform'}},{fundingSourceId:'pm-x'},{benefitCents:2000},{premium:false},{autoRenew:true},{approved:true},{quote:{}},{currency:'EUR'},{nested:{'retail-cents':1}},{list:[{coupon:'FREE'}]}])
   for(const actor of [OWNER,MODEL])throws(()=>rt.prepare(actor,req(extra)),'CLIENT_AUTHORITY');
  const prep=rt.prepare(MODEL,req());
  assert.equal(prep.quote.initial.wholesaleCents,1050);assert.equal(prep.quote.initial.totalCents,1050+30+86);
  assert.equal(prep.quote.funding.sourceId,'pm-a');assert.equal(reg.calls.register,0);
  throws(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,payer:'platform'}}),'INVALID_FUNDING');
 });

 await test('only the human owner can consent',()=>{
  const {rt,reg}=setup();const prep=rt.prepare(MODEL,req());
  throws(()=>rt.consent(MODEL,accept(prep)),'MODEL_CANNOT_CONSENT');
  throws(()=>rt.consent({kind:'visitor',ownerId:'owner-a'},accept(prep)),'HUMAN_REVIEW_REQUIRED');
  throws(()=>rt.consent({kind:'service',ownerId:'owner-a'},accept(prep)),'HUMAN_REVIEW_REQUIRED');
  assert.equal(rt.orders().length,0);assert.equal(reg.calls.register,0);
  assert.equal(rt.consent(OWNER,accept(prep)).state,'consented');
 });

 await test('consent binds the exact consent text digest',()=>{
  const {rt}=setup();const prep=rt.prepare(OWNER,req());
  assert.equal(prep.review.consentTextDigest,sha(prep.consentText));
  assert.equal(m.consentText(prep.quote),prep.consentText);
  for(const phrase of ['$11.66','Auto-renew is off','not applied','cannot be refunded','synthetic-registrar'])assert.ok(prep.consentText.includes(phrase),phrase);
  throws(()=>rt.consent(OWNER,accept(prep,{consentTextDigest:sha(prep.consentText+' ')})),'CONSENT_MISMATCH');
  throws(()=>rt.consent(OWNER,accept(prep,{quoteDigest:'0'.repeat(64)})),'REVIEW_MISMATCH');
  assert.equal(rt.orders().length,0);
  assert.equal(rt.consent(OWNER,accept(prep)).state,'consented');
 });

 await test('an expired quote requires a new review',()=>{
  let {rt,reg}=setup();let prep=rt.prepare(OWNER,req());
  rt.advance(m.bounds.reviewTtlMs);throws(()=>rt.consent(OWNER,accept(prep)),'QUOTE_EXPIRED');
  prep=rt.prepare(OWNER,req());assert.equal(rt.consent(OWNER,accept(prep)).state,'consented');
  ({rt,reg}=setup());prep=rt.prepare(OWNER,req());let order=rt.consent(OWNER,accept(prep));
  rt.advance(m.bounds.quoteTtlMs);assert.equal(rt.reserve(order.orderId).state,'expired');assert.equal(rt.hold(order.orderId),undefined);
  ({rt,reg}=setup());const {orderId}=reserved(rt);rt.advance(m.bounds.quoteTtlMs);
  assert.equal(rt.dispatch(orderId).state,'expired');assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,0);
 });

 await test('a changed price requires a new review',()=>{
  let {rt,reg}=setup();let prep=rt.prepare(OWNER,req());
  reg.setPrice(NAME,{registration:1100});throws(()=>rt.consent(OWNER,accept(prep)),'PRICE_CHANGED');
  const fresh=rt.prepare(OWNER,req());assert.notEqual(fresh.review.quoteDigest,prep.review.quoteDigest);
  assert.equal(rt.consent(OWNER,accept(fresh)).state,'consented');
  ({rt,reg}=setup());prep=rt.prepare(OWNER,req());reg.setPrice(NAME,{renewal:1300});throws(()=>rt.consent(OWNER,accept(prep)),'PRICE_CHANGED');
  ({rt,reg}=setup());const {orderId}=reserved(rt);reg.setPrice(NAME,{registration:900});
  const o=rt.dispatch(orderId);assert.equal(o.state,'cancelled');assert.ok(o.history.includes('cancelled:price-changed'));
  assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,0);
 });

 await test('stale or foreign authority is refused',()=>{
  let {rt}=setup();let prep=rt.prepare(OWNER,req());
  throws(()=>rt.consent(OWNER_B,accept(prep)),'FOREIGN_OWNER');
  throws(()=>rt.prepare(OWNER_B,req()),'FOREIGN_OWNER');
  throws(()=>rt.prepare({kind:'owner',ownerId:'owner-b'},req({projectId:'project-missing'})),'FOREIGN_OWNER');
  rt.transferProject('project-a','owner-b');throws(()=>rt.consent(OWNER,accept(prep)),'STALE_REVIEW');
  ({rt}=setup());prep=rt.prepare(OWNER,req());rt.setPaymentMethod('owner-a',{kind:'payment-method',id:'pm-a2'});throws(()=>rt.consent(OWNER,accept(prep)),'FUNDING_CHANGED');
  ({rt}=setup());const {orderId}=reserved(rt);throws(()=>rt.cancel(OWNER_B,orderId),'FOREIGN_OWNER');
  assert.equal(rt.order(orderId).state,'reserved');
 });

 await test('the happy path registers once and captures the hold',()=>{
  const {rt,reg}=setup();const {orderId}=reserved(rt);
  assert.deepEqual(rt.hold(orderId),{orderId,sourceId:'pm-a',amountCents:1166,state:'held'});
  const o=rt.dispatch(orderId);assert.equal(o.state,'registered');assert.deepEqual(o.history,['quoted','consented','reserved','dispatching','registered']);
  assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
  const r=rt.registration(NAME);assert.equal(r.ownerId,'owner-a');assert.equal(r.projectId,'project-a');assert.equal(r.chargeMismatch,false);
 });

 await test('duplicate consent and dispatch never create a second purchase',()=>{
  const {rt,reg}=setup();const prep=rt.prepare(OWNER,req());
  const a=rt.consent(OWNER,accept(prep)),b=rt.consent(OWNER,accept(prep));
  assert.equal(a.orderId,b.orderId);assert.equal(rt.orders().length,1);
  rt.reserve(a.orderId);rt.reserve(a.orderId);assert.equal(rt.hold(a.orderId).amountCents,1166);
  const second=rt.prepare(OWNER,req());throws(()=>rt.consent(OWNER,accept(second)),'ORDER_IN_PROGRESS');
  rt.addProject('project-b2','owner-b');const other=rt.prepare(OWNER_B,req({projectId:'project-b2'}));throws(()=>rt.consent(OWNER_B,accept(other)),'ORDER_IN_PROGRESS');
  rt.dispatch(a.orderId);rt.dispatch(a.orderId);assert.equal(reg.calls.register,1);
  assert.equal(rt.consent(OWNER,accept(prep)).orderId,a.orderId);
  throws(()=>rt.prepare(OWNER,req()),'UNAVAILABLE');
  throws(()=>rt.consent(OWNER,accept(second)),'ALREADY_REGISTERED');
  assert.equal(reg.calls.register,1);assert.equal(rt.orders().length,1);
 });

 await test('a lost registrar response holds and never redispatches',()=>{
  for(const kind of ['timeout-before','timeout-after','pending','malformed']){
   const {rt,reg}=setup();const {orderId}=reserved(rt);reg.next(kind);
   assert.equal(rt.dispatch(orderId).state,'unknown-outcome',kind);
   assert.equal(rt.hold(orderId).state,'held',kind);
   throws(()=>rt.dispatch(orderId),'NO_REDISPATCH');
   throws(()=>rt.cancel(OWNER,orderId),'CANNOT_RECALL');
   assert.equal(reg.calls.register,1,kind);
  }
 });

 await test('an interrupted worker becomes unknown-outcome',()=>{
  const {rt,reg}=setup();const {orderId}=reserved(rt);
  assert.equal(rt.dispatch(orderId,{interrupt:true}).state,'dispatching');
  rt.advance(m.bounds.leaseMs-1);rt.sweep();assert.equal(rt.order(orderId).state,'dispatching');
  rt.advance(1);rt.sweep();assert.equal(rt.order(orderId).state,'unknown-outcome');
  assert.equal(rt.hold(orderId).state,'held');throws(()=>rt.dispatch(orderId),'NO_REDISPATCH');
  assert.ok(reg.calls.register<=1);
 });

 await test('reconciliation is read-only and bounded',()=>{
  let {rt,reg}=setup();let {orderId}=reserved(rt);reg.next('timeout-before');rt.dispatch(orderId);
  for(let i=1;i<=m.bounds.reconcileReads;i++){rt.advance(3600000);rt.reconcile(orderId);}
  assert.equal(rt.order(orderId).state,'unresolved');assert.equal(rt.hold(orderId).state,'held');
  assert.equal(reg.calls.lookup,m.bounds.reconcileReads);assert.equal(reg.calls.register,1);
  rt.reconcile(orderId);assert.equal(reg.calls.lookup,m.bounds.reconcileReads);
  ({rt,reg}=setup());({orderId}=reserved(rt));reg.next('timeout-before');rt.dispatch(orderId);
  rt.advance(m.bounds.reconcileWindowMs);rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'unresolved');assert.equal(reg.calls.lookup,0);assert.equal(rt.hold(orderId).state,'held');
  ({rt,reg}=setup());({orderId}=reserved(rt));reg.next('timeout-after');rt.dispatch(orderId);rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'registered');assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
  ({rt,reg}=setup());({orderId}=reserved(rt));reg.next('pending');rt.dispatch(orderId);rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'unknown-outcome');reg.finishPending(NAME,false,rt.now);rt.reconcile(orderId);
  assert.equal(rt.order(orderId).state,'failed');assert.equal(rt.hold(orderId).state,'released');assert.equal(reg.calls.register,1);
 });

 await test('reordered and duplicate registrar events are ignored',()=>{
  const {rt,reg}=setup();const {orderId}=reserved(rt);reg.next('pending');rt.dispatch(orderId);
  const attemptId=rt.order(orderId).attempt.attemptId;
  throws(()=>rt.applyRegistrarEvent({eventId:'e0',orderId,attemptId,type:'registered',authenticated:false}),'EVENT_NOT_AUTHENTICATED');
  assert.equal(rt.order(orderId).state,'unknown-outcome');
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e1',orderId,attemptId:'stale',type:'failed',authenticated:true}),{applied:false,stale:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e2',orderId,attemptId,type:'registered',authenticated:true}),{applied:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e2',orderId,attemptId,type:'registered',authenticated:true}),{applied:false,duplicate:true});
  assert.deepEqual(rt.applyRegistrarEvent({eventId:'e3',orderId,attemptId,type:'failed',authenticated:true}),{applied:false,ignored:true});
  assert.equal(rt.order(orderId).state,'registered');assert.equal(rt.hold(orderId).state,'captured');assert.equal(reg.calls.register,1);
 });

 await test('definite rejection releases the hold',()=>{
  const {rt,reg}=setup();const {orderId}=reserved(rt);reg.next('rejected');
  assert.equal(rt.dispatch(orderId).state,'failed');assert.equal(rt.hold(orderId).state,'released');
  const again=rt.prepare(OWNER,req());assert.equal(rt.consent(OWNER,accept(again)).state,'consented');assert.equal(reg.calls.register,1);
 });

 await test('premium domains are excluded from the annual benefit',()=>{
  throws(()=>setup().rt.prepare(OWNER,req({hostname:PREMIUM})),'PREMIUM_NOT_OFFERED');
  const {rt,reg}=setup({allowPremium:true});const prep=rt.prepare(OWNER,req({hostname:PREMIUM}));
  assert.equal(prep.quote.premium,true);assert.deepEqual(prep.quote.benefit,{eligible:false,coverableWholesaleCents:0,redemption:'not-enabled'});
  assert.ok(prep.consentText.includes('premium domain'));
  const o=rt.consent(OWNER,accept(prep));rt.reserve(o.orderId);assert.equal(rt.dispatch(o.orderId).state,'registered');assert.equal(reg.calls.register,1);
  assert.deepEqual(rt.prepare(OWNER,req()).quote.benefit,{eligible:true,coverableWholesaleCents:1050,redemption:'not-enabled'});
  assert.equal(rt.prepare(OWNER,req({hostname:CAFE})).quote.benefit.coverableWholesaleCents,2000);
  assert.equal(setup({plan:{interval:'month',annualDomains:1}}).rt.prepare(OWNER,req()).quote.benefit.eligible,false);
  throws(()=>m.validateQuote({...prep.quote,benefit:{eligible:true,coverableWholesaleCents:2000,redemption:'not-enabled'}}),'PREMIUM_BENEFIT');
 });

 await test('benefit redemption is not claimed and funding is a payment method',()=>{
  const {rt}=setup();const prep=rt.prepare(OWNER,req());
  assert.equal(prep.quote.benefit.eligible,true);assert.equal(prep.quote.funding.benefitCents,0);
  assert.equal(prep.quote.funding.customerChargeCents,prep.quote.initial.totalCents);assert.equal(prep.quote.funding.payer,'customer');
  assert.deepEqual([...m.fundingSourceKinds],['payment-method']);assert.equal(m.benefitPolicy.redemptionEnabled,false);
  throws(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,benefitCents:500}}),'BENEFIT_NOT_ENABLED');
  throws(()=>m.validateQuote({...prep.quote,benefit:{...prep.quote.benefit,redemption:'redeemed'}}),'BENEFIT_NOT_ENABLED');
  for(const kind of ['premium-credit','build-credit','plan-benefit'])throws(()=>m.validateQuote({...prep.quote,funding:{...prep.quote.funding,sourceKind:kind}}),'INVALID_FUNDING');
  for(const kind of ['premium-credit','build-credit','plan-benefit']){
   const fresh=setup();fresh.rt.setPaymentMethod('owner-a',{kind,id:'x-a'});throws(()=>fresh.rt.prepare(OWNER,req()),'NO_FUNDING_SOURCE');
  }
  const none=setup();none.rt.setPaymentMethod('owner-a',undefined);throws(()=>none.rt.prepare(OWNER,req()),'NO_FUNDING_SOURCE');
 });

 await test('auto-renew is off by default and needs an exact opt-in',()=>{
  const {rt,reg}=setup();registered(rt,reg);
  assert.equal(rt.registration(NAME).autoRenew,false);assert.deepEqual(rt.renewalDecision(NAME),{renew:false,reason:'auto-renew-off'});
  const draft=rt.prepareAutoRenew(MODEL,NAME);
  throws(()=>rt.confirmAutoRenew(MODEL,{contractVersion:1,reviewId:draft.review.reviewId,consentTextDigest:draft.review.consentTextDigest}),'MODEL_CANNOT_CONSENT');
  throws(()=>rt.confirmAutoRenew(OWNER_B,{contractVersion:1,reviewId:draft.review.reviewId,consentTextDigest:draft.review.consentTextDigest}),'FOREIGN_OWNER');
  throws(()=>rt.confirmAutoRenew(OWNER,{contractVersion:1,reviewId:draft.review.reviewId,consentTextDigest:'0'.repeat(64)}),'CONSENT_MISMATCH');
  throws(()=>rt.confirmAutoRenew(OWNER,{contractVersion:2,reviewId:draft.review.reviewId,consentTextDigest:draft.review.consentTextDigest}),'UNSUPPORTED_VERSION');
  reg.setPrice(NAME,{renewal:1200});throws(()=>rt.confirmAutoRenew(OWNER,{contractVersion:1,reviewId:draft.review.reviewId,consentTextDigest:draft.review.consentTextDigest}),'PRICE_CHANGED');
  assert.equal(rt.registration(NAME).autoRenew,false);
  const exact=rt.prepareAutoRenew(OWNER,NAME);assert.equal(exact.review.consentTextDigest,sha(exact.consentText));
  assert.equal(rt.confirmAutoRenew(OWNER,{contractVersion:1,reviewId:exact.review.reviewId,consentTextDigest:exact.review.consentTextDigest}).autoRenew,true);
  assert.deepEqual(rt.renewalDecision(NAME),{renew:true});
  reg.setPrice(NAME,{renewal:1500});assert.deepEqual(rt.renewalDecision(NAME),{renew:false,reason:'renewal-price-changed'});
  assert.equal(rt.registration(NAME).autoRenew,false);
 });

 await test('transfer-out honours the ICANN 60-day lock',()=>{
  const {rt,reg}=setup();registered(rt,reg);
  throws(()=>rt.requestTransferOut(OWNER,NAME),'TRANSFER_LOCKED');
  throws(()=>rt.requestTransferOut(OWNER_B,NAME),'FOREIGN_OWNER');
  throws(()=>rt.requestTransferOut(MODEL,NAME),'FOREIGN_OWNER');
  rt.advance(60*DAY);const out=rt.requestTransferOut(OWNER,NAME);
  assert.deepEqual(out,{hostname:NAME,state:'auth-code-issued',delivery:'owner-only'});
  assert.equal(rt.registration(NAME).autoRenew,false);
 });

 await test('the quote shape is closed and server-computed',()=>{
  const {rt}=setup();const q=rt.prepare(OWNER,req()).quote;
  assert.deepEqual(m.validateQuote(structuredClone(q)),q);
  assert.equal(q.expiresAt-q.quotedAt,m.bounds.quoteTtlMs);assert.equal(q.renewal.guaranteed,false);assert.equal(q.taxStatus,'computed');
  assert.equal(q.autoRenew,false);assert.equal(q.privacy,'redacted');assert.deepEqual(q.registrar,{adapterId:'synthetic-registrar',adapterVersion:1});
  for(const name of ['www.synthetic-bakery.com','SYNTHETIC.COM','whumpo.com','bakery.test','https://bakery.com','bakery',''])throws(()=>m.registrableName(name),'INVALID_HOSTNAME');
  throws(()=>m.validateQuote({...q,taxStatus:'unknown'}),'TAX_UNKNOWN');
  throws(()=>m.validateQuote({...q,initial:{...q.initial,totalCents:q.initial.totalCents-1}}),'INVALID_TOTAL');
  throws(()=>m.validateQuote({...q,expiresAt:q.quotedAt+m.bounds.quoteTtlMs+1}),'INVALID_EXPIRY');
  throws(()=>m.validateQuote({...q,renewal:{...q.renewal,guaranteed:true}}),'RENEWAL_GUARANTEE');
  throws(()=>m.validateQuote({...q,autoRenew:true}),'AUTO_RENEW_DEFAULT');
  throws(()=>m.validateQuote({...q,initial:{...q.initial,taxCents:1.5}}),'INVALID_AMOUNT');
 });
 return count;
}

const reference=await import(prototypeURL);
const suiteCount=await suite(reference);
let total=suiteCount;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const bundle=async entry=>{const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));};

await checkOnce('the benefit policy agrees with src/plans.ts',async()=>{
 const plans=await bundle('src/plans.ts');
 assert.deepEqual({...plans.domainBenefit},{...reference.benefitPolicy});
 assert.equal(plans.quoteDomainBenefit('personal','year',2500,true).eligible,false);
 assert.equal(plans.quoteDomainBenefit('personal','year',2500,false).coveredCents,2000);
 assert.equal(plans.quoteDomainBenefit('personal','month',1000,false).eligible,false);
 assert.equal(plans.quoteDomainBenefit('personal','year',1000,false).redemptionEnabled,false);
});
await checkOnce('the existing quote helper agrees on expiry, auto-renew and disabled purchase (gap G-D3 pinned)',async()=>{
 const helper=await bundle('src/domain-purchase-quote.ts');const now=2000000;
 const quote={id:'synthetic-quote',provider:'synthetic-registrar',providerReference:'opaque',ownerId:'owner-a',projectId:'project-a',domain:NAME,operation:'register',years:1,currency:'USD',available:true,premium:false,priceCents:1050,feeCents:30,taxCents:86,renewalPriceCents:1150,renewalFeeCents:30,renewalTaxCents:94,quotedAt:now,expiresAt:now+reference.bounds.quoteTtlMs,termsVersion:'synthetic-terms-1'};
 const review=await helper.reviewDomainPurchaseQuote(quote,'owner-a','project-a',now);
 assert.equal(review.totalCents,1166);assert.equal(review.autoRenew,false);assert.equal(review.purchaseEnabled,false);assert.equal(review.benefitRedeemed,false);assert.equal(review.renewalPriceGuaranteed,false);
 await assert.rejects(helper.reviewDomainPurchaseQuote({...quote,expiresAt:now+reference.bounds.quoteTtlMs+1},'owner-a','project-a',now));
 // G-D3: the helper validates a hostname, not a registrable name. The contract requires the registrable-name check.
 await helper.reviewDomainPurchaseQuote({...quote,domain:'www.'+NAME},'owner-a','project-a',now);
 assert.throws(()=>reference.registrableName('www.'+NAME));
});
await checkOnce('the reference imports only node builtins and no Worker source imports it',()=>{
 const specifiers=[...prototypeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers,['node:crypto']);
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env/.test(prototypeSource));
 const walk=dir=>readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});
 for(const file of walk('src'))assert.ok(!readFileSync(file,'utf8').includes('prototypes/domain-purchase'),file);
});

// ---------- Mutation check: each deliberately broken reference must fail the suite ----------
const mutants=[
 ['client authority keys accepted',"check(!authorityKeys.has(k.toLowerCase().replace(/[-_]/g,'')),'CLIENT_AUTHORITY'","check(true,'CLIENT_AUTHORITY'"],
 ['unknown request version accepted',"check(r.contractVersion===contractVersion,'UNSUPPORTED_VERSION','request.contractVersion');",''],
 ['model may consent',"check(actor&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');\n   check(actor&&actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');",''],
 ['consent digest not bound',"check(submission.consentTextDigest===review.consentTextDigest&&sha(consentText(q))===review.consentTextDigest,'CONSENT_MISMATCH',review.reviewId);",''],
 ['expired quote accepted',"check(s.now<review.expiresAt&&s.now<q.expiresAt,'QUOTE_EXPIRED',review.reviewId);",''],
 ['expired reservation dispatched',"if(s.now>=q.expiresAt){move(o,'expired','quote-expired');release(o);return structuredClone(o);}",''],
 ['price change ignored at consent',"check(priceUnchanged(q),'PRICE_CHANGED',review.reviewId);",''],
 ['price change ignored before dispatch',"if(!priceUnchanged(q)){move(o,'cancelled','price-changed');release(o);return structuredClone(o);}",''],
 ['foreign owner may consent',"check(review.ownerId===actor.ownerId,'FOREIGN_OWNER',submission.reviewId);",''],
 ['stale project authority accepted',"check(p&&p.ownerId===review.ownerId&&p.revision===review.projectRevision,'STALE_REVIEW',review.projectId);",''],
 ['duplicate consent creates another order',"if(s.byKey[key])return structuredClone(s.orders[s.byKey[key]]);",''],
 ['lost response treated as failure',"else{move(o,'unknown-outcome','uncertain');o.uncertainAt=s.now;}","else{move(o,'failed','uncertain');release(o);}"],
 ['hold released on uncertainty',"else{move(o,'unknown-outcome','uncertain');o.uncertainAt=s.now;}","else{move(o,'unknown-outcome','uncertain');o.uncertainAt=s.now;release(o);}"],
 ['redispatch after unknown outcome',"check(!['dispatching','unknown-outcome','unresolved'].includes(o.state),'NO_REDISPATCH',o.state);","if(o.state==='unknown-outcome')o.state='reserved';"],
 ['interrupted dispatch requeued',"{move(o,'unknown-outcome','interrupted');o.uncertainAt=s.now;}","{o.state='reserved';o.history.push('reserved');}"],
 ['reconciliation re-sends the purchase',"const found=registrar.lookup(o.hostname);","const found=(registrar.register({hostname:o.hostname,orderRef:o.orderId,acknowledgePremium:false,now:s.now}),registrar.lookup(o.hostname));"],
 ['not found treated as proof of failure',"else if(found.status==='registered'){move(o,'failed','registered-elsewhere');release(o);}","else{move(o,'failed','not-found');release(o);}"],
 ['reconciliation read bound not applied',"if(o.state==='unknown-outcome'&&o.reconcileReads>=bounds.reconcileReads)move(o,'unresolved','reconcile-bound');",''],
 ['reconciliation window not applied',"||s.now-o.uncertainAt>=bounds.reconcileWindowMs",''],
 ['unauthenticated events applied',"check(authenticated===true,'EVENT_NOT_AUTHENTICATED','event');",''],
 ['duplicate events re-applied',"if(s.events.has(eventId))return {applied:false,duplicate:true};",''],
 ['premium receives the benefit',"const eligible=plan.interval==='year'&&plan.annualDomains>0&&!c.premium;","const eligible=plan.interval==='year'&&plan.annualDomains>0;"],
 ['AI or build credit funds a domain',"export const fundingSourceKinds=Object.freeze(['payment-method']);","export const fundingSourceKinds=Object.freeze(['payment-method','premium-credit','build-credit','plan-benefit']);"],
 ['registration auto-renews by default',"createdAt:s.now,expiresAt:result.expiresAt,autoRenew:false","createdAt:s.now,expiresAt:result.expiresAt,autoRenew:true"],
 ['renewal opt-in survives a price rise',"if(currentRenewalTotal(hostname)>r.renewalOptIn.renewalTotalCents)","if(false)"],
 ['transfer lock ignored',"check(s.now-r.createdAt>=bounds.transferLockMs,'TRANSFER_LOCKED',hostname);",''],
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
 'reconciliation re-sends the purchase':'reconciliation is read-only and bounded','not found treated as proof of failure':'reconciliation is read-only and bounded',
 'reconciliation read bound not applied':'reconciliation is read-only and bounded','reconciliation window not applied':'reconciliation is read-only and bounded',
 'unauthenticated events applied':'reordered and duplicate registrar events are ignored','duplicate events re-applied':'reordered and duplicate registrar events are ignored',
 'premium receives the benefit':'premium domains are excluded from the annual benefit','AI or build credit funds a domain':'benefit redemption is not claimed and funding is a payment method',
 'registration auto-renews by default':'auto-renew is off by default','renewal opt-in survives a price rise':'auto-renew is off by default',
 'transfer lock ignored':'transfer-out honours the ICANN 60-day lock',
};
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`domain-purchase-contract: ${suiteCount} reference checks and ${total-suiteCount} source-agreement/static checks passed; ${killed}/${mutants.length} mutants caught (synthetic registrar; no database, network, payment, credential or model).`);

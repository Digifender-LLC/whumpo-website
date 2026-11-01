import assert from 'node:assert/strict';
import {build} from 'esbuild';

// WH-042 slice: paid entitlement from verified financial facts (src/entitlement-facts.ts), explicitly synthetic terms. Pure functions: no database, network, provider, Stripe call or
// schema, nothing wired. The decisive property is order independence: every arrival order of the same events yields the same facts and the same answer.
const bundle=await build({stdin:{contents:"export * from './src/entitlement-facts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const DAY=86400000,Y=365*DAY,GRACE=7*DAY,S=1_000*DAY;
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code,String(code));
const ev=(o)=>({verified:true,...o});
const paid=(o={})=>ev({id:'e-paid',kind:'invoice_paid',invoiceId:'in_1',subscriptionId:'sub_1',planId:'creator',amountCents:12000,startsAt:S,endsAt:S+Y,...o});
const fold=(events)=>events.reduce((f,e)=>m.record(f,e).facts,m.emptyFacts());
const view=(events,now)=>m.entitlement(fold(events),now,GRACE);
const perms=a=>a.length<2?[a]:a.flatMap((x,i)=>perms([...a.slice(0,i),...a.slice(i+1)]).map(p=>[x,...p]));
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};

await check('only a verified event records; a browser success page has no kind and no weight',()=>{
 throws(()=>m.record(m.emptyFacts(),{...paid(),verified:false}),'UNVERIFIED_EVENT');
 throws(()=>m.record(m.emptyFacts(),{id:'x',kind:'checkout_success_page',verified:true}),'INVALID_INPUT');
 assert.equal(view([],S+1).state,'none');
});
await check('an annual purchase covers exactly its interval: no earlier access and no extra month',()=>{
 assert.equal(view([paid()],S-1).state,'none');
 assert.equal(view([paid()],S).state,'active');
 assert.equal(view([paid()],S+Y-1).state,'active');
 assert.equal(view([paid()],S+Y).state,'none','the instant the interval ends access ends');
});
await check('duplicates are no-ops and conflicting bodies are refused',()=>{
 const f=fold([paid()]);
 assert.equal(m.record(f,paid()).replayed,true);assert.equal(m.record(f,paid()).facts,f);
 throws(()=>m.record(f,paid({amountCents:1})),'EVENT_CONFLICT');
 const again=m.record(f,paid({id:'e-paid-2'}));assert.equal(JSON.stringify(again.facts.paid),JSON.stringify(f.paid),'the same invoice under another event id changes nothing');
 throws(()=>m.record(f,paid({id:'e-paid-3',endsAt:S+2*Y})),'FACT_CONFLICT');
});
await check('every arrival order converges on the same facts and answer, including a refund before its invoice',()=>{
 const set=[paid(),ev({id:'e-r1',kind:'refund',invoiceId:'in_1',amountCents:2000}),ev({id:'e-d1',kind:'dispute',invoiceId:'in_1',disputeId:'dp_1',state:'open'}),ev({id:'e-d2',kind:'dispute',invoiceId:'in_1',disputeId:'dp_1',state:'won'}),ev({id:'e-c1',kind:'cancellation',subscriptionId:'sub_1',effectiveAt:S+Y})];
 const want=JSON.stringify(m.entitlement(fold(set),S+DAY,GRACE));const wantFacts=JSON.stringify(fold(set),(k,v)=>k==='events'?undefined:v);
 for(const p of perms(set)){assert.equal(JSON.stringify(m.entitlement(fold(p),S+DAY,GRACE)),want);assert.equal(JSON.stringify(fold(p),(k,v)=>k==='events'?undefined:v),wantFacts);}
 assert.equal(JSON.parse(want).state,'active');
});
await check('refunds: a full refund voids the invoice, a partial refund keeps access and says so, an over-refund is flagged',()=>{
 const r=(id,c)=>ev({id,kind:'refund',invoiceId:'in_1',amountCents:c});
 assert.equal(view([paid(),r('r1',12000)],S+DAY).state,'none');
 assert.equal(view([paid(),r('r1',5000),r('r2',7000)],S+DAY).state,'none','refunds add up');
 const part=view([paid(),r('r1',5000)],S+DAY);assert.equal(part.state,'active');assert.ok(part.reasons.includes('partially-refunded:in_1'));
 assert.ok(view([paid(),r('r1',13000)],S+DAY).reasons.includes('over-refunded:in_1'));
 assert.equal(m.record(fold([paid(),r('r1',5000)]),r('r1',5000)).replayed,true);
 throws(()=>m.record(fold([r('r1',5000)]),r('r1',6000)),'EVENT_CONFLICT');
});
await check('disputes: open keeps access flagged, lost voids it, won restores it, two resolutions conflict, a resolution outranks open in any order',()=>{
 const d=(id,state,dp='dp_1')=>ev({id,kind:'dispute',invoiceId:'in_1',disputeId:dp,state});
 assert.deepEqual([view([paid(),d('d1','open')],S+DAY).state,view([paid(),d('d1','open')],S+DAY).disputed],['active',true]);
 assert.equal(view([paid(),d('d1','lost')],S+DAY).state,'none');
 assert.equal(view([paid(),d('d2','lost'),d('d1','open')],S+DAY).state,'none','late "open" does not reopen a lost dispute');
 const won=view([paid(),d('d1','open'),d('d2','won')],S+DAY);assert.deepEqual([won.state,won.disputed],['active',false]);
 throws(()=>m.record(fold([d('d1','won')]),d('d2','lost')),'FACT_CONFLICT');
 throws(()=>m.record(fold([d('d1','open')]),{...d('d3','open'),invoiceId:'in_2'}),'FACT_CONFLICT');
});
await check('failed renewal: bounded grace after the interval, none without a failure, none after cancellation, none once the window passes',()=>{
 const fail=ev({id:'f1',kind:'payment_failed',subscriptionId:'sub_1',at:S+Y+1});
 assert.equal(view([paid()],S+Y+DAY).state,'none','no failure recorded, no grace');
 const g=view([paid(),fail],S+Y+DAY);assert.deepEqual([g.state,g.until],['grace',S+Y+GRACE]);
 assert.equal(view([paid(),fail],S+Y+GRACE).state,'none');
 const cancel=ev({id:'c1',kind:'cancellation',subscriptionId:'sub_1',effectiveAt:S+Y});
 assert.equal(view([paid(),fail,cancel],S+Y+DAY).state,'none');
 assert.equal(view([paid(),cancel],S+DAY).state,'active','end-of-period cancellation keeps paid access');
 assert.equal(view([paid(),fail,ev({id:'r1',kind:'refund',invoiceId:'in_1',amountCents:12000})],S+Y+DAY).state,'none','a refunded invoice earns no grace');
});
await check('the latest paid interval wins and a renewal continues seamlessly',()=>{
 const renew=paid({id:'e-paid-b',invoiceId:'in_2',startsAt:S+Y,endsAt:S+2*Y});
 assert.equal(view([paid(),renew],S+Y).invoiceId,'in_2');assert.equal(view([paid(),renew],S+Y-1).invoiceId,'in_1');
 assert.equal(view([renew,paid()],S+2*Y-1).state,'active');
});
await check('equal intervals and plans resolve the same in either order, with the same flags and reasons',()=>{
 const a=paid({id:'ea',invoiceId:'in_a'}),b=paid({id:'eb',invoiceId:'in_b'});
 const d=ev({id:'d1',kind:'dispute',invoiceId:'in_a',disputeId:'dp_1',state:'open'});
 const r=(id,inv)=>ev({id,kind:'refund',invoiceId:inv,amountCents:100});
 const set=[a,b,d,r('r1','in_a'),r('r2','in_b')];
 const want=JSON.stringify(m.entitlement(fold(set),S+DAY,GRACE));
 for(const p of perms(set))assert.equal(JSON.stringify(m.entitlement(fold(p),S+DAY,GRACE)),want);
 const got=JSON.parse(want);assert.deepEqual([got.invoiceId,got.disputed],['in_a',true]);
 const fail=ev({id:'f1',kind:'payment_failed',subscriptionId:'sub_1',at:S+Y+1});
 assert.equal(view([a,b,fail],S+Y+DAY).invoiceId,view([b,a,fail],S+Y+DAY).invoiceId);
});
await check('ids that name object internals cannot drop or reject a fact',()=>{
 for(const bad of [paid({id:'__proto__'}),paid({invoiceId:'__proto__'}),ev({id:'x',kind:'dispute',invoiceId:'in_1',disputeId:'__proto__',state:'lost'})])throws(()=>m.record(m.emptyFacts(),bad),'INVALID_INPUT');
 for(const key of ['constructor','toString','hasOwnProperty']){
  const lost=ev({id:'dl',kind:'dispute',invoiceId:'in_1',disputeId:key,state:'lost'});
  assert.equal(view([paid(),lost],S+DAY).state,'none',key+' as a dispute id records and voids');
  const full=ev({id:key,kind:'refund',invoiceId:'in_1',amountCents:12000});
  assert.equal(view([paid(),full],S+DAY).state,'none',key+' as an event id records');
  assert.equal(m.record(fold([paid(),full]),full).replayed,true);
 }
});
await check('compensating facts, failures and cancellations only touch what they name; record never mutates its input',()=>{
 const two=[paid(),paid({id:'e-paid-2',invoiceId:'in_2',subscriptionId:'sub_2',planId:'pro',startsAt:S+DAY,endsAt:S+Y+DAY})];
 const refundOther=ev({id:'r9',kind:'refund',invoiceId:'in_2',amountCents:12000});
 assert.equal(view([...two,refundOther],S+2*DAY).invoiceId,'in_1','a refund on in_2 does not void in_1');
 assert.equal(view([paid(),ev({id:'r8',kind:'refund',invoiceId:'in_2',amountCents:12000})],S+DAY).state,'active');
 const lostOther=ev({id:'dl',kind:'dispute',invoiceId:'in_2',disputeId:'dp_9',state:'lost'}),openOther=ev({id:'do',kind:'dispute',invoiceId:'in_2',disputeId:'dp_8',state:'open'});
 assert.equal(view([paid(),lostOther],S+DAY).state,'active');assert.equal(view([paid(),openOther],S+DAY).disputed,false);
 const failOther=ev({id:'fo',kind:'payment_failed',subscriptionId:'sub_9',at:S+Y+1}),failEarly=ev({id:'fe',kind:'payment_failed',subscriptionId:'sub_1',at:S+Y-1}),failLater=ev({id:'fl',kind:'payment_failed',subscriptionId:'sub_1',at:S+Y+2*DAY});
 assert.equal(view([paid(),failOther],S+Y+DAY).state,'none','another subscription failing earns no grace');
 assert.equal(view([paid(),failEarly],S+Y+DAY).state,'none','a failure before the interval ended earns no grace');
 assert.equal(view([paid(),failLater],S+Y+DAY).state,'none','a failure not yet recorded at "now" earns no grace');
 const fail=ev({id:'f1',kind:'payment_failed',subscriptionId:'sub_1',at:S+Y+1});
 assert.equal(view([paid(),fail,ev({id:'cx',kind:'cancellation',subscriptionId:'sub_9',effectiveAt:S})],S+Y+DAY).state,'grace','cancelling another subscription keeps grace');
 assert.equal(view([paid(),fail,ev({id:'cf',kind:'cancellation',subscriptionId:'sub_1',effectiveAt:S+Y+3*DAY})],S+Y+DAY).state,'grace','a cancellation not yet effective keeps grace');
 const overlap=[paid(),paid({id:'e-paid-3',invoiceId:'in_3',startsAt:S+DAY,endsAt:S+2*Y})];
 assert.equal(view(overlap,S+2*DAY).invoiceId,'in_3','the interval that ends latest wins');
 const f=fold([paid()]),before=JSON.stringify(f);m.record(f,ev({id:'r5',kind:'refund',invoiceId:'in_1',amountCents:5}));assert.equal(JSON.stringify(f),before,'record leaves the caller facts untouched');
 const reordered=ev({kind:'invoice_paid',endsAt:S+Y,startsAt:S,amountCents:12000,planId:'creator',subscriptionId:'sub_1',invoiceId:'in_1',verified:true,id:'e-paid'});
 assert.equal(m.record(f,reordered).replayed,true,'a redelivery with keys in another order is the same event');
});
await check('inputs are validated',()=>{
 throws(()=>m.record(m.emptyFacts(),paid({endsAt:S})),'INVALID_INPUT');
 throws(()=>m.record(m.emptyFacts(),paid({amountCents:1.5})),'INVALID_INPUT');
 throws(()=>m.record(m.emptyFacts(),paid({id:'bad id'})),'INVALID_INPUT');
 throws(()=>m.entitlement(m.emptyFacts(),S,-1),'INVALID_INPUT');
});
console.log(`Entitlement facts passed (${cases} cases): verified-only events, exact interval coverage, duplicate/conflict handling, order-independent convergence, compensating refunds and disputes, bounded grace; synthetic terms, no database, provider or network.`);

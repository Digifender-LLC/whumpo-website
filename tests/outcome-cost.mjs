import assert from 'node:assert/strict';
import {build} from 'esbuild';

// WH-078: cost per successful owner outcome by architecture class (src/outcome-cost.ts). Pure functions over plain data: synthetic cost events (validated by
// the real event contract) and synthetic outcome records only. No database, network, provider, model or Stripe call; nothing is wired into a route.
const bundle=await build({stdin:{contents:"export * from './src/outcome-cost';export * from './src/cost-events';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id=()=>crypto.randomUUID();
const A=id(),B=id();
let n=0;
const event=async(over={})=>{
 const e={contractVersion:1,source:'inference-receipt',sourceEventId:`ev-${++n}`,providerEventId:null,revision:1,kind:'usage',dimension:'ai.inference.call',workload:'chat-ai',workClass:'task',taskRef:'t1',attempt:1,
  attribution:{scope:'tenant',ownerId:A,projectId:null,resourceId:null},placementClass:'shared-api',quantity:{state:'known',value:1,unit:'call'},cost:{basis:'receipt',micros:1000,ref:'rcpt'},outcome:'settled',customerUnits:0,aiTier:'standard',
  detail:{inputTokens:10,outputTokens:20},occurredAt:'2026-11-01T00:00:00.000Z',observedAt:'2026-11-01T00:00:01.000Z',idempotencyKey:'',...over};
 e.idempotencyKey=await m.idempotencyKey(e);
 return m.validateCostEvent(e);
};
// An owner's outcome and its cost events: AI (observed receipt), hosting (tariff-priced requests) and, optionally, other shapes.
const hosting=(over={})=>event({source:'cloudflare-usage-import',dimension:'worker.requests',workload:'site-publication',aiTier:null,detail:{},placementClass:'shared-api',quantity:{state:'known',value:1_000_000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},...over});
const outcome=(over={})=>({ownerId:A,taskRef:'t1',outcomeClass:'composition',success:true,qualityPass:true,fallback:null,...over});
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code,String(code));
const cls=(r,c)=>r.classes.find(x=>x.outcomeClass===c);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};

await check('events attribute to the class by owner and task; categories reconcile to the class total; per-success is exact',async()=>{
 const events=[await event({taskRef:'t1'}),await hosting({taskRef:'t1'}),await event({taskRef:'t2',cost:{basis:'receipt',micros:3000,ref:'r2'}})];
 const r=m.outcomeCostReport(events,[outcome({taskRef:'t1'}),outcome({taskRef:'t2'})]);
 const c=cls(r,'composition');
 assert.equal(c.outcomes,2);assert.equal(c.succeeded,2);assert.equal(c.cost.events,3);
 assert.equal(c.cost.byCategory.reduce((s,x)=>s+x.knownMicros,0),c.cost.knownMicros,'category split adds back to the class total');
 assert.equal(c.cost.byCategory.find(x=>x.category==='inference').knownMicros,4000);
 assert.ok(c.cost.byCategory.find(x=>x.category==='hosting').knownMicros>0,'tariff cost is priced from the pinned tariff');
 assert.equal(c.microsPerSuccess,Math.floor(c.cost.knownMicros/2));
 assert.equal(r.customerUnits,0);assert.equal(cls(r,'configuration').outcomes,0);assert.equal(cls(r,'configuration').microsPerSuccess,null);
});

await check('repeats and older revisions never double count; a conflicting repeat is refused',async()=>{
 const first=await event({sourceEventId:'dup',cost:{basis:'unknown',reason:'usage-pending',exposureMicros:5000},outcome:'pending'});
 const second={...first,revision:2,cost:{basis:'receipt',micros:2500,ref:'final'},outcome:'settled'};
 const r=m.outcomeCostReport([first,first,second,first],[outcome()]);
 assert.equal(r.duplicateEventsDropped,3);assert.equal(cls(r,'composition').cost.events,1);assert.equal(cls(r,'composition').cost.knownMicros,2500);assert.equal(cls(r,'composition').cost.unknownEvents,0,'the superseded unknown is gone');
 throws(()=>m.outcomeCostReport([first,{...first,cost:{basis:'receipt',micros:9,ref:'x'}}],[outcome()]),'EVENT_CONFLICT');
});

await check('another owner\'s task of the same name is not this outcome\'s cost; unmatched events are reported apart',async()=>{
 const mine=await event({taskRef:'same'}),theirs=await event({taskRef:'same',attribution:{scope:'tenant',ownerId:B,projectId:null,resourceId:null},cost:{basis:'receipt',micros:777,ref:'b'}});
 const r=m.outcomeCostReport([mine,theirs],[outcome({taskRef:'same'})]);
 assert.equal(cls(r,'composition').cost.knownMicros,1000);assert.equal(r.unattributed.events,1);assert.equal(r.unattributed.knownMicros,777);
});

await check('unknown stays unknown, pending stays unfinished, shadow stays apart: the class is a lower bound, not a total',async()=>{
 const events=[await event({taskRef:'u'}),await event({taskRef:'u',cost:{basis:'unknown',reason:'rate-missing',exposureMicros:null},sourceEventId:'unk'}),
  await event({taskRef:'u',outcome:'pending',cost:{basis:'unknown',reason:'usage-pending',exposureMicros:200},sourceEventId:'pend'}),await event({taskRef:'u',cost:{basis:'shadow',micros:123456,ref:'s'},sourceEventId:'shadow'})];
 const c=cls(m.outcomeCostReport(events,[outcome({taskRef:'u'})]),'composition');
 assert.equal(c.cost.complete,false);assert.equal(c.cost.unknownEvents,2,'a rate-missing event and a pending one');assert.equal(c.cost.unboundedExposureEvents,1);assert.equal(c.cost.boundedExposureMicros,200);assert.equal(c.cost.unfinishedEvents,1);
 assert.equal(c.cost.shadowMicros,123456);assert.equal(c.cost.knownMicros,1000,'neither shadow nor unknown cost is added to observed cost');
});

await check('standing and platform cost is pooled overhead and is never allocated to an outcome; AI tiers are split',async()=>{
 const standing=await event({source:'cloudflare-usage-import',dimension:'worker.requests',workload:'platform-standing',workClass:'standing',taskRef:null,aiTier:null,detail:{},attribution:{scope:'platform',pool:'shared-account'},placementClass:'platform',quantity:{state:'known',value:1_000_000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}}});
 const premium=await event({taskRef:'p',aiTier:'premium',cost:{basis:'receipt',micros:9000,ref:'pr'}}),std=await event({taskRef:'p',cost:{basis:'receipt',micros:100,ref:'sd'}});
 const r=m.outcomeCostReport([standing,premium,std],[outcome({taskRef:'p',outcomeClass:'custom-component',fallback:{reason:'quality-insufficient',capability:null}})]);
 assert.equal(r.pooledOverhead.events,1);assert.equal(r.pooledOverhead.allocated,false);assert.equal(cls(r,'custom-component').cost.events,2,'only the task events');
 const tiers=Object.fromEntries(cls(r,'custom-component').cost.byAiTier.map(t=>[t.aiTier,t.knownMicros]));assert.deepEqual(tiers,{standard:100,premium:9000});
});

await check('fallbacks use closed reasons; a repeated missing capability is visible; only necessary metadata is accepted',async()=>{
 const r=m.outcomeCostReport([],[
  outcome({taskRef:'a',outcomeClass:'custom-component',fallback:{reason:'capability-missing',capability:'calendar-sync'}}),
  outcome({taskRef:'b',outcomeClass:'custom-backend',fallback:{reason:'capability-missing',capability:'calendar-sync'}}),
  outcome({taskRef:'c',outcomeClass:'dedicated-runtime',fallback:{reason:'performance',capability:null}}),
  outcome({taskRef:'d',outcomeClass:'custom-component',success:false,qualityPass:null,fallback:{reason:'capability-missing',capability:'pdf-forms'}})]);
 assert.equal(r.fallbacks.outcomes,4);assert.equal(r.fallbacks.byReason.find(x=>x.reason==='capability-missing').outcomes,3);
 assert.deepEqual(r.fallbacks.missingCapabilities,[{capability:'calendar-sync',outcomesAffected:2,repeated:true},{capability:'pdf-forms',outcomesAffected:1,repeated:false}]);
 for(const bad of [{...outcome(),prompt:'make my page blue'},{...outcome(),fallback:{reason:'because the owner said so',capability:null}},
  outcome({outcomeClass:'custom-component',fallback:{reason:'capability-missing',capability:'Needs A Calendar!'}}),outcome({outcomeClass:'custom-component',fallback:{reason:'performance',capability:'calendar-sync'}}),
  outcome({fallback:{reason:'performance',capability:null}}),outcome({success:false,qualityPass:true}),outcome({outcomeClass:'serverless-magic'}),outcome({ownerId:'not-a-uuid'}),outcome({taskRef:'has space'})])
  throws(()=>m.validateOutcome(bad),'INVALID_OUTCOME');
 throws(()=>m.outcomeCostReport([],[outcome(),outcome()]),'DUPLICATE_OUTCOME');
});

await check('classes are compared only on equivalent evidence, never as a percentage',async()=>{
 const make=async(c,count,per,over={})=>{const ev=[],out=[];for(let i=0;i<count;i++){const t=`${c}-${i}`;out.push(outcome({taskRef:t,outcomeClass:c,fallback:c==='composition'?null:{reason:'owner-choice',capability:null},...over}));ev.push(await event({taskRef:t,cost:{basis:'receipt',micros:per,ref:t}}));}return {ev,out};};
 const comp=await make('composition',6,1000),custom=await make('custom-component',6,4000);
 const r=m.outcomeCostReport([...comp.ev,...custom.ev],[...comp.out,...custom.out]);
 const cmp=m.compareClasses(r,'composition','custom-component');
 assert.equal(cmp.comparable,true);assert.equal(cmp.composition,1000);assert.equal(cmp['custom-component'],4000);assert.equal(cmp.differenceMicros,-3000);assert.ok(!JSON.stringify(cmp).includes('percent')||/no percentage/.test(cmp.note));
 const few=m.compareClasses(m.outcomeCostReport(comp.ev.slice(0,2),comp.out.slice(0,2)),'composition','custom-component');
 assert.equal(few.comparable,false);assert.ok(few.reasons.some(x=>/fewer than 5/.test(x)));
 const unassessed=await make('custom-component',6,4000,{qualityPass:null});
 const un=m.compareClasses(m.outcomeCostReport([...comp.ev,...unassessed.ev],[...comp.out,...unassessed.out]),'composition','custom-component');
 assert.equal(un.comparable,false);assert.ok(un.reasons.some(x=>/quality not assessed/.test(x)));
 const unknown=m.compareClasses(m.outcomeCostReport([...comp.ev,await event({taskRef:'custom-component-0',sourceEventId:'u9',cost:{basis:'unknown',reason:'rate-missing',exposureMicros:null}}),...custom.ev],[...comp.out,...custom.out]),'composition','custom-component');
 assert.equal(unknown.comparable,false);assert.ok(unknown.reasons.some(x=>/unknown or unfinished/.test(x)));
 throws(()=>m.compareClasses(r,'composition','composition'),'INVALID_COMPARISON');throws(()=>m.compareClasses(r,'composition','custom-component',{minSuccesses:0}),'INVALID_THRESHOLD');
});

await check('review findings: a shadow-only outcome has no observed cost, a capability token is a shape-checked word list, a reordered repeat is a repeat',async()=>{
 // 1. Five outcomes whose only events are shadow estimates must not make a class comparable with one that has observed cost.
 const ev=[],out=[];
 for(let i=0;i<5;i++){out.push(outcome({taskRef:`c${i}`,outcomeClass:'composition'}));ev.push(await event({taskRef:`c${i}`,cost:{basis:'receipt',micros:1000,ref:`c${i}`}}));}
 for(let i=0;i<5;i++){out.push(outcome({taskRef:`s${i}`,outcomeClass:'custom-component',fallback:{reason:'owner-choice',capability:null}}));ev.push(await event({taskRef:`s${i}`,cost:{basis:'shadow',micros:999999,ref:`s${i}`}}));}
 const r=m.outcomeCostReport(ev,out),sh=cls(r,'custom-component');
 assert.equal(sh.noCostEvents,5,'shadow estimates are not observed cost events');assert.equal(sh.cost.shadowMicros,5*999999);assert.equal(sh.cost.knownMicros,0);
 const cmp=m.compareClasses(r,'composition','custom-component');assert.equal(cmp.comparable,false);assert.ok(cmp.reasons.some(x=>/no cost events/.test(x)));
 // 2. A missing capability is a short word list (letters and hyphens), so a number, address-like or free text cannot be echoed into the report.
 for(const bad of ['jane-doe-555-0100','oak-street-12','Calendar','a b','x'.repeat(41),'one-two-three-four-five'])
  throws(()=>m.validateOutcome(outcome({outcomeClass:'custom-component',fallback:{reason:'capability-missing',capability:bad}})),'INVALID_OUTCOME');
 assert.doesNotThrow(()=>m.validateOutcome(outcome({outcomeClass:'custom-component',fallback:{reason:'capability-missing',capability:'calendar-sync'}})));
 // 3. The same event with its keys in another order is the same repeat, not a conflict.
 const e=await event({sourceEventId:'order'}),reordered=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(e).reverse())));
 assert.equal(m.outcomeCostReport([e,reordered],[outcome()]).duplicateEventsDropped,1);
});

await check('shared-module break-even needs measured inputs and never guesses a saving',async()=>{
 assert.deepEqual(m.breakEvenOutcomes({fixedMaintenanceMicros:10_000,customMicrosPerOutcome:4000,sharedMicrosPerOutcome:1000}),{state:'known',outcomes:4});
 assert.deepEqual(m.breakEvenOutcomes({fixedMaintenanceMicros:9_000,customMicrosPerOutcome:4000,sharedMicrosPerOutcome:1000}),{state:'known',outcomes:3});
 assert.deepEqual(m.breakEvenOutcomes({fixedMaintenanceMicros:0,customMicrosPerOutcome:4000,sharedMicrosPerOutcome:1000}),{state:'known',outcomes:0});
 assert.deepEqual(m.breakEvenOutcomes({fixedMaintenanceMicros:5,customMicrosPerOutcome:1000,sharedMicrosPerOutcome:1000}),{state:'no-saving',outcomes:null});
 assert.equal(m.breakEvenOutcomes({fixedMaintenanceMicros:null,customMicrosPerOutcome:4000,sharedMicrosPerOutcome:1000}).state,'unknown');
 assert.equal(m.breakEvenOutcomes({fixedMaintenanceMicros:5,customMicrosPerOutcome:null,sharedMicrosPerOutcome:1}).state,'unknown');
 throws(()=>m.breakEvenOutcomes({fixedMaintenanceMicros:-1,customMicrosPerOutcome:2,sharedMicrosPerOutcome:1}),'INVALID_INPUT');
});

console.log(`Outcome cost passed (${cases} cases): attribution by owner and task, category reconciliation, de-duplicated revisions, apart-reporting of unknown/unfinished/shadow, pooled overhead never allocated, closed fallback vocabulary, equivalent-evidence comparison and measured break-even; no database, provider or network.`);

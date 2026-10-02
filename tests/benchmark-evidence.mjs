import assert from 'node:assert/strict';
import {totalTaskCost,summarizeInference} from '../tools/benchmark-evidence.mjs';
const categories=['inference','acknowledgments','tools','safety','infrastructure','allocation'];
const parts=categories.map((category,i)=>({category,basis:'verified',micros:i+1}));
assert.deepEqual(totalTaskCost(parts),{knownMicros:21,unknown:[],complete:true,totalMicros:21});
assert.deepEqual(totalTaskCost(parts.map(p=>p.category==='safety'?{...p,basis:'unknown',micros:null}:p)),{knownMicros:17,unknown:['safety'],complete:false,totalMicros:null});
for(const bad of [parts.slice(1),[...parts,parts[0]],parts.map(p=>({...p,basis:'shadow'})),parts.map(p=>({...p,micros:NaN})),parts.map(p=>({...p,micros:Number.MAX_SAFE_INTEGER})),parts.map(p=>({...p,basis:'not_used'}))])assert.throws(()=>totalTaskCost(bad));
const base={role:'orchestrator',status:'observed',model:'synthetic',cost_basis:'subscription-shadow',input_tokens:100,output_tokens:10,estimated_micros:20,reserved_micros:50};
const observed=summarizeInference([base,{...base,role:'ack',estimated_micros:5},{...base,status:'uncertain',input_tokens:null,output_tokens:null,estimated_micros:null},{...base,status:'released'},{...base,cost_basis:'unpriced'}]);
assert.equal(observed.receipts,5);assert.equal(observed.roles.ack,1);assert.equal(observed.states.uncertain,1);
assert.equal(observed.observedInputTokens,300);assert.equal(observed.subscriptionShadowMicros,25);assert.equal(observed.heldShadowMicros,50);
assert.equal(observed.actualProviderExpenseMicros,null);assert.equal(observed.unknownUsageCalls,1);
for(const bad of [{...base,role:'unknown'},{...base,status:'forgotten'},{...base,input_tokens:null},{...base,cost_basis:'invoice'},{...base,model:'secret\nvalue'}])assert.throws(()=>summarizeInference([bad]));
assert.throws(()=>summarizeInference([{...base,input_tokens:Number.MAX_SAFE_INTEGER},base]));
assert.throws(()=>summarizeInference(Array.from({length:5001},()=>base)));
console.log('Benchmark evidence passed: all cost categories, unknown totals, failed/uncertain/ack call retention, synthetic-vs-expense separation and invalid/overflow rejection.');

// A successful process must not turn partial receipts or shadow prices into a
// complete benchmark. These deliberately corrupted reports remain ineligible.
const {validateFixtureBenchmark}=await import('../tools/benchmark-evidence.mjs');
const valid={version:1,id:'fixture',mode:'synthetic',inference:summarizeInference([base,{...base,role:'ack'},{...base,status:'uncertain'},{...base,status:'released'}]),transportCalls:3,runtimeCalls:null,turnStates:{completed:1,uncertain:1},costs:totalTaskCost(categories.map(category=>({category,basis:'unknown',micros:null}))),realProviderSamples:0,customerQualityScore:null,limitations:['Scripted fixture; all real expense remains unknown.']};
assert.equal(validateFixtureBenchmark(valid,'fixture'),valid);
const corruptions=[
 e=>delete e.costs,
 e=>e.version=0,
 e=>e.realProviderSamples=1,
 e=>e.customerQualityScore=1,
 e=>e.inference.roles.ack=0,
 e=>e.inference.states.uncertain=0,
 e=>e.inference.unknownUsageCalls=0,
 e=>e.inference.actualProviderExpenseMicros=e.inference.subscriptionShadowMicros,
 e=>e.inference.usageIsSynthetic=false,
 e=>e.transportCalls=2,
 e=>e.costs.unknown.pop(),
 e=>e.costs={knownMicros:0,unknown:[],complete:true,totalMicros:0},
 e=>e.prompt='private payload',
 e=>e.inference.providerToken='secret',
 e=>e.turnStates.forgotten=1,
 e=>e.inference.receipts=Number.MAX_SAFE_INTEGER,
 e=>e.inference.models=['model\nprivate'],
 e=>e.limitations=[]
];
for(const corrupt of corruptions){const e=structuredClone(valid);corrupt(e);assert.throws(()=>validateFixtureBenchmark(e,'fixture'));}
assert.throws(()=>validateFixtureBenchmark(valid,'another-fixture'));
const missingCounter=structuredClone(valid);missingCounter.transportCalls=null;assert.equal(validateFixtureBenchmark(missingCounter,'fixture').transportCalls,null);
console.log('Fixture evidence admission passed: 19 malformed/contradictory reports refused; missing independent counters remain unknown.');

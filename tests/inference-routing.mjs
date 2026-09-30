import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/inference-routing.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {planInferenceRoute,inferenceRoutingPolicy}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
// Synthetic rates and measurements, not vendor quotes or live model recommendations.
const request={ownerId:'owner',taskId:'task',catalogVersion:'fixture-v1',suite:'cms-edit-v1',role:'orchestrator',tier:'standard',protocol:'chat',requiredFeatures:['json'],allowedRegions:['us'],inputBound:1000,outputBound:1000,minSuccessBps:8000,minSamples:20,maxP95Ms:5000,now:100,remainingTaskMicros:10000,remainingAccountMicros:10000,remainingPlatformMicros:10000};
const candidate={id:'workers',provider:'cloudflare',model:'synthetic-worker-model',host:'workers-ai',premium:false,protocol:'chat',roles:['orchestrator'],features:['json'],regions:['us'],contextTokens:8000,maxOutputTokens:2000,rate:{id:'synthetic-rate',inputMicrosPerMillion:1000000,outputMicrosPerMillion:1000000,cachedInputMicrosPerMillion:0},rateValidFrom:1,rateValidUntil:200,chargesVerified:true,extraMicrosPerCall:100,benchmark:{id:'fixture-benchmark',suite:'cms-edit-v1',validUntil:200,samples:20,successes:20,usage:[{inputTokens:1000,outputTokens:1000,count:20}],calls:20,p95Ms:3000,testedInputBound:2000,testedOutputBound:2000}};
const run=(cs=[candidate],r={})=>planInferenceRoute(cs,{...request,...r});
assert.equal(run().dispatchReady,false);assert.equal(run().selected.providerReservationMicros,2100);assert.equal(run().selected.expectedMicrosPerSuccessfulTask,2100);assert.equal(run().selected.customerReservationMicros,0);
const external={...candidate,id:'external',host:'external',provider:'synthetic-provider',model:'synthetic-external-model',rate:{...candidate.rate,id:'cheaper-rate',inputMicrosPerMillion:500000,outputMicrosPerMillion:500000}};
assert.equal(run([candidate,external]).selected.candidateId,'external'); // Workers preference never overrides lower cost.
assert.equal(run([external,candidate],{}).selected.candidateId,'external');
const equal={...external,rate:candidate.rate};assert.equal(run([equal,candidate]).selected.candidateId,'workers');
// Cheaper token rates can lose after measured repair/failure costs.
const repairs={...external,benchmark:{...candidate.benchmark,calls:40,usage:[{inputTokens:1000,outputTokens:1000,count:40}],successes:16}};
assert.equal(run([repairs,candidate]).selected.candidateId,'workers');
for(const [patch,reason] of [[{premium:true},'tier'],[{roles:['normal']},'role'],[{protocol:'responses'},'protocol'],[{features:[]},'capability'],[{regions:['us','eu']},'region'],[{contextTokens:1999},'context'],[{maxOutputTokens:999},'context'],[{chargesVerified:false},'rate_unverified'],[{rateValidUntil:100},'rate_expired'],[{rateValidFrom:101},'rate_expired'],[{benchmark:{...candidate.benchmark,suite:'other-suite'}},'benchmark'],[{benchmark:{...candidate.benchmark,samples:20,successes:15,calls:20}},'quality'],[{benchmark:{...candidate.benchmark,p95Ms:5001}},'latency']]){const result=run([{...candidate,...patch}]);assert.equal(result.selected,null);assert.equal(result.rejected[0].reason,reason);}
for(const field of ['remainingTaskMicros','remainingAccountMicros','remainingPlatformMicros'])assert.equal(run(undefined,{[field]:2099}).rejected[0].reason,'provider_budget');
const premium={...candidate,id:'premium',premium:true};
const approval={approvalId:'approval',ownerId:'owner',taskId:'task',catalogVersion:'fixture-v1',policy:inferenceRoutingPolicy,expiresAt:200,candidateIds:['premium'],tariffId:'synthetic-tariff',retailMultiplierBps:15000,maxCustomerMicros:3150,remainingCustomerMicros:3150};
assert.equal(run([premium],{tier:'premium'}).rejected[0].reason,'premium_approval');
const approved=run([premium],{tier:'premium',premium:approval});assert.equal(approved.selected.customerReservationMicros,3150);assert.equal(approved.selected.providerReservationMicros,2100);assert.equal(approved.selected.approvalId,'approval');
for(const patch of [{ownerId:'someone-else'},{taskId:'other-task'},{catalogVersion:'stale'},{policy:'stale'},{expiresAt:100},{candidateIds:['other']},{maxCustomerMicros:3149},{remainingCustomerMicros:3149}])assert.equal(run([premium],{tier:'premium',premium:{...approval,...patch}}).rejected[0].reason,'premium_approval');
assert.equal(run([candidate],{tier:'premium',premium:approval}).selected,null); // Explicit premium work is not silently substituted.
assert.equal(run([premium],{premium:approval}).selected,null); // A saved approval does not turn standard work into premium work.
assert.throws(()=>run([candidate,candidate]));assert.throws(()=>run([{...candidate,rate:{...candidate.rate,inputMicrosPerMillion:-1}}]));assert.throws(()=>run(undefined,{inputBound:NaN}));assert.throws(()=>run(undefined,{allowedRegions:[]}));assert.throws(()=>run([{...candidate,benchmark:{...candidate.benchmark,usage:[{inputTokens:0,outputTokens:10,count:20}]}}]));assert.throws(()=>run(undefined,{premium:{...approval,retailMultiplierBps:9999}}));
const unknown={...candidate,apiKey:'secret-canary',endpoint:'https://secret-canary.test'};assert.ok(!JSON.stringify(run([unknown])).includes('secret-canary'));
// Per-call rounding must match ledger arithmetic, not a rounded aggregate token bill.
const tiny={...candidate,extraMicrosPerCall:0,rate:{id:'tiny-rate',inputMicrosPerMillion:1,outputMicrosPerMillion:1},benchmark:{...candidate.benchmark,usage:[{inputTokens:1,outputTokens:0,count:20}]}};
assert.equal(run([tiny]).selected.expectedMicrosPerSuccessfulTask,1);
for(const patch of [{validUntil:100},{testedInputBound:999},{testedOutputBound:999}])assert.equal(run([{...candidate,benchmark:{...candidate.benchmark,...patch}}]).rejected[0].reason,'benchmark');
assert.throws(()=>run([{...candidate,benchmark:{...candidate.benchmark,calls:21}}]));
const rounded=run([{...premium,extraMicrosPerCall:101}],{tier:'premium',premium:{...approval,maxCustomerMicros:4000,remainingCustomerMicros:4000}});assert.equal(rounded.selected.customerReservationMicros,3152);
const original=JSON.stringify(candidate);const decision=run();decision.selected.rate.id='changed';assert.equal(JSON.stringify(candidate),original);
console.log('Inference route planning passed: quality-adjusted cost, Workers tie preference, no cache assumption, protocol/capability/region/rate/benchmark gates, all budget bounds, scoped premium approval, separate retail cost and non-dispatchable decisions.');

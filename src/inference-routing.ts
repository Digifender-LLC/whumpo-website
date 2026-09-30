import {inferenceCost,type ModelRole,type RateCard} from './model-policy';

/** Offline beta route planning. This module neither authorizes nor dispatches inference. */
export const inferenceRoutingPolicy='gateway-cost-routing-v1';
export type RouteCandidate={
 id:string;provider:string;model:string;host:'workers-ai'|'external';premium:boolean;
 protocol:'chat'|'responses';roles:ModelRole[];features:string[];regions:string[];
 contextTokens:number;maxOutputTokens:number;rate:RateCard;
 rateValidFrom:number;rateValidUntil:number;chargesVerified:boolean;extraMicrosPerCall:number;
 benchmark:{id:string;suite:string;validUntil:number;samples:number;successes:number;usage:{inputTokens:number;outputTokens:number;count:number}[];calls:number;p95Ms:number;testedInputBound:number;testedOutputBound:number};
};
export type RouteRequest={
 ownerId:string;taskId:string;catalogVersion:string;suite:string;role:ModelRole;tier:'standard'|'premium';protocol:'chat'|'responses';
 requiredFeatures:string[];allowedRegions:string[];inputBound:number;outputBound:number;
 minSuccessBps:number;minSamples:number;maxP95Ms:number;now:number;
 remainingTaskMicros:number;remainingAccountMicros:number;remainingPlatformMicros:number;
 premium?:{approvalId:string;ownerId:string;taskId:string;catalogVersion:string;policy:string;expiresAt:number;candidateIds:string[];tariffId:string;retailMultiplierBps:number;maxCustomerMicros:number;remainingCustomerMicros:number};
};
type Reason='tier'|'role'|'protocol'|'capability'|'region'|'context'|'rate_unverified'|'rate_expired'|'benchmark'|'quality'|'latency'|'provider_budget'|'premium_approval';
const integer=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid inference route value');};
const label=(v:string)=>{if(typeof v!=='string'||!v.length||v.length>200||/[\x00-\x1f]/.test(v))throw Error('Invalid inference route identity');};
const labels=(vs:string[])=>{if(!Array.isArray(vs)||vs.length>40)throw Error('Invalid inference route list');for(const v of vs)label(v);if(new Set(vs).size!==vs.length)throw Error('Duplicate inference route value');};
function safe(value:bigint){if(value>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Inference route cost overflow');return Number(value);}
function retail(providerMicros:number,multiplierBps:number){return safe((BigInt(providerMicros)*BigInt(multiplierBps)+9999n)/10000n);}
function validateRequest(r:RouteRequest){
 for(const v of [r.ownerId,r.taskId,r.catalogVersion,r.suite])label(v);
 labels(r.requiredFeatures);labels(r.allowedRegions);
 for(const v of [r.inputBound,r.outputBound,r.minSuccessBps,r.minSamples,r.maxP95Ms,r.now,r.remainingTaskMicros,r.remainingAccountMicros,r.remainingPlatformMicros])integer(v);
 if(!['standard','premium'].includes(r.tier)||!['ack','orchestrator','normal','advanced'].includes(r.role)||!['chat','responses'].includes(r.protocol)||!r.allowedRegions.length||!r.inputBound||!r.outputBound||r.minSuccessBps<1||r.minSuccessBps>10000||r.minSamples<1||!r.maxP95Ms)throw Error('Invalid inference route requirements');
 if(r.premium){const p=r.premium;for(const v of [p.approvalId,p.ownerId,p.taskId,p.catalogVersion,p.policy,p.tariffId])label(v);labels(p.candidateIds);for(const v of [p.expiresAt,p.retailMultiplierBps,p.maxCustomerMicros,p.remainingCustomerMicros])integer(v);if(p.retailMultiplierBps<10000)throw Error('Invalid premium tariff');}
}
function validateCandidate(c:RouteCandidate){
 for(const v of [c.id,c.provider,c.model,c.rate.id,c.benchmark.id,c.benchmark.suite])label(v);
 for(const vs of [c.roles,c.features,c.regions])labels(vs);
 if(!['workers-ai','external'].includes(c.host)||typeof c.premium!=='boolean'||typeof c.chargesVerified!=='boolean'||!['chat','responses'].includes(c.protocol)||c.roles.some(r=>!['ack','orchestrator','normal','advanced'].includes(r)))throw Error('Invalid inference route candidate');
 for(const v of [c.contextTokens,c.maxOutputTokens,c.rateValidFrom,c.rateValidUntil,c.extraMicrosPerCall,...Object.entries(c.benchmark).filter(([k])=>!['id','suite','usage'].includes(k)).map(([,v])=>v as number)])integer(v);
 inferenceCost(c.rate,0,0); // Validate all rates even when a candidate is excluded.
 const b=c.benchmark;
 if(!Array.isArray(b.usage)||!b.usage.length||b.usage.length>1000)throw Error('Invalid benchmark usage');
 let calls=0n;for(const u of b.usage){for(const n of [u.inputTokens,u.outputTokens,u.count])integer(n);if(!u.count||!u.inputTokens)throw Error('Invalid benchmark call');calls+=BigInt(u.count);}
 if(calls!==BigInt(b.calls))throw Error('Incomplete benchmark call accounting');
 if(!b.samples||!b.calls||!b.p95Ms||b.successes>b.samples||b.calls<b.samples||c.rateValidUntil<=c.rateValidFrom)throw Error('Invalid inference benchmark or rate window');
}
/** Trusted catalogue/budget/approval snapshots only. Never pass model tool arguments here. */
export function planInferenceRoute(candidates:RouteCandidate[],r:RouteRequest){
 validateRequest(r);if(!Array.isArray(candidates)||candidates.length>100)throw Error('Invalid inference route catalogue');
 const rejected:{id:string;reason:Reason}[]=[],eligible:{candidate:RouteCandidate;providerBound:number;customerBound:number;observedCost:bigint}[]=[];
 const seen=new Set<string>();
 for(const c of candidates){
  validateCandidate(c);if(seen.has(c.id))throw Error('Duplicate inference route ID');seen.add(c.id);
  const b=c.benchmark;
  let reason:Reason|undefined;
  if(c.premium!==(r.tier==='premium'))reason='tier';
  else if(!c.roles.includes(r.role))reason='role';
  else if(c.protocol!==r.protocol)reason='protocol';
  else if(r.requiredFeatures.some(f=>!c.features.includes(f)))reason='capability';
  // Every possible processing region must be allowed; intersection alone is insufficient.
  else if(!c.regions.length||c.regions.some(region=>!r.allowedRegions.includes(region)))reason='region';
  else if(BigInt(r.inputBound)+BigInt(r.outputBound)>BigInt(c.contextTokens)||r.outputBound>c.maxOutputTokens)reason='context';
  else if(!c.chargesVerified)reason='rate_unverified';
  else if(r.now<c.rateValidFrom||r.now>=c.rateValidUntil)reason='rate_expired';
  else if(b.suite!==r.suite||b.validUntil<=r.now||b.samples<r.minSamples||b.testedInputBound<r.inputBound||b.testedOutputBound<r.outputBound)reason='benchmark';
  else if(!b.successes||BigInt(b.successes)*10000n<BigInt(b.samples)*BigInt(r.minSuccessBps))reason='quality';
  else if(b.p95Ms>r.maxP95Ms)reason='latency';
  if(reason){rejected.push({id:c.id,reason});continue;}
  const providerBound=safe(BigInt(inferenceCost(c.rate,r.inputBound,r.outputBound))+BigInt(c.extraMicrosPerCall));
  if([r.remainingTaskMicros,r.remainingAccountMicros,r.remainingPlatformMicros].some(limit=>providerBound>limit)){rejected.push({id:c.id,reason:'provider_budget'});continue;}
  let customerBound=0;
  if(c.premium){
   const p=r.premium;
   if(!p||p.ownerId!==r.ownerId||p.taskId!==r.taskId||p.catalogVersion!==r.catalogVersion||p.policy!==inferenceRoutingPolicy||p.expiresAt<=r.now||!p.candidateIds.includes(c.id)){rejected.push({id:c.id,reason:'premium_approval'});continue;}
   customerBound=retail(providerBound,p.retailMultiplierBps);
   if(customerBound>p.maxCustomerMicros||customerBound>p.remainingCustomerMicros){rejected.push({id:c.id,reason:'premium_approval'});continue;}
  }
  // Compare observed billable cost per successful benchmark task. All failed/repair
  // calls belong in the benchmark totals. Cache discounts are not assumed.
  const observedCost=b.usage.reduce((sum,u)=>sum+(BigInt(inferenceCost(c.rate,u.inputTokens,u.outputTokens))+BigInt(c.extraMicrosPerCall))*BigInt(u.count),0n);
  eligible.push({candidate:c,providerBound,customerBound,observedCost});
 }
 eligible.sort((a,b)=>{
  const left=a.observedCost*BigInt(b.candidate.benchmark.successes),right=b.observedCost*BigInt(a.candidate.benchmark.successes);
  if(left!==right)return left<right?-1:1;
  if(a.candidate.host!==b.candidate.host)return a.candidate.host==='workers-ai'?-1:1;
  return a.candidate.id<b.candidate.id?-1:a.candidate.id>b.candidate.id?1:0;
 });
 const winner=eligible[0];
 if(!winner)return {policy:inferenceRoutingPolicy,dispatchReady:false as const,selected:null,rejected};
 const c=winner.candidate,p=c.premium?r.premium:undefined;
 return {policy:inferenceRoutingPolicy,dispatchReady:false as const,selected:{
  candidateId:c.id,provider:c.provider,model:c.model,host:c.host,protocol:c.protocol,
  catalogVersion:r.catalogVersion,tier:r.tier,role:r.role,ownerId:r.ownerId,taskId:r.taskId,
  reason:'lowest_observed_cost_at_required_quality' as const,benchmarkId:c.benchmark.id,
  rate:{id:c.rate.id,inputMicrosPerMillion:c.rate.inputMicrosPerMillion,outputMicrosPerMillion:c.rate.outputMicrosPerMillion},
  extraMicrosPerCall:c.extraMicrosPerCall,rateValidUntil:c.rateValidUntil,
  inputBound:r.inputBound,outputBound:r.outputBound,providerReservationMicros:winner.providerBound,
  customerReservationMicros:winner.customerBound,
  approvalId:p?.approvalId??null,tariffId:p?.tariffId??null,
  expectedMicrosPerSuccessfulTask:safe((winner.observedCost+BigInt(c.benchmark.successes)-1n)/BigInt(c.benchmark.successes)),
 },rejected};
}

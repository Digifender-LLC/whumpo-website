// Offline benchmark support. Accepts only an injected disposable fixture DB.
// Never imports operator credentials or selects prompts, source, tokens or IDs.
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const count=n=>Number.isSafeInteger(n)&&n>=0;
const requireValid=ok=>{if(!ok)throw Error('Invalid benchmark evidence');};
const categories=['inference','acknowledgments','tools','safety','infrastructure','allocation'];
export function totalTaskCost(components) {
  requireValid(Array.isArray(components)&&components.length===categories.length);
  const seen=new Set(),unknown=[];let knownMicros=0;
  for(const item of components){
    requireValid(item&&categories.includes(item.category)&&!seen.has(item.category));seen.add(item.category);
    requireValid(['verified','not_used','unknown'].includes(item.basis));
    if(item.basis==='unknown'){requireValid(item.micros===null);unknown.push(item.category);continue;}
    requireValid(count(item.micros)&&(item.basis!=='not_used'||item.micros===0));
    knownMicros+=item.micros;requireValid(count(knownMicros));
  }
  return {knownMicros,unknown,complete:unknown.length===0,totalMicros:unknown.length?null:knownMicros};
}
export function summarizeInference(rows) {
  requireValid(Array.isArray(rows)&&rows.length<=5000);
  const roles={},states={},models=new Set();let input=0,output=0,unknownUsage=0,shadow=0,heldShadow=0;
  for(const row of rows){
    requireValid(['orchestrator','ack'].includes(row.role)&&['reserved','dispatched','observed','released','uncertain'].includes(row.status));
    requireValid(['subscription-shadow','unpriced'].includes(row.cost_basis));
    requireValid(typeof row.model==='string'&&row.model.length<=100&&/^[a-zA-Z0-9_.:/-]+$/.test(row.model));
    models.add(row.model);roles[row.role]=(roles[row.role]??0)+1;states[row.status]=(states[row.status]??0)+1;
    if(row.status==='observed'){
      requireValid(count(row.input_tokens)&&count(row.output_tokens));input+=row.input_tokens;output+=row.output_tokens;
      if(row.cost_basis==='subscription-shadow'){requireValid(count(row.estimated_micros));shadow+=row.estimated_micros;}
    }else if(row.status!=='released'){
      unknownUsage++;
      if(row.cost_basis==='subscription-shadow'){requireValid(count(row.reserved_micros));heldShadow+=row.reserved_micros;}
    }
    for(const n of [input,output,shadow,heldShadow])requireValid(count(n));
  }
  return {receipts:rows.length,roles,states,models:[...models].sort(),observedInputTokens:input,observedOutputTokens:output,
    unknownUsageCalls:unknownUsage,subscriptionShadowMicros:shadow,heldShadowMicros:heldShadow,
    actualProviderExpenseMicros:null,usageIsSynthetic:true};
}
export async function recordFixtureBenchmark(db,id,{transportCalls=null,runtimeCalls=null}={}) {
  if(!process.env.WHUMPO_BENCHMARK_DIR)return;
  requireValid(/^[a-z0-9-]+$/.test(id)&&[transportCalls,runtimeCalls].every(n=>n===null||count(n)));
  const {results}=await db.prepare(`SELECT role,status,model,cost_basis,input_tokens,output_tokens,
    estimated_micros,reserved_micros FROM inference_calls LIMIT 5001`).all();
  const inference=summarizeInference(results);
  // A released reservation was never sent. Every other row must have a matching
  // transport call when that fixture independently counts dispatches.
  const dispatched=inference.receipts-(inference.states.reserved??0)-(inference.states.released??0);
  if(transportCalls!==null)requireValid(transportCalls===dispatched);
  const {results:turns}=await db.prepare("SELECT status,COUNT(*) count FROM chat_turns WHERE mode='ai' GROUP BY status").all();
  const turnStates={};for(const row of turns){requireValid(['pending','completed','failed','uncertain'].includes(row.status)&&count(row.count));turnStates[row.status]=row.count;}
  const evidence={version:1,id,mode:'synthetic',inference,transportCalls,runtimeCalls,turnStates,
    costs:totalTaskCost(categories.map(category=>({category,basis:'unknown',micros:null}))),
    realProviderSamples:0,customerQualityScore:null,
    limitations:['Simulated provider replies and token counts; no real-model quality or expense measurement.',
      'Includes every retained fixture inference receipt, including acknowledgments, failures and uncertain calls; no success-only cost selection.',
      'Fixture assertion/negative-case overhead is included; harness duration is not customer request latency.',
      'Tools, safety, infrastructure and subscription allocation are unpriced; unknown is not zero.']};
  await writeFile(join(process.env.WHUMPO_BENCHMARK_DIR,id+'.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
}

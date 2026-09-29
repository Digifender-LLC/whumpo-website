import type { AIConfig, Completion } from './ai';
import { inferenceCost, museTestRoute } from './model-policy';
import { internalAITargetCents } from './plans';

export async function ensureInferenceBudget(db: D1Database, user: string, period: string, plan: string) {
  // Explore owner testing uses the same $20 planning ceiling; no provider API charge is claimed.
  const target = internalAITargetCents[plan as keyof typeof internalAITargetCents] ?? 2000;
  await db.prepare('INSERT INTO inference_budgets(user_id,period,budget_micros) VALUES(?,?,?) ON CONFLICT(user_id,period) DO UPDATE SET budget_micros=MAX(budget_micros,excluded.budget_micros)').bind(user,period,target*10000).run();
  // A reservation not dispatched can be released after the existing usage reconciler closes it.
  await db.prepare("UPDATE inference_calls SET status='released' WHERE user_id=? AND status='reserved' AND EXISTS(SELECT 1 FROM usage_operations o WHERE o.id=inference_calls.turn_id AND o.status='released')").bind(user).run();
}
export function inferenceReservation(db: D1Database, user: string, id: string, period: string, config: AIConfig, inputBound: number, outputBound: number, role: 'orchestrator' | 'ack' = 'orchestrator') {
  // Non-Muse configs are used by offline transport tests. They are explicitly unpriced.
  const muse = config.baseURL.replace(/\/$/,'')==='https://opencode.ai/zen/go/v1' && config.model==='muse-spark-1.3-contributor';
  const route = muse ? museTestRoute(config,role) : null;
  const rate = route?.rate ?? {id:'unpriced',inputMicrosPerMillion:0,outputMicrosPerMillion:0};
  const quote = inferenceCost(rate,inputBound,outputBound);
  return db.prepare(`INSERT INTO inference_calls(id,turn_id,user_id,period,role,model,provider_origin,protocol,policy,cost_basis,rate_id,input_rate,output_rate,reserved_micros)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=? AND status='pending') ON CONFLICT(id) DO NOTHING`)
    .bind(role==='ack'?id+':ack':id,id,user,period,role,config.model,new URL(config.baseURL).origin,config.protocol??'chat',route?.policy??'offline-unpriced',route?.costBasis??'unpriced',rate.id,rate.inputMicrosPerMillion,rate.outputMicrosPerMillion,quote,id,user);
}
export async function dispatchInference(db: D1Database, user: string, id: string) {
  const result=await db.prepare("UPDATE inference_calls SET status='dispatched' WHERE id=? AND user_id=? AND status='reserved'").bind(id,user).run();
  return result.meta.changes===1;
}
export async function observeInference(db: D1Database, user: string, id: string, result: Completion, ackText?: string) {
  const row=await db.prepare('SELECT rate_id,input_rate,output_rate,status,input_tokens,output_tokens FROM inference_calls WHERE id=? AND user_id=?').bind(id,user).first<{rate_id:string;input_rate:number;output_rate:number;status:string;input_tokens:number|null;output_tokens:number|null}>();
  if(!row)throw Error('Missing inference receipt');
  if(row.status==='observed') {if(row.input_tokens!==result.inputTokens||row.output_tokens!==result.outputTokens)throw Error('Inference receipt mismatch');return;}
  const cost=inferenceCost({id:row.rate_id,inputMicrosPerMillion:row.input_rate,outputMicrosPerMillion:row.output_rate},result.inputTokens,result.outputTokens);
  await db.prepare("UPDATE inference_calls SET status='observed',input_tokens=?,output_tokens=?,estimated_micros=?,ack_text=? WHERE id=? AND user_id=? AND status IN ('dispatched','uncertain')").bind(result.inputTokens,result.outputTokens,cost,ackText??null,id,user).run();
}
export async function uncertainInference(db:D1Database,user:string,id:string) {
  await db.prepare("UPDATE inference_calls SET status='uncertain' WHERE id=? AND user_id=? AND status='dispatched'").bind(id,user).run();
}

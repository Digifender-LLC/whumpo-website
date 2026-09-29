import type { AIConfig } from './ai';

export type ModelRole = 'ack' | 'orchestrator' | 'normal' | 'advanced';
export type RateCard = { id: string; inputMicrosPerMillion: number; outputMicrosPerMillion: number; cachedInputMicrosPerMillion?: number };
// USD micros: 1 dollar = 1,000,000. Planning assumptions from the owner's supplied discussion,
// NOT verified provider prices or an invoice. No cache savings assumed in admission.
export const planningRates = {
  ack: { id: 'planning-ack-v1', inputMicrosPerMillion: 100_000, outputMicrosPerMillion: 200_000 },
  orchestrator: { id: 'planning-chat-v1', inputMicrosPerMillion: 50_000, outputMicrosPerMillion: 100_000 },
  normal: { id: 'planning-normal-v1', inputMicrosPerMillion: 100_000, outputMicrosPerMillion: 200_000 },
  advanced: { id: 'planning-advanced-long-term-v1', inputMicrosPerMillion: 1_500_000, outputMicrosPerMillion: 7_500_000 }
} satisfies Record<ModelRole, RateCard>;
export const museTestRate: RateCard = { ...planningRates.normal, id: 'muse-test-shadow-v1' };
export const routingPolicy = Object.freeze({ maxConcurrentSubagents: 2, advancedCalls30Days: 150, advancedCalls24Hours: 20, maximumMonthlyMicros: 20_000_000 });
function integer(value: number) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid model cost value'); }
export function inferenceCost(rate: RateCard, input: number, output: number, cached = 0): number {
  for (const n of [input,output,cached,rate.inputMicrosPerMillion,rate.outputMicrosPerMillion]) integer(n);
  if (cached > input) throw new Error('Invalid cached usage');
  const cacheRate = rate.cachedInputMicrosPerMillion ?? rate.inputMicrosPerMillion; integer(cacheRate);
  const numerator = BigInt(input-cached)*BigInt(rate.inputMicrosPerMillion)+BigInt(cached)*BigInt(cacheRate)+BigInt(output)*BigInt(rate.outputMicrosPerMillion);
  const result = (numerator+999_999n)/1_000_000n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Model cost overflow');
  return Number(result);
}
export type EvaluatorEvidence = {
  normalAttemptFailed: boolean; failedFixAttempts: number; testsStillFailing: boolean;
  lowConfidence: boolean; capabilityMismatch: boolean; repeatedInvalidTools: boolean;
  unexpectedDeployment: boolean; requestedEscalation: boolean;
  necessity: 'low' | 'medium' | 'high'; alreadyStartedCritical: boolean; transientFailureOnly: boolean;
};
/** Called by the trusted evaluator, never with unvalidated customer/model tool arguments. */
export function evaluateEscalation(e: EvaluatorEvidence, remainingMicros: number, budgetMicros: number) {
  integer(remainingMicros); integer(budgetMicros); integer(e.failedFixAttempts);
  if (!budgetMicros || remainingMicros > budgetMicros) throw new Error('Invalid model budget');
  if (!e.normalAttemptFailed || e.transientFailureOnly) return { allowed: false, reason: 'normal_failure_required' };
  const signal = (e.failedFixAttempts >= 2 && e.testsStillFailing) || e.lowConfidence || e.capabilityMismatch || e.repeatedInvalidTools || e.unexpectedDeployment || e.requestedEscalation;
  if (!signal) return { allowed: false, reason: 'insufficient_evidence' };
  if (!remainingMicros) return { allowed: false, reason: 'budget_exhausted' };
  const fraction = remainingMicros / budgetMicros;
  if (fraction < .1 && !(e.alreadyStartedCritical && e.necessity === 'high')) return { allowed: false, reason: 'critical_completion_only' };
  if (fraction < .25 && e.necessity !== 'high') return { allowed: false, reason: 'high_necessity_required' };
  if (fraction <= .5 && e.necessity === 'low') return { allowed: false, reason: 'selective_escalation' };
  return { allowed: true, reason: 'evaluator_approved' };
}
/** All roles deliberately resolve to the same model during owner testing. No paid fallback. */
export function museTestRoute(config: AIConfig, role: ModelRole = 'orchestrator') {
  if (!['ack','orchestrator','normal','advanced'].includes(role) || config.baseURL.replace(/\/$/,'') !== 'https://opencode.ai/zen/go/v1' || config.model !== 'muse-spark-1.3-contributor') throw new Error('Muse-only testing policy');
  return { config, role, policy: 'muse-only-v1', costBasis: 'subscription-shadow' as const, rate: museTestRate };
}

/** Dispatch gate for the future task runner. Counters must come from atomic, server-owned receipts. */
export function subagentAdmission(role: 'normal' | 'advanced', state: { activeSubagents: number; advanced30Days: number; advanced24Hours: number; remainingMicros: number; budgetMicros: number; quotedMicros: number }, evidence?: EvaluatorEvidence) {
  for(const value of Object.values(state)) integer(value);
  if (!['normal','advanced'].includes(role)) return {allowed:false,reason:'invalid_role'};
  if(state.activeSubagents>=routingPolicy.maxConcurrentSubagents)return {allowed:false,reason:'concurrency_limit'};
  if(state.quotedMicros>state.remainingMicros || !state.remainingMicros)return {allowed:false,reason:'budget_exhausted'};
  if(role==='normal')return {allowed:true,reason:'normal_route'};
  if(state.advanced30Days>=routingPolicy.advancedCalls30Days || state.advanced24Hours>=routingPolicy.advancedCalls24Hours)return {allowed:false,reason:'advanced_call_limit'};
  if(!evidence)return {allowed:false,reason:'evaluator_required'};
  return evaluateEscalation(evidence,state.remainingMicros,state.budgetMicros);
}

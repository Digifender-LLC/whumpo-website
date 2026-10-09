// WH-169: pure adapters from the three existing receipt tables to validated cost events (docs/cost-events.md, "Existing producers
// mapped onto the envelope"). Each adapter reads the named columns of ONE row and returns an event; it performs no D1 read or
// write, does not touch model-costs, gateway-spend or storage-budget behavior and is not called by any route. Emission at receipt
// transitions, storage and replay are WH-170. A malformed row is refused with a specific code and never repaired or guessed:
// a missing figure stays an explicit unknown, a pending or uncertain call keeps its reserved hold as exposure, and customer
// figures (`customer_actual`, `customer_reserved`) and text (`ack_text`) are never read.
import { contractVersion, CostEventError, idempotencyKey, validateCostEvent, type AITier, type Cost, type CostEvent, type Outcome, type Quantity } from './cost-events';

const bad = (detail: string): never => { throw new CostEventError('INVALID_RECEIPT', detail); };
function count(v: unknown, what: string, min = 0): number {
 if (typeof v !== 'number' || !Number.isInteger(v)) return bad(`${what} must be an integer`);
 if (!Number.isSafeInteger(v)) throw new CostEventError('AMOUNT_UNSAFE', `${what} is outside the exactly representable range and is refused rather than rounded`);
 return v >= min ? v : bad(`${what} must be at least ${min}`);
}
const rowOf = (v: unknown, what: string): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad(`${what} must be a row object`);
const label = (v: unknown, what: string): string => typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : bad(`${what} must be a non-empty string of at most 128 characters`);
// Revisions follow the receipt state machines, which only move forward, so arrival order cannot change the current state.
// Both tables share the vocabulary; the gateway calls its terminal observed state `settled`.
const lifecycle = { reserved: [1, 'pending'], dispatched: [2, 'pending'], uncertain: [3, 'uncertain'], observed: [4, 'settled'], released: [4, 'released'] } as const satisfies Record<string, readonly [number, Outcome]>;
type Lifecycle = keyof typeof lifecycle;
function lifecycleOf(status: unknown, vocabulary: readonly string[]): Lifecycle {
 if (typeof status !== 'string' || !vocabulary.includes(status)) throw new CostEventError('UNKNOWN_STATUS', String(status));
 return (status === 'settled' ? 'observed' : status) as Lifecycle;
}

type Facts = {
 source: 'inference-receipt' | 'gateway-settlement'; status: Lifecycle; sourceEventId: string; providerEventId: string | null; ownerId: string; taskRef: string; control: boolean;
 rateRef: string; reservedMicros: number; inputTokens: number | null; outputTokens: number | null; actualMicros: number | null; basis: 'shadow' | 'receipt' | 'unpriced';
 occurredAt: string; observedAt: string; aiTier: AITier;
};
async function inferenceEvent(f: Facts): Promise<CostEvent> {
 const [revision, outcome] = lifecycle[f.status];
 let quantity: Quantity, cost: Cost;
 if (f.status === 'observed') {
  quantity = { state: 'known', value: 1, unit: 'call' };
  cost = f.basis === 'unpriced' ? { basis: 'unknown', reason: 'unpriced', exposureMicros: null } : { basis: f.basis, micros: f.actualMicros!, ref: f.rateRef };
 } else if (f.status === 'released') { quantity = { state: 'known', value: 0, unit: 'call' }; cost = { basis: 'receipt', micros: 0, ref: f.rateRef }; }
 else {
  const unknown = f.status === 'uncertain' ? 'outcome-unknown' : 'usage-pending';
  quantity = { state: 'unknown', reason: unknown }; cost = { basis: 'unknown', reason: unknown, exposureMicros: f.reservedMicros };
 }
 const event: CostEvent = {
  contractVersion, source: f.source, sourceEventId: f.sourceEventId, providerEventId: f.providerEventId, revision, idempotencyKey: '', kind: 'usage', dimension: 'ai.inference.call', workload: 'chat-ai',
  workClass: f.control ? 'control' : 'task', taskRef: f.taskRef, attempt: 1, attribution: { scope: 'tenant', ownerId: f.ownerId, projectId: null, resourceId: null }, placementClass: 'platform',
  quantity, cost, outcome, customerUnits: 0, aiTier: f.aiTier, detail: f.status === 'observed' ? { inputTokens: f.inputTokens!, outputTokens: f.outputTokens! } : {}, occurredAt: f.occurredAt, observedAt: f.observedAt
 };
 event.idempotencyKey = await idempotencyKey(event);
 return validateCostEvent(event);
}
// The schema checks of both receipt tables: tokens and the actual figure exist exactly when the call is observed.
function figures(row: Record<string, unknown>, observed: boolean, tokens: [string, string], actual: string) {
 const names = [tokens[0], tokens[1], actual];
 if (!observed) { for (const n of names) if (row[n] !== null) bad(`${n} must be null until the call is observed`); return { input: null, output: null, actual: null }; }
 return { input: count(row[tokens[0]], tokens[0]), output: count(row[tokens[1]], tokens[1]), actual: count(row[actual], actual) };
}

/**
 * Row of `inference_calls` (src/model-costs.ts; Chat orchestrator and acknowledgment). The table keeps no per-status timestamp, so
 * `observedAt` is `created_at` (gap G-C2) and a Chat turn has no project or resource (G-C1). The cost is the `subscription-shadow`
 * estimate, never provider expense; an `unpriced` call is an unbounded unknown.
 */
export type InferenceCallRow = {
 id: string; turn_id: string; user_id: string; role: string; status: string; cost_basis: string; rate_id: string; reserved_micros: number;
 input_tokens: number | null; output_tokens: number | null; estimated_micros: number | null; created_at: string;
};
export async function costEventFromInferenceCall(input: InferenceCallRow): Promise<CostEvent> {
 const row = rowOf(input, 'inference_calls row');
 const status = lifecycleOf(row.status, ['reserved', 'dispatched', 'observed', 'released', 'uncertain']);
 if (row.role !== 'ack' && row.role !== 'orchestrator' && row.role !== 'normal' && row.role !== 'advanced') bad(`role ${String(row.role)} is not an inference role`);
 if (row.cost_basis !== 'subscription-shadow' && row.cost_basis !== 'unpriced') throw new CostEventError('UNKNOWN_COST_BASIS', String(row.cost_basis));
 const { input: inputTokens, output: outputTokens, actual } = figures(row, status === 'observed', ['input_tokens', 'output_tokens'], 'estimated_micros');
 return inferenceEvent({
  source: 'inference-receipt', status, sourceEventId: label(row.id, 'id'), providerEventId: null, ownerId: label(row.user_id, 'user_id'), taskRef: label(row.turn_id, 'turn_id'), control: row.role === 'ack',
  rateRef: label(row.rate_id, 'rate_id'), reservedMicros: count(row.reserved_micros, 'reserved_micros'), inputTokens, outputTokens, actualMicros: actual,
  basis: row.cost_basis === 'subscription-shadow' ? 'shadow' : 'unpriced', occurredAt: label(row.created_at, 'created_at'), observedAt: row.created_at as string, aiTier: 'standard'
 });
}

/**
 * Row of `gateway_spend_attempts` (src/gateway-spend.ts). The table has no timestamps (gap G-C5), so the caller supplies them from the
 * request or the provider receipt; `occurredAt` is fixed by the first revision. `providerEventId` is the provider's own event or log ID
 * from `gateway_provider_receipts` when one exists. `provider_actual` is computed from the rate snapshot plus the per-call fee, so it is
 * a `receipt` cost (G-C6). `customer_actual` and `customer_reserved` are deliberately not read: the customer debit stays in the gateway
 * buckets and an event never carries it.
 */
export type GatewayAttemptRow = {
 id: string; user_id: string; task_id: string; snapshot: string; status: string; provider_reserved: number;
 input_tokens: number | null; output_tokens: number | null; provider_actual: number | null;
};
export type GatewayAttemptTimes = { occurredAt: string; observedAt?: string; providerEventId?: string | null };
export async function costEventFromGatewayAttempt(input: GatewayAttemptRow, times: GatewayAttemptTimes): Promise<CostEvent> {
 const row = rowOf(input, 'gateway_spend_attempts row');
 const status = lifecycleOf(row.status, ['reserved', 'dispatched', 'uncertain', 'settled', 'released']);
 if (typeof row.snapshot !== 'string') bad('snapshot must be the stored JSON text');
 let snapshot: unknown;
 try { snapshot = JSON.parse(row.snapshot as string); } catch { bad('snapshot is not valid JSON'); }
 const s = snapshot as { tier?: unknown; ownerId?: unknown; taskId?: unknown; rate?: { id?: unknown } | null } | null;
 if (s === null || typeof s !== 'object' || Array.isArray(s) || s.rate === null || typeof s.rate !== 'object' || Array.isArray(s.rate)) bad('snapshot is not a routing selection');
 if (s!.tier !== 'standard' && s!.tier !== 'premium') bad('snapshot tier must be standard or premium');
 // The snapshot is a copy of the decision the attempt was reserved under, so it must name the same owner and task as its row.
 if (s!.ownerId !== row.user_id || s!.taskId !== row.task_id) bad('snapshot does not belong to this attempt');
 const { input: inputTokens, output: outputTokens, actual } = figures(row, status === 'observed', ['input_tokens', 'output_tokens'], 'provider_actual');
 const when = rowOf(times, 'times (the attempt keeps no timestamps)') as GatewayAttemptTimes;
 const providerEventId = when.providerEventId ?? null;
 return inferenceEvent({
  source: 'gateway-settlement', status, sourceEventId: label(row.id, 'id'), providerEventId: providerEventId === null ? null : label(providerEventId, 'providerEventId'), ownerId: label(row.user_id, 'user_id'),
  taskRef: label(row.task_id, 'task_id'), control: false, rateRef: label(s!.rate!.id, 'snapshot.rate.id'), reservedMicros: count(row.provider_reserved, 'provider_reserved'),
  inputTokens, outputTokens, actualMicros: actual, basis: 'receipt', occurredAt: when.occurredAt, observedAt: when.observedAt ?? when.occurredAt, aiTier: s!.tier as AITier
 });
}

/**
 * Row of `storage_project_usage` (WH-075). The counter counts admitted public photo reads, not provider-billed Class B operations
 * (G-C7). It is monotone and increases by one, so its value is the revision and the latest reading wins in any arrival order. The
 * table has no owner column: the caller supplies the project's owner and the observation time.
 */
export type ProjectStorageUsageRow = { project_id: string; period: string; read_ops: number };
export async function costEventFromProjectStorageUsage(input: ProjectStorageUsageRow, context: { ownerId: string; observedAt: string }): Promise<CostEvent> {
 const row = rowOf(input, 'storage_project_usage row');
 const period = row.period, readOps = count(row.read_ops, 'read_ops', 1), projectId = label(row.project_id, 'project_id');
 if (typeof period !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) bad('period must be YYYY-MM');
 const owner = rowOf(context, 'context (the table has no owner or observation time)') as { ownerId: string; observedAt: string };
 const event: CostEvent = {
  contractVersion, source: 'storage-operations', sourceEventId: `${projectId}:${period}:read_ops`, providerEventId: null, revision: readOps, idempotencyKey: '', kind: 'usage', dimension: 'r2.class_b_ops',
  workload: 'storage-files', workClass: 'standing', taskRef: null, attempt: 1, attribution: { scope: 'tenant', ownerId: owner.ownerId, projectId, resourceId: null }, placementClass: 'platform',
  quantity: { state: 'known', value: readOps, unit: 'operation' }, cost: { basis: 'tariff', tariff: { id: 'pool-proposal', version: 1 } }, outcome: 'settled', customerUnits: 0, aiTier: null, detail: {},
  occurredAt: `${period}-01T00:00:00.000Z`, observedAt: owner.observedAt
 };
 event.idempotencyKey = await idempotencyKey(event);
 return validateCostEvent(event);
}

// WH-169: the shadow cost-event contract (docs/cost-events.md, version 1) as shared source. One closed envelope, closed
// dimension/workload/source/tariff registries and the canonical idempotency key. This module is pure: no D1, network, clock or
// provider. A cost event is evidence about consumption, never authority to charge, credit, admit or throttle: `customerUnits` is
// the constant 0 and billing-shaped fields are refused. The durable ledger, emission at receipt transitions, provider import and
// reconciliation are later packets (WH-170 to WH-172); nothing here is wired into a route or a producer.
// SHA-256 is the Workers WebCrypto digest (as elsewhere in src), so the key and the validator are asynchronous.
export const contractVersion = 1 as const;
// Cost is held as an exact fraction over this denominator, so splitting usage into events can never inflate a total. Every tariff
// block size must divide it. Pricing and aggregation are not in this module; the constant is part of the frozen tariff registry.
export const costScale = 9_000_000n;

export class CostEventError extends Error {
 constructor(readonly code: string, readonly detail: string) { super(`${code}: ${detail}`); this.name = 'CostEventError'; }
}
const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new CostEventError(code, detail); };
const isInt = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const deepFreeze = <T>(v: T): T => { if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); for (const x of Object.values(v)) deepFreeze(x); } return v; };
const SAFE = /^[A-Za-z0-9._:-]{1,128}$/, UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/, STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SECRET = /sk-[A-Za-z0-9]{8,}|Bearer\s|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}\./;
const BILLING_KEY = /unit|debit|credit|charge|balance|wallet|entitle|authority|price|invoice|payment/i;
const LOCATOR_KEY = /database|bucket|binding|script|namespace|objectkey|accountid|gatewayid|hostname|url/i;
const CONTENT_KEY = /^(prompt|content|text|body|message|email|secret|token|authorization|apikey|password|cookie|name)$/i;
// Keys are sorted at every depth, so the same value always serializes to the same bytes.
export const canonical = (v: unknown) => JSON.stringify(v, (_k, x) => plain(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
/** SHA-256 (lower-case hex) of the canonical `{dimension, source, sourceEventId}`. Producers cannot invent keys. */
export async function idempotencyKey(identity: { source: string; sourceEventId: string; dimension: string }): Promise<string> {
 const bytes = new TextEncoder().encode(canonical({ dimension: identity.dimension, source: identity.source, sourceEventId: identity.sourceEventId }));
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Registries (closed and frozen at runtime, arrays included; a later feature packet registers its dimension, workload, tariff and adapter together) ----------
export const unknownReasons = deepFreeze(['rate-missing', 'usage-not-reported', 'usage-pending', 'outcome-unknown', 'provider-lag', 'unpriced', 'not-measured', 'invoice-pending', 'entitlement-unknown'] as const);
export const placementClasses = deepFreeze(['static', 'shared-api', 'isolated-function', 'persistent-process', 'platform'] as const);
export const workClasses = deepFreeze(['task', 'retry', 'control', 'standing'] as const);
export const outcomes = deepFreeze(['settled', 'pending', 'uncertain', 'released'] as const);
export const costBases = deepFreeze(['tariff', 'receipt', 'provider-reported', 'shadow', 'unknown'] as const);
export const platformPools = deepFreeze(['shared-account', 'control-plane', 'closed-account'] as const);
export const aiTiers = deepFreeze(['standard', 'premium'] as const);
export type UnknownReason = typeof unknownReasons[number];
export type PlacementClass = typeof placementClasses[number];
export type WorkClass = typeof workClasses[number];
export type Outcome = typeof outcomes[number];
export type AITier = typeof aiTiers[number];

type Workload = { readiness: 'source' | 'planned'; packet: string };
// workload = the customer-visible capability the cost supports, so WH-023/WH-078 can compute cost per outcome.
export const workloads = deepFreeze({
 'chat-ai': { readiness: 'source', packet: 'WH-022' }, 'site-publication': { readiness: 'source', packet: 'WH-022' }, 'app-runtime': { readiness: 'source', packet: 'WH-022' },
 'storage-files': { readiness: 'source', packet: 'WH-022' }, 'contact-intake': { readiness: 'source', packet: 'WH-022' }, 'platform-standing': { readiness: 'source', packet: 'WH-022' },
 'guest-preview': { readiness: 'planned', packet: 'WH-092' }, 'kit-preview': { readiness: 'planned', packet: 'WH-091' }, 'comments': { readiness: 'planned', packet: 'WH-092' },
 'leads': { readiness: 'planned', packet: 'WH-093' }, 'notifications': { readiness: 'planned', packet: 'WH-068' }, 'connector-read': { readiness: 'planned', packet: 'WH-056' },
 'connector-action': { readiness: 'planned', packet: 'WH-056' }, 'collaboration': { readiness: 'planned', packet: 'WH-090' }, 'staging': { readiness: 'planned', packet: 'WH-101' },
 'portfolio-bulk': { readiness: 'planned', packet: 'WH-103' }
} satisfies Record<string, Workload>);
export type CostWorkload = keyof typeof workloads;

type Scope = 'tenant' | 'platform';
type Dimension = { kind: 'usage' | 'liability'; unit: string; financeCategory: 'inference' | 'hosting' | 'support' | 'other'; provider: string; sources: readonly string[]; scopes: readonly Scope[]; readiness: string; detailKeys: readonly string[] };
const meter = (unit: string, financeCategory: Dimension['financeCategory'], provider: string, sources: readonly string[]): Dimension =>
 ({ kind: 'usage', unit, financeCategory, provider, sources, scopes: ['tenant', 'platform'], readiness: 'planned-producer', detailKeys: [] });
const cf = ['cloudflare-usage-import', 'storage-operations'];
const liability = (unit: string, financeCategory: Dimension['financeCategory'], provider: string, sources: readonly string[], scopes: readonly Scope[]): Dimension =>
 ({ kind: 'liability', unit, financeCategory, provider, sources, scopes, readiness: 'planned-producer', detailKeys: [] });
export const dimensions = deepFreeze({
 'ai.inference.call': { ...meter('call', 'inference', 'inference-provider', ['inference-receipt', 'gateway-settlement']), readiness: 'source-producer', detailKeys: ['inputTokens', 'outputTokens'] },
 'worker.requests': meter('request', 'hosting', 'cloudflare', cf), 'worker.cpu_ms': meter('cpu_ms', 'hosting', 'cloudflare', cf),
 'r2.storage': meter('mb_month', 'hosting', 'cloudflare', cf), 'r2.class_a_ops': meter('operation', 'hosting', 'cloudflare', cf),
 'r2.class_b_ops': { ...meter('operation', 'hosting', 'cloudflare', cf), readiness: 'source-producer' },
 'd1.rows_read': meter('row', 'hosting', 'cloudflare', cf), 'd1.rows_written': meter('row', 'hosting', 'cloudflare', cf), 'd1.storage': meter('mb_month', 'hosting', 'cloudflare', cf),
 'container.vcpu_seconds': meter('vcpu_second', 'hosting', 'cloudflare', cf), 'container.memory_gib_seconds': meter('gib_second', 'hosting', 'cloudflare', cf),
 'container.disk_gb_seconds': meter('gb_second', 'hosting', 'cloudflare', cf), 'container.egress': meter('mb', 'hosting', 'cloudflare', cf),
 'do.requests': meter('request', 'hosting', 'cloudflare', cf), 'do.duration': meter('gb_second', 'hosting', 'cloudflare', cf), 'do.rows_read': meter('row', 'hosting', 'cloudflare', cf),
 'do.rows_written': meter('row', 'hosting', 'cloudflare', cf), 'do.storage': meter('mb_month', 'hosting', 'cloudflare', cf),
 'stream.storage': meter('minute_month', 'hosting', 'cloudflare', cf), 'stream.delivery': meter('minute', 'hosting', 'cloudflare', cf),
 // Registered so later packets only add producers. No price is known: events stay explicit-unknown until reviewed.
 'notification.message': meter('message', 'other', 'notification-provider', ['notification-delivery']),
 'connector.provider_call': meter('call', 'other', 'connector-provider', ['connector-call']),
 'liability.account-minimum': liability('item', 'hosting', 'cloudflare', ['liability-register'], ['platform']),
 'liability.provider-minimum': liability('item', 'hosting', 'cloudflare', ['liability-register'], ['platform']),
 'liability.license': liability('item', 'other', 'company', ['liability-register'], ['platform']),
 'liability.renewal': liability('item', 'other', 'company', ['liability-register'], ['platform']),
 'liability.support': liability('item', 'support', 'company', ['liability-register'], ['platform', 'tenant']),
 'liability.staging-retained': liability('item', 'hosting', 'cloudflare', ['liability-register'], ['tenant', 'platform']),
 'liability.uncertain-operation': liability('item', 'other', 'cloudflare', ['liability-register', 'connector-call'], ['tenant', 'platform'])
} satisfies Record<string, Dimension>);
export type CostDimension = keyof typeof dimensions;

// `source-adapter` sources have a pure adapter (cost-event-adapters.ts, or liability-register.ts for the operator register); the others have no producer yet.
export const sources = deepFreeze({
 'inference-receipt': { readiness: 'source-adapter', table: 'inference_calls' }, 'gateway-settlement': { readiness: 'source-adapter', table: 'gateway_spend_attempts' },
 'storage-operations': { readiness: 'source-adapter', table: 'storage_project_usage' }, 'cloudflare-usage-import': { readiness: 'planned', table: null },
 'liability-register': { readiness: 'source-adapter', table: null }, 'notification-delivery': { readiness: 'planned', table: null }, 'connector-call': { readiness: 'planned', table: null }
} satisfies Record<string, { readiness: 'source-adapter' | 'planned'; table: string | null }>);
export type CostSource = keyof typeof sources;

// Tariff catalogue. "pool-proposal" mirrors src/resource-economics.ts (a Whumpo planning proposal, not an invoice). perUnits is the
// provider's block size in the dimension's event unit. Account-wide allowances are metadata of the account, never allocated to tenants.
const rate = (perUnits: number, micros: number) => ({ perUnits, micros });
export type Tariff = { status: 'proposal'; effectiveFrom: string; effectiveTo: string | null; accountAllowance: null; allowanceAllocation: 'account-wide-not-allocated'; rates: Readonly<Record<string, { perUnits: number; micros: number }>> };
export const tariffs: Readonly<Record<string, Readonly<Record<number, Tariff>>>> = deepFreeze({
 'pool-proposal': { 1: {
  status: 'proposal', effectiveFrom: '2026-09-30T00:00:00.000Z', effectiveTo: null, accountAllowance: null, allowanceAllocation: 'account-wide-not-allocated',
  rates: {
   'worker.requests': rate(1_000_000, 300_000), 'worker.cpu_ms': rate(1_000_000, 20_000), 'r2.storage': rate(1000, 15_000), 'r2.class_a_ops': rate(1_000_000, 4_500_000),
   'r2.class_b_ops': rate(1_000_000, 360_000), 'd1.rows_read': rate(1_000_000, 1000), 'd1.rows_written': rate(1_000_000, 1_000_000), 'd1.storage': rate(1000, 750_000),
   'container.vcpu_seconds': rate(3600, 72_000), 'container.memory_gib_seconds': rate(3600, 9000), 'container.disk_gb_seconds': rate(3600, 252), 'container.egress': rate(1000, 50_000),
   'do.requests': rate(1_000_000, 150_000), 'do.duration': rate(1_000_000, 12_500_000), 'do.rows_read': rate(1_000_000, 1000), 'do.rows_written': rate(1_000_000, 1_000_000),
   'do.storage': rate(1000, 200_000), 'stream.storage': rate(1, 5000), 'stream.delivery': rate(1, 1000)
  }
 } satisfies Tariff }
});

// ---------- Envelope ----------
export type Attribution = { scope: 'tenant'; ownerId: string; projectId: string | null; resourceId: string | null } | { scope: 'platform'; pool: typeof platformPools[number] };
export type Quantity = { state: 'known'; value: number; unit: string } | { state: 'unknown'; reason: UnknownReason };
export type Cost =
 | { basis: 'tariff'; tariff: { id: string; version: number } }
 | { basis: 'receipt' | 'provider-reported' | 'shadow'; micros: number; ref: string }
 | { basis: 'unknown'; reason: UnknownReason; exposureMicros: number | null };
export type CostEvent = {
 contractVersion: 1; source: CostSource; sourceEventId: string; providerEventId: string | null; revision: number; idempotencyKey: string; kind: 'usage' | 'liability'; dimension: CostDimension;
 workload: CostWorkload; workClass: WorkClass; taskRef: string | null; attempt: number; attribution: Attribution; placementClass: PlacementClass; quantity: Quantity; cost: Cost;
 outcome: Outcome; customerUnits: 0; aiTier: AITier | null; detail: Record<string, number>; occurredAt: string; observedAt: string;
};
const eventKeys = deepFreeze(['contractVersion', 'source', 'sourceEventId', 'providerEventId', 'revision', 'idempotencyKey', 'kind', 'dimension', 'workload', 'workClass', 'taskRef', 'attempt', 'attribution', 'placementClass', 'quantity', 'cost', 'outcome', 'customerUnits', 'aiTier', 'detail', 'occurredAt', 'observedAt']);

type Loose = Record<string, any>;
function shape(value: unknown, keys: readonly string[], where: string): asserts value is Loose {
 check(plain(value), 'INVALID_EVENT', where);
 for (const k of Object.keys(value)) {
  check(!['receivedAt', 'receivedSeq', 'late'].includes(k), 'CLIENT_ASSIGNED', `${where}.${k}`);
  check(!BILLING_KEY.test(k) || keys.includes(k), 'BILLING_AUTHORITY', `${where}.${k}`);
  check(!LOCATOR_KEY.test(k) || keys.includes(k), 'PHYSICAL_LOCATOR', `${where}.${k}`);
  check(!CONTENT_KEY.test(k), 'CONTENT_FIELD', `${where}.${k}`);
  check(keys.includes(k), 'UNKNOWN_FIELD', `${where}.${k}`);
 }
 for (const k of keys) check(Object.hasOwn(value, k), 'MISSING_FIELD', `${where}.${k}`);
}
const stamp = (v: unknown, where: string) => { check(typeof v === 'string' && STAMP.test(v) && new Date(v).toISOString() === v, 'INVALID_TIME', where); };
const reason = (v: unknown, where: string) => { check((unknownReasons as readonly unknown[]).includes(v), 'INVALID_REASON', where); };
function checkAttribution(a: unknown) {
 check(plain(a), 'INVALID_ATTRIBUTION', 'attribution');
 if (a.scope === 'tenant') {
  shape(a, ['scope', 'ownerId', 'projectId', 'resourceId'], 'attribution');
  check(typeof a.ownerId === 'string' && UUID.test(a.ownerId), 'INVALID_ATTRIBUTION', 'ownerId');
  check(a.projectId === null || (typeof a.projectId === 'string' && UUID.test(a.projectId)), 'INVALID_ATTRIBUTION', 'projectId');
  check(a.resourceId === null || (typeof a.resourceId === 'string' && UUID.test(a.resourceId)), 'INVALID_ATTRIBUTION', 'resourceId');
  check(a.resourceId === null || a.projectId !== null, 'INVALID_ATTRIBUTION', 'a resource needs its project');
 } else if (a.scope === 'platform') { shape(a, ['scope', 'pool'], 'attribution'); check((platformPools as readonly unknown[]).includes(a.pool), 'INVALID_ATTRIBUTION', 'pool'); }
 else check(false, 'INVALID_ATTRIBUTION', 'scope');
}
function checkQuantity(q: unknown, dim: Dimension) {
 check(plain(q), 'INVALID_QUANTITY', 'quantity');
 if (q.state === 'known') { shape(q, ['state', 'value', 'unit'], 'quantity'); check(isInt(q.value), 'INVALID_QUANTITY', 'value'); check(q.unit === dim.unit, 'UNIT_MISMATCH', `${String(q.unit)} != ${dim.unit}`); }
 else if (q.state === 'unknown') { shape(q, ['state', 'reason'], 'quantity'); reason(q.reason, 'quantity.reason'); }
 else check(false, 'INVALID_QUANTITY', 'state');
}
function checkCost(c: unknown) {
 check(plain(c) && (costBases as readonly unknown[]).includes(c.basis), 'INVALID_COST', 'basis');
 if (c.basis === 'tariff') { shape(c, ['basis', 'tariff'], 'cost'); shape(c.tariff, ['id', 'version'], 'cost.tariff'); check(typeof c.tariff.id === 'string' && SAFE.test(c.tariff.id) && isInt(c.tariff.version, 1), 'INVALID_COST', 'tariff'); }
 else if (c.basis === 'unknown') {
  shape(c, ['basis', 'reason', 'exposureMicros'], 'cost'); reason(c.reason, 'cost.reason');
  check(c.exposureMicros === null || isInt(c.exposureMicros), 'INVALID_COST', 'exposureMicros');
 } else { shape(c, ['basis', 'micros', 'ref'], 'cost'); check(isInt(c.micros), 'INVALID_COST', 'micros'); check(typeof c.ref === 'string' && SAFE.test(c.ref), 'INVALID_COST', 'ref'); }
}

// The caller's object is read exactly once, synchronously, before the first await; everything after validates this private copy, so
// a caller mutating its original while the digest is pending can change neither the verdict nor the returned event. Only plain data
// is copied: an accessor property is refused (no caller code runs while validating), and a non-plain object (class instance, Date,
// Map, function ...) becomes an inert prototype-less marker that fails the same plain-object rules it always failed.
const opaque = Object.freeze(Object.create(null));
function snapshot(value: unknown, depth = 0): unknown {
 if (typeof value === 'function') return opaque;
 if (value === null || typeof value !== 'object') return value;
 check(depth <= 8, 'INVALID_EVENT', 'nesting too deep or cyclic');
 if (Array.isArray(value)) return Array.from({ length: value.length }, (_, i) => snapshot(value[i], depth + 1));
 if (!plain(value)) return opaque;
 const out: Record<string, unknown> = {};
 for (const k of Object.keys(value)) {
  const d = Object.getOwnPropertyDescriptor(value, k);
  check(d && 'value' in d, 'INVALID_EVENT', `${k} is an accessor`);
  Object.defineProperty(out, k, { value: snapshot(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
 }
 return out;
}

/**
 * Validates a candidate event against every frozen rule of contract version 1 and returns a private snapshot taken before any await (later edits of the input change nothing). Throws `CostEventError`
 * with a specific code at the first broken rule. The registries are the closed module-level ones: there is no runtime registration.
 */
export async function validateCostEvent(input: unknown): Promise<CostEvent> {
 const e = snapshot(input);
 shape(e, eventKeys, 'event');
 check(e.contractVersion === contractVersion, 'UNSUPPORTED_VERSION', String(e.contractVersion));
 check(Object.hasOwn(sources, e.source), 'UNKNOWN_SOURCE', String(e.source));
 check(Object.hasOwn(dimensions, e.dimension), 'UNKNOWN_DIMENSION', String(e.dimension));
 const dim: Dimension = dimensions[e.dimension as CostDimension];
 check(dim.sources.includes(e.source), 'SOURCE_DIMENSION', `${e.source} may not emit ${e.dimension}`);
 check(typeof e.sourceEventId === 'string' && SAFE.test(e.sourceEventId), 'INVALID_EVENT', 'sourceEventId');
 check(!e.sourceEventId.startsWith('closed:'), 'INVALID_EVENT', 'the closed: prefix is reserved for closure tombstones');
 check(e.providerEventId === null || (typeof e.providerEventId === 'string' && SAFE.test(e.providerEventId)), 'INVALID_EVENT', 'providerEventId');
 check(isInt(e.revision, 1), 'INVALID_EVENT', 'revision');
 check(e.kind === dim.kind, 'KIND_MISMATCH', `${e.dimension} is ${dim.kind}`);
 check(e.idempotencyKey === await idempotencyKey(e as { source: string; sourceEventId: string; dimension: string }), 'IDEMPOTENCY_KEY', 'must equal the derived digest of source, sourceEventId and dimension');
 check(Object.hasOwn(workloads, e.workload), 'UNKNOWN_WORKLOAD', String(e.workload));
 check((workClasses as readonly unknown[]).includes(e.workClass), 'INVALID_EVENT', 'workClass');
 check(e.taskRef === null || (typeof e.taskRef === 'string' && SAFE.test(e.taskRef) && e.taskRef.length <= 64), 'INVALID_EVENT', 'taskRef');
 check(isInt(e.attempt, 1) && e.attempt <= 10, 'INVALID_EVENT', 'attempt');
 // Overhead is separate and attributable to its task, never folded into the task's own line.
 if (e.workClass === 'standing') check(e.taskRef === null && e.attempt === 1, 'OVERHEAD_CLASS', 'standing cost has no task');
 else check(e.taskRef !== null, 'OVERHEAD_CLASS', 'task, retry and control cost name their task');
 check((e.workClass === 'retry') === (e.attempt >= 2) || e.workClass === 'control', 'OVERHEAD_CLASS', 'retry cost is attempt 2 or later');
 checkAttribution(e.attribution); check(dim.scopes.includes(e.attribution.scope), 'SCOPE_NOT_ALLOWED', `${e.dimension} ${e.attribution.scope}`);
 check((placementClasses as readonly unknown[]).includes(e.placementClass), 'INVALID_EVENT', 'placementClass');
 checkQuantity(e.quantity, dim); checkCost(e.cost);
 check((outcomes as readonly unknown[]).includes(e.outcome), 'INVALID_EVENT', 'outcome');
 check(e.customerUnits === 0, 'BILLING_AUTHORITY', 'events carry zero customer units; debits live in the entitlement ledger');
 check(e.aiTier === null || (aiTiers as readonly unknown[]).includes(e.aiTier), 'INVALID_EVENT', 'aiTier');
 check((e.aiTier === null) === !e.dimension.startsWith('ai.'), 'INVALID_EVENT', 'aiTier belongs to ai.* dimensions only');
 check(plain(e.detail), 'INVALID_EVENT', 'detail');
 for (const k of Object.keys(e.detail)) check(!CONTENT_KEY.test(k), 'CONTENT_FIELD', `detail.${k}`);
 check(Object.keys(e.detail).every(k => dim.detailKeys.includes(k) && isInt(e.detail[k])), 'UNKNOWN_FIELD', 'detail');
 stamp(e.occurredAt, 'occurredAt'); stamp(e.observedAt, 'observedAt'); check(e.observedAt >= e.occurredAt, 'INVALID_TIME', 'observedAt precedes occurredAt');
 check(!SECRET.test(canonical(e)), 'SECRET_IN_EVENT', 'secret-shaped value');
 // Outcome and cost must agree so an unfinished or unknown operation can never read as a known (or zero) cost.
 if (e.outcome === 'pending' || e.outcome === 'uncertain') check(e.cost.basis === 'unknown', 'OUTCOME_COST', `${e.outcome} cost is explicit unknown`);
 if (e.outcome === 'released') check(e.quantity.state === 'known' && e.quantity.value === 0 && e.cost.basis !== 'unknown' && (e.cost.micros ?? 0) === 0 && Object.values(e.detail).every(v => v === 0), 'OUTCOME_COST', 'a released reservation consumed nothing: known zero quantity, zero cost and no token detail');
 if (e.cost.basis === 'tariff') {
  check(dim.kind === 'usage' && e.quantity.state === 'known', 'OUTCOME_COST', 'a tariff prices a known quantity');
  const t = Object.hasOwn(tariffs, e.cost.tariff.id) ? tariffs[e.cost.tariff.id][e.cost.tariff.version] : undefined;
  check(t, 'UNKNOWN_TARIFF', `${e.cost.tariff.id}@${e.cost.tariff.version}`);
  check(Object.hasOwn(t.rates, e.dimension), 'UNPRICED_DIMENSION', e.dimension);
  check(e.occurredAt >= t.effectiveFrom && (t.effectiveTo === null || e.occurredAt < t.effectiveTo), 'TARIFF_NOT_EFFECTIVE', `${e.cost.tariff.id}@${e.cost.tariff.version}`);
 }
 if (e.cost.basis === 'shadow') check(dim.provider === 'inference-provider', 'SHADOW_BASIS', 'only hypothetical inference estimates are shadow');
 return e as CostEvent;
}

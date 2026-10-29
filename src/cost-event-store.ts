// WH-170: the durable, append-only store of the shadow cost-event contract (docs/cost-events.md, version 1) over the `cost_events`
// table. Evidence about consumption only: nothing here charges, credits, admits or throttles, no route reads it, and a refused or
// failed append never changes the receipt that produced it. The append rules are the reference ledger's (the WH-168 offline
// prototype) minus account-closure tombstones: closure deletes the owner's rows with the account (owner decision, October
// 28, 2026), so an owner or project that no longer exists is refused (`TENANT_MISMATCH`, `UNKNOWN_PROJECT`) and no closure key exists.
import { canonical, CostEventError, validateCostEvent, type CostEvent } from './cost-events';

const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new CostEventError(code, detail); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const outcomeRank = { pending: 0, uncertain: 1, settled: 2, released: 2 } as const;
const identityFields = ['workload', 'workClass', 'attempt', 'placementClass', 'occurredAt', 'aiTier'] as const;

/** `lower` has the lower revision. The pairwise rule is symmetric in arrival order, so any order of a valid set converges and an
 * invalid pair is refused whichever side arrives second. Attribution is fixed per identity and checked separately. */
export function checkRevisionPair(lower: CostEvent, higher: CostEvent) {
 for (const f of identityFields) check(canonical(lower[f]) === canonical(higher[f]), 'IMMUTABLE_FIELD', `${f} is fixed by the first revision`);
 check(lower.taskRef === higher.taskRef, 'IMMUTABLE_FIELD', 'taskRef is fixed by the first revision');
 // The provider's own ID may be learned later (null -> value) but never replaced or dropped.
 check(lower.providerEventId === null || lower.providerEventId === higher.providerEventId, 'IMMUTABLE_FIELD', 'providerEventId is preserved once known');
 // A tariff pin is the price basis: a revision cannot reprice the event under another tariff version.
 check(lower.cost.basis !== 'tariff' || higher.cost.basis !== 'tariff' || canonical(lower.cost.tariff) === canonical(higher.cost.tariff), 'IMMUTABLE_FIELD', 'the pinned tariff is fixed once priced');
 check(higher.observedAt >= lower.observedAt, 'REVISION_REGRESSION', 'observedAt does not move backwards');
 check(outcomeRank[higher.outcome] >= outcomeRank[lower.outcome] && (outcomeRank[lower.outcome] < 2 || lower.outcome === higher.outcome), 'REVISION_REGRESSION', 'an outcome only advances and a terminal outcome is final');
 check(lower.quantity.state === 'unknown' || higher.quantity.state === 'known', 'REVISION_REGRESSION', 'a known quantity is not made unknown again');
 check(lower.cost.basis === 'unknown' || higher.cost.basis !== 'unknown', 'REVISION_REGRESSION', 'a known cost is not made unknown again');
}

export type AppendResult = { status: 'accepted' | 'duplicate' | 'stale-revision'; key: string; revision: number };
type Stored = { revision: number; event_json: string };
const parse = (row: Stored) => JSON.parse(row.event_json) as CostEvent;

// Ownership is enforced by the table (foreign keys to the owner and project, and the tenant trigger), so the common path needs no
// extra read; only a refused insert looks at which of the two no longer exists.
function checkStatic(e: CostEvent) {
 const a = e.attribution;
 if (a.scope === 'platform') check(a.pool !== 'closed-account', 'POOL_UNSUPPORTED', 'closure deletes the owner\'s events; there is no closed-account pool');
 // No resource registry exists yet (WH-171+), so membership of a resource in the project cannot be proven.
 else check(a.resourceId === null, 'TENANT_MISMATCH', 'resource is not part of the project');
}
async function refusal(db: D1Database, e: CostEvent): Promise<CostEventError> {
 const a = e.attribution;
 if (a.scope !== 'tenant') return new CostEventError('TENANT_MISMATCH', 'platform attribution was refused');
 if (!await db.prepare('SELECT id FROM users WHERE id=?').bind(a.ownerId).first()) return new CostEventError('TENANT_MISMATCH', 'the owner does not exist');
 if (a.projectId !== null && !await db.prepare('SELECT id FROM projects WHERE id=?').bind(a.projectId).first()) return new CostEventError('UNKNOWN_PROJECT', 'project is not registered');
 return new CostEventError('TENANT_MISMATCH', 'project belongs to another owner');
}

const columns = 'idempotency_key,revision,source,dimension,scope,owner_id,project_id,resource_id,pool,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,exposure_micros,occurred_at,observed_at,event_json,stale';
function insertStatement(db: D1Database, e: CostEvent, stale: boolean, seen: number) {
 const a = e.attribution, tenant = a.scope === 'tenant';
 const cost = e.cost;
 return db.prepare(`INSERT INTO cost_events(${columns}) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM cost_events WHERE idempotency_key=?)=?`).bind(
  e.idempotencyKey, e.revision, e.source, e.dimension, a.scope, tenant ? a.ownerId : null, tenant ? a.projectId : null, tenant ? a.resourceId : null, tenant ? null : a.pool,
  e.workload, e.workClass, e.outcome, e.quantity.state === 'known' ? e.quantity.value : null, cost.basis, 'micros' in cost ? cost.micros : null,
  cost.basis === 'unknown' ? cost.exposureMicros : null, e.occurredAt, e.observedAt, canonical(e), stale ? 1 : 0, e.idempotencyKey, seen);
}

/**
 * Appends one validated revision. Duplicate and redelivery are no-ops, a lower revision arriving after a higher one is stored as
 * `stale` and never counted, and every pair of revisions of one identity must be compatible. The insert is guarded by the number of
 * revisions that were read, so two concurrent appends cannot admit a contradictory pair; a lost race rereads (at most three times).
 */
export async function appendCostEvent(db: D1Database, input: unknown): Promise<AppendResult> {
 const event = await validateCostEvent(input);
 checkStatic(event);
 for (let attempt = 0; attempt < 3; attempt++) {
  const prior = (await db.prepare('SELECT revision,event_json FROM cost_events WHERE idempotency_key=? ORDER BY revision').bind(event.idempotencyKey).all<Stored>()).results;
  const events = prior.map(parse);
  for (const p of events) check(canonical(p.attribution) === canonical(event.attribution), 'TENANT_MISMATCH', 'a later revision cannot change attribution');
  const same = prior.find(p => p.revision === event.revision);
  if (same) {
   check(same.event_json === canonical(event), 'IDEMPOTENCY_CONFLICT', 'same source event and revision with different content');
   return { status: 'duplicate', key: event.idempotencyKey, revision: event.revision };
  }
  for (const p of events) { if (p.revision < event.revision) checkRevisionPair(p, event); else checkRevisionPair(event, p); }
  const stale = prior.some(p => p.revision > event.revision);
  try {
   const result = await insertStatement(db, event, stale, prior.length).run();
   if (result.meta.changes === 1) return { status: stale ? 'stale-revision' : 'accepted', key: event.idempotencyKey, revision: event.revision };
  } catch (cause) {
   const text = String(cause);
   if (text.includes('cost_event_tenant_mismatch') || /FOREIGN KEY/i.test(text)) throw await refusal(db, event);
   if (!/UNIQUE/i.test(text)) throw cause;
  }
 }
 throw new CostEventError('APPEND_CONTENTION', 'the identity changed while it was being appended; the producer may redeliver');
}

/** Every head (highest revision per identity) of one owner, newest-arrival order. Stale revisions are never heads. */
export async function costEventHeads(db: D1Database, ownerId: string, limit = 10000): Promise<CostEvent[]> {
 check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 10000, 'INVALID_EVENT', 'limit');
 const rows = await db.prepare('SELECT e.revision,e.event_json FROM cost_events e WHERE e.owner_id=? AND e.revision=(SELECT MAX(revision) FROM cost_events WHERE idempotency_key=e.idempotency_key) ORDER BY e.seq LIMIT ?').bind(ownerId, limit).all<Stored>();
 return rows.results.map(parse);
}

/** Exact head sums of one owner. Cost is summed as a BigInt and a total beyond Number.MAX_SAFE_INTEGER is refused (`AMOUNT_UNSAFE`),
 * never rounded; unknown cost is counted, never summed as zero. Tariff pricing and rounding belong to the WH-171 report. */
export async function costEventHeadSums(db: D1Database, ownerId: string) {
 const heads = await costEventHeads(db, ownerId);
 let receiptMicros = 0n, providerMicros = 0n, shadowMicros = 0n, units = 0n, unknown = 0, tariffUnpriced = 0;
 for (const e of heads) {
  if (e.quantity.state === 'known') units += BigInt(e.quantity.value);
  if (e.cost.basis === 'unknown') unknown++;
  else if (e.cost.basis === 'tariff') tariffUnpriced++;
  else if (e.cost.basis === 'receipt') receiptMicros += BigInt(e.cost.micros);
  else if (e.cost.basis === 'provider-reported') providerMicros += BigInt(e.cost.micros);
  else shadowMicros += BigInt(e.cost.micros);
 }
 for (const [name, total] of Object.entries({ units, receiptMicros, providerMicros, shadowMicros })) check(total <= MAX_SAFE, 'AMOUNT_UNSAFE', `${name} is outside the exactly representable range and is refused rather than rounded`);
 return { heads: heads.length, units: Number(units), receiptMicros: Number(receiptMicros), providerMicros: Number(providerMicros), shadowMicros: Number(shadowMicros), unknown, tariffUnpriced };
}

// WH-172 / WH-022: the one producer of `liability.*` cost events. A liability (account floor, provider minimum, license, renewal,
// support, retained staging) has no meter, so an operator lists it in a private register file and tools/liability-register.mjs
// appends it through the existing ledger. Pure: no D1, clock or network. An amount that is not stated stays an explicit unknown
// (`invoice-pending`), never zero, and the only known basis is `provider-reported` with a reference to the operator's own record.
// Platform scope only: a tenant-scoped liability needs an owner the register does not hold (shortcut: add owners when WH-023 needs them).
import { contractVersion, CostEventError, idempotencyKey, validateCostEvent, dimensions, platformPools, type CostEvent, type CostDimension } from './cost-events';

const bad = (detail: string): never => { throw new CostEventError('INVALID_LIABILITY', detail); };
const keys = ['id', 'dimension', 'pool', 'period', 'amountMicros', 'ref', 'revision', 'observedAt'];

export type LiabilityEntry = {
 id: string; dimension: CostDimension; pool: 'shared-account' | 'control-plane'; period: string;
 /** null = the amount is not known yet. */
 amountMicros: number | null; ref: string | null; revision: number; observedAt: string;
};

export async function costEventFromLiabilityEntry(input: unknown): Promise<CostEvent> {
 if (input === null || typeof input !== 'object' || Array.isArray(input)) bad('entry must be an object');
 const e = input as Record<string, unknown>;
 for (const k of Object.keys(e)) if (!keys.includes(k)) bad(`unknown field ${k}`);
 for (const k of keys) if (!Object.hasOwn(e, k)) bad(`missing field ${k}`);
 if (typeof e.dimension !== 'string' || !Object.hasOwn(dimensions, e.dimension) || dimensions[e.dimension as CostDimension].kind !== 'liability') bad('dimension must be a liability dimension');
 if (e.pool !== 'shared-account' && e.pool !== 'control-plane') bad(`pool must be one of ${platformPools.filter(p => p !== 'closed-account').join(', ')}`);
 if (typeof e.period !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(e.period)) bad('period must be YYYY-MM');
 if (typeof e.id !== 'string') bad('id must be a string');
 const known = e.amountMicros !== null;
 if (known && (!Number.isSafeInteger(e.amountMicros) || (e.amountMicros as number) < 0)) bad('amountMicros must be a non-negative integer or null');
 if (known && typeof e.ref !== 'string') bad('a known amount needs a ref to the operator record');
 if (!known && e.ref !== null) bad('an unknown amount has no ref');
 const event: CostEvent = {
  contractVersion, source: 'liability-register', sourceEventId: `${e.id}:${e.period}`, providerEventId: null, revision: e.revision as number, idempotencyKey: '', kind: 'liability',
  dimension: e.dimension as CostDimension, workload: 'platform-standing', workClass: 'standing', taskRef: null, attempt: 1, attribution: { scope: 'platform', pool: e.pool as LiabilityEntry['pool'] },
  placementClass: 'platform', quantity: { state: 'known', value: 1, unit: 'item' },
  cost: known ? { basis: 'provider-reported', micros: e.amountMicros as number, ref: e.ref as string } : { basis: 'unknown', reason: 'invoice-pending', exposureMicros: null },
  outcome: 'settled', customerUnits: 0, aiTier: null, detail: {}, occurredAt: `${e.period}-01T00:00:00.000Z`, observedAt: e.observedAt as string
 };
 event.idempotencyKey = await idempotencyKey(event);
 return validateCostEvent(event);
}

/** A register file is `{ version: 1, entries: [...] }`; every entry is validated before the caller appends any of them. */
export async function costEventsFromRegister(file: unknown): Promise<CostEvent[]> {
 if (file === null || typeof file !== 'object' || (file as { version?: unknown }).version !== 1 || !Array.isArray((file as { entries?: unknown }).entries)) bad('register must be {version:1, entries:[...]}');
 const entries = (file as { entries: unknown[] }).entries;
 if (entries.length > 200) bad('at most 200 entries');
 return Promise.all(entries.map(costEventFromLiabilityEntry));
}

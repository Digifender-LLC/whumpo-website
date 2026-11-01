// WH-043 first slice: the capacity ledger as pure, immutable functions over plain data, with explicitly SYNTHETIC terms. No D1, network, clock, provider or Stripe call, no
// schema, and nothing here is wired into a route, billing path or admission: the lot, expiry and rollover rules are the proposal in docs/resource-pool-economics.md and are
// not enabled billing terms, and no purchased balance exists. Units are integer micro-units (never floats). Every operation carries an id: repeating it with the same body is a
// no-op, repeating it with a different body is refused, so concurrent or replayed work settles exactly once. Balances are never read from, translated from or revived from
// the retired test-unit tables: the ledger only knows entries it created (version 1).
export class LedgerError extends Error {
 constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'LedgerError'; }
}
const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new LedgerError(code, detail); };
const MAX = 1_000_000_000_000;
const isUnits = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= MAX;
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const REF = /^[A-Za-z0-9._:-]{1,64}$/;
const ref = (v: unknown, what: string) => { check(typeof v === 'string' && REF.test(v), 'INVALID_INPUT', `${what} is a short safe identifier`); return v as string; };

export const lotKinds = Object.freeze(['monthly', 'rollover', 'purchased'] as const);
export type LotKind = typeof lotKinds[number];
export type Lot = { id: string; kind: LotKind; periodKey: string; granted: number; remaining: number; expiredUnits: number; grantedAt: number; expiresAt: number | null; carriedUnits: number };
type Allocation = { lotId: string; units: number };
export type Reservation = { id: string; units: number; at: number; state: 'held' | 'settled' | 'released'; allocation: Allocation[]; consumed: Allocation[]; settledUnits: number; refundedUnits: number };
export type Ledger = { version: 1; terms: 'synthetic-proposal'; lots: Lot[]; reservations: Record<string, Reservation>; ops: Record<string, string>; journal: { op: string; id: string; at: number }[] };

export const emptyLedger = (): Ledger => ({ version: 1, terms: 'synthetic-proposal', lots: [], reservations: {}, ops: {}, journal: [] });
const clone = (l: Ledger): Ledger => structuredClone(l);
const body = (v: unknown) => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
/** Idempotent application: a repeat of the same operation returns the same ledger, a different body under the same id is a conflict. */
function apply(l: Ledger, op: string, id: string, at: number, input: unknown, run: (next: Ledger) => void): { ledger: Ledger; replayed: boolean } {
 const key = `${op}:${id}`, text = body(input);
 if (Object.hasOwn(l.ops, key)) { check(l.ops[key] === text, 'OP_CONFLICT', `${key} repeats with a different body`); return { ledger: l, replayed: true }; }
 const next = clone(l);
 run(next);
 next.ops[key] = text; next.journal.push({ op, id, at });
 return { ledger: next, replayed: false };
}
const live = (lot: Lot, at: number) => lot.remaining > 0 && (lot.expiresAt === null || lot.expiresAt > at);
/** Earliest expiry first; a lot that never expires is used last; ties by id so the order is deterministic. */
const order = (a: Lot, b: Lot) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity) || (a.id < b.id ? -1 : 1);
/** Units coming back to a lot that has meanwhile expired are expired, never revived. */
function giveBack(lot: Lot, units: number, at: number) { if (lot.expiresAt !== null && lot.expiresAt <= at) lot.expiredUnits += units; else lot.remaining += units; }
const lotOf = (l: Ledger, id: string) => { const lot = l.lots.find(x => x.id === id); check(lot, 'UNKNOWN_LOT', id); return lot; };

/**
 * Grant a lot. A monthly lot is the period's included allowance; a rollover lot is created only by `rollover`; a purchased lot needs an explicit consent receipt reference
 * and nothing else ever creates one (no automatic top-up).
 */
export function grant(l: Ledger, i: { id: string; kind: LotKind; periodKey: string; units: number; at: number; expiresAt: number | null; consentRef?: string }) {
 const id = ref(i.id, 'id'); ref(i.periodKey, 'periodKey');
 check((lotKinds as readonly string[]).includes(i.kind), 'INVALID_INPUT', 'kind');
 check(i.kind !== 'rollover', 'ROLLOVER_BY_RULE_ONLY', 'a rollover lot is created only by rollover()');
 check(isUnits(i.units, 1) && isTime(i.at), 'INVALID_INPUT', 'units and at');
 check(i.expiresAt === null ? i.kind === 'purchased' : isTime(i.expiresAt) && i.expiresAt > i.at, 'INVALID_INPUT', 'a monthly lot expires after it is granted; only a purchased lot may be open-ended');
 if (i.kind === 'purchased') ref(i.consentRef, 'consentRef');
 return apply(l, 'grant', id, i.at, i, next => {
  check(!next.lots.some(x => x.id === id), 'DUPLICATE_LOT', id);
  check(i.kind !== 'monthly' || !next.lots.some(x => x.kind === 'monthly' && x.periodKey === i.periodKey), 'DUPLICATE_PERIOD', 'one monthly grant per period');
  next.lots.push({ id, kind: i.kind, periodKey: i.periodKey, granted: i.units, remaining: i.units, expiredUnits: 0, grantedAt: i.at, expiresAt: i.expiresAt, carriedUnits: 0 });
 });
}

/** Expire every lot past its expiry; held reservations are untouched (their units are already out of the lot). Unspent units are lost, not carried. */
export function expire(l: Ledger, at: number) {
 check(isTime(at), 'INVALID_INPUT', 'at');
 return apply(l, 'expire', `t${at}`, at, { at }, next => { for (const lot of next.lots) if (lot.expiresAt !== null && lot.expiresAt <= at && lot.remaining > 0) { lot.expiredUnits += lot.remaining; lot.remaining = 0; } });
}

/**
 * Hold `units` against the live lots, earliest expiry first. All or nothing: there is no overdraft and no automatic top-up or upgrade, so a shortfall is a refusal. Standard
 * assistance is never metered: `workClass: 'standard-ai'` with units above zero is refused, and zero units writes nothing.
 */
export function reserve(l: Ledger, i: { id: string; units: number; at: number; workClass?: 'standard-ai' | 'metered' }) {
 const id = ref(i.id, 'id');
 check(isTime(i.at) && isUnits(i.units), 'INVALID_INPUT', 'units and at');
 if (i.workClass === 'standard-ai') { check(i.units === 0, 'STANDARD_AI_NOT_METERED', 'standard assistance debits zero units'); return { ledger: l, replayed: false }; }
 check(i.units > 0, 'INVALID_INPUT', 'a metered reservation holds at least one unit');
 return apply(l, 'reserve', id, i.at, i, next => {
  check(!Object.hasOwn(next.reservations, id), 'DUPLICATE_RESERVATION', id);
  const lots = next.lots.filter(x => live(x, i.at)).sort(order);
  check(lots.reduce((s, x) => s + x.remaining, 0) >= i.units, 'INSUFFICIENT_CAPACITY', 'not enough live capacity; nothing was held');
  let need = i.units; const allocation: Allocation[] = [];
  for (const lot of lots) { if (!need) break; const take = Math.min(need, lot.remaining); lot.remaining -= take; need -= take; allocation.push({ lotId: lot.id, units: take }); }
  next.reservations[id] = { id, units: i.units, at: i.at, state: 'held', allocation, consumed: [], settledUnits: 0, refundedUnits: 0 };
 });
}

/** Settle a hold exactly once: consume `actualUnits` (never above what was held) in allocation order and return the rest to the lots it came from. */
export function settle(l: Ledger, i: { id: string; actualUnits: number; at: number }) {
 const id = ref(i.id, 'id');
 check(isUnits(i.actualUnits) && isTime(i.at), 'INVALID_INPUT', 'actualUnits and at');
 return apply(l, 'settle', id, i.at, i, next => {
  const r = next.reservations[id]; check(r, 'UNKNOWN_RESERVATION', id);
  check(r.state === 'held', 'ALREADY_SETTLED', `${id} is ${r.state}`);
  check(i.actualUnits <= r.units, 'EXCEEDS_RESERVATION', 'work beyond the hold needs a new reservation');
  let left = i.actualUnits; const consumed: Allocation[] = [];
  for (const a of r.allocation) { const use = Math.min(left, a.units); left -= use; if (use) consumed.push({ lotId: a.lotId, units: use }); if (a.units - use) giveBack(lotOf(next, a.lotId), a.units - use, i.at); }
  r.state = 'settled'; r.consumed = consumed; r.settledUnits = i.actualUnits;
 });
}

/** Return a whole hold (the work never ran). Units returning to an expired lot are expired. */
export function release(l: Ledger, i: { id: string; at: number }) {
 const id = ref(i.id, 'id'); check(isTime(i.at), 'INVALID_INPUT', 'at');
 return apply(l, 'release', id, i.at, i, next => {
  const r = next.reservations[id]; check(r, 'UNKNOWN_RESERVATION', id);
  check(r.state === 'held', 'ALREADY_SETTLED', `${id} is ${r.state}`);
  for (const a of r.allocation) giveBack(lotOf(next, a.lotId), a.units, i.at);
  r.state = 'released';
 });
}

/** Refund part of a settled reservation, at most once per refund id and never beyond what it consumed; expired lots are not revived. */
export function refund(l: Ledger, i: { id: string; reservationId: string; units: number; at: number }) {
 const id = ref(i.id, 'id'), rid = ref(i.reservationId, 'reservationId');
 check(isUnits(i.units, 1) && isTime(i.at), 'INVALID_INPUT', 'units and at');
 return apply(l, 'refund', id, i.at, i, next => {
  const r = next.reservations[rid]; check(r, 'UNKNOWN_RESERVATION', rid);
  check(r.state === 'settled', 'NOT_SETTLED', rid);
  check(r.refundedUnits + i.units <= r.settledUnits, 'REFUND_EXCEEDS_SETTLEMENT', 'a refund cannot exceed what was consumed');
  let left = i.units;
  for (const c of [...r.consumed].reverse()) { const back = Math.min(left, c.units); left -= back; if (back) giveBack(lotOf(next, c.lotId), back, i.at); if (!left) break; }
  r.refundedUnits += i.units;
 });
}

/**
 * Carry unused FRESH monthly units into the next period: the smaller of what is left, the previous allowance and the next allowance. Only a monthly lot carries, so a
 * rollover lot (or a purchased one) never rolls twice; the carried units move to a rollover lot that expires with the next period, and the rest of the old lot expires.
 */
export function rollover(l: Ledger, i: { id: string; fromPeriod: string; toPeriod: string; previousAllowance: number; nextAllowance: number; at: number; expiresAt: number }) {
 const id = ref(i.id, 'id'); ref(i.fromPeriod, 'fromPeriod'); ref(i.toPeriod, 'toPeriod');
 check(i.fromPeriod !== i.toPeriod, 'INVALID_INPUT', 'two different periods');
 check(isUnits(i.previousAllowance) && isUnits(i.nextAllowance) && isTime(i.at) && isTime(i.expiresAt) && i.expiresAt > i.at, 'INVALID_INPUT', 'allowances and times');
 return apply(l, 'rollover', id, i.at, i, next => {
  const from = next.lots.find(x => x.kind === 'monthly' && x.periodKey === i.fromPeriod); check(from, 'UNKNOWN_LOT', `no monthly lot for ${i.fromPeriod}`);
  check(!next.lots.some(x => x.kind === 'rollover' && x.periodKey === i.toPeriod), 'DUPLICATE_ROLLOVER', `${i.toPeriod} already received a rollover`);
  // Carrying happens at or before the period boundary; units of a lot already past its expiry are lost and cannot be revived by a late rollover.
  check(from.expiresAt !== null && i.at <= from.expiresAt, 'LOT_EXPIRED', 'the period has already ended; expired units cannot carry');
  const carry = Math.min(from.remaining, i.previousAllowance, i.nextAllowance);
  from.remaining -= carry; from.carriedUnits += carry;
  if (carry > 0) next.lots.push({ id: `rollover:${id}`, kind: 'rollover', periodKey: i.toPeriod, granted: carry, remaining: carry, expiredUnits: 0, grantedAt: i.at, expiresAt: i.expiresAt, carriedUnits: 0 });
 });
}

export type Telemetry = 'complete' | 'partial' | 'unknown';
/**
 * What a balance screen may say. Terms are labelled as the synthetic proposal. When usage telemetry is partial or unknown the answer is `unknown` with no number: it never
 * shows full capacity, and the held units are shown apart from the available ones.
 */
export function capacityView(l: Ledger, at: number, telemetry: Telemetry) {
 check(isTime(at) && ['complete', 'partial', 'unknown'].includes(telemetry), 'INVALID_INPUT', 'at and telemetry');
 const lots = l.lots.filter(x => live(x, at));
 const byKind = Object.fromEntries(lotKinds.map(k => [k, lots.filter(x => x.kind === k).reduce((s, x) => s + x.remaining, 0)])) as Record<LotKind, number>;
 const held = Object.values(l.reservations).filter(r => r.state === 'held').reduce((s, r) => s + r.units, 0);
 const nextExpiry = lots.map(x => x.expiresAt).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;
 if (telemetry !== 'complete') return { terms: l.terms, state: 'unknown' as const, availableUnits: null, byKind: null, heldUnits: held, nextExpiry, reason: `usage telemetry is ${telemetry}` };
 return { terms: l.terms, state: 'known' as const, availableUnits: lots.reduce((s, x) => s + x.remaining, 0), byKind, heldUnits: held, nextExpiry, reason: null };
}

// WH-042 slice: paid entitlement derived from verified financial facts, as pure functions over plain data with explicitly SYNTHETIC terms. No D1, network, clock, provider or Stripe call,
// no schema, and nothing here is wired into a route, webhook or billing path: the grace window and the refund/dispute treatment are a proposal only, not enabled terms
// (WH-041 holds that decision; docs/workspace-collaboration.md says no grace is approved). The caller must verify an event server-side and assert `verified: true`; this module only refuses
// the rest, and a browser success page has no event kind. The facts are a set merged by stable ids, so duplicate,
// reordered and late delivery converge on the same facts and the same answer; an id repeated with a different body is a conflict, never an overwrite. Entitlement is a function of the
// facts and a time, so a refund or dispute is a compensating fact and nothing is edited or deleted (immutable compensating entries).
export class EntitlementError extends Error {
 constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'EntitlementError'; }
}
const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new EntitlementError(code, detail); };
const REF = /^[A-Za-z0-9._:-]{1,64}$/;
// '__proto__' would set the table's prototype instead of a key and silently drop the fact.
const ref = (v: unknown, what: string) => { check(typeof v === 'string' && REF.test(v) && v !== '__proto__', 'INVALID_INPUT', `${what} is a short safe identifier`); return v as string; };
const cents = (v: unknown, min: number, what: string) => { check(Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= 1_000_000_000_000, 'INVALID_INPUT', `${what} is whole minor units`); return v as number; };
const time = (v: unknown, what: string) => { check(Number.isSafeInteger(v) && (v as number) > 0, 'INVALID_INPUT', `${what} is a positive millisecond time`); return v as number; };

export const eventKinds = Object.freeze(['invoice_paid', 'refund', 'dispute', 'payment_failed', 'cancellation'] as const);
type Base = { id: string; verified: true };
export type FinancialEvent = Base & (
 | { kind: 'invoice_paid'; invoiceId: string; subscriptionId: string; planId: string; amountCents: number; startsAt: number; endsAt: number }
 | { kind: 'refund'; invoiceId: string; amountCents: number }
 | { kind: 'dispute'; invoiceId: string; disputeId: string; state: 'open' | 'won' | 'lost' }
 | { kind: 'payment_failed'; subscriptionId: string; at: number }
 | { kind: 'cancellation'; subscriptionId: string; effectiveAt: number });
type Paid = { subscriptionId: string; planId: string; amountCents: number; startsAt: number; endsAt: number };
export type Facts = { version: 1; terms: 'synthetic-proposal'; events: Record<string, string>; paid: Record<string, Paid>; refunds: Record<string, { invoiceId: string; amountCents: number }>;
 disputes: Record<string, { invoiceId: string; state: 'open' | 'won' | 'lost' }>; failures: Record<string, { subscriptionId: string; at: number }>; cancellations: Record<string, { subscriptionId: string; effectiveAt: number }> };

export const emptyFacts = (): Facts => ({ version: 1, terms: 'synthetic-proposal', events: {}, paid: {}, refunds: {}, disputes: {}, failures: {}, cancellations: {} });
const body = (v: unknown) => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);
/** Put a fact under a stable key: the same body is a no-op, a different body is a conflict. */
function put<T>(table: Record<string, T>, key: string, value: T) {
 if (Object.hasOwn(table, key)) check(body(table[key]) === body(value), 'FACT_CONFLICT', `${key} repeats with a different body`);
 else table[key] = value;
}

/** Record one verified event. Returns the new facts and whether this exact event had been recorded already. */
export function record(f: Facts, e: FinancialEvent): { facts: Facts; replayed: boolean } {
 check((e as { verified?: unknown }).verified === true, 'UNVERIFIED_EVENT', 'only a server-verified financial event can change entitlement');
 check((eventKinds as readonly string[]).includes(e.kind), 'INVALID_INPUT', 'kind');
 const id = ref(e.id, 'id'), text = body(e);
 if (Object.hasOwn(f.events, id)) { check(f.events[id] === text, 'EVENT_CONFLICT', `${id} repeats with a different body`); return { facts: f, replayed: true }; }
 const next = structuredClone(f);
 switch (e.kind) {
  case 'invoice_paid': {
   const startsAt = time(e.startsAt, 'startsAt'), endsAt = time(e.endsAt, 'endsAt');
   check(endsAt > startsAt, 'INVALID_INPUT', 'a paid interval ends after it starts');
   put(next.paid, ref(e.invoiceId, 'invoiceId'), { subscriptionId: ref(e.subscriptionId, 'subscriptionId'), planId: ref(e.planId, 'planId'), amountCents: cents(e.amountCents, 1, 'amountCents'), startsAt, endsAt });
   break;
  }
  case 'refund': put(next.refunds, id, { invoiceId: ref(e.invoiceId, 'invoiceId'), amountCents: cents(e.amountCents, 1, 'amountCents') }); break;
  case 'dispute': {
   check(['open', 'won', 'lost'].includes(e.state), 'INVALID_INPUT', 'state');
   const key = ref(e.disputeId, 'disputeId'), had = Object.hasOwn(next.disputes, key) ? next.disputes[key] : undefined;
   const invoiceId = ref(e.invoiceId, 'invoiceId');
   if (had) check(had.invoiceId === invoiceId, 'FACT_CONFLICT', `${key} names two invoices`);
   // A resolution outranks "open" whatever the arrival order; two different resolutions cannot both be true.
   if (had && had.state !== 'open' && e.state !== 'open') check(had.state === e.state, 'FACT_CONFLICT', `${key} resolved two ways`);
   if (!had || had.state === 'open') next.disputes[key] = { invoiceId, state: e.state };
   break;
  }
  case 'payment_failed': put(next.failures, id, { subscriptionId: ref(e.subscriptionId, 'subscriptionId'), at: time(e.at, 'at') }); break;
  case 'cancellation': put(next.cancellations, id, { subscriptionId: ref(e.subscriptionId, 'subscriptionId'), effectiveAt: time(e.effectiveAt, 'effectiveAt') }); break;
 }
 next.events[id] = text;
 return { facts: next, replayed: false };
}

export type Entitlement = { state: 'active' | 'grace' | 'none'; planId: string | null; invoiceId: string | null; until: number | null; disputed: boolean; reasons: string[] };
/**
 * What is paid for at `now`. Access is exactly the paid interval [startsAt, endsAt): a year is one interval and adds no extra month. A fully refunded or dispute-lost invoice covers
 * nothing; a partial refund or an open dispute keeps access and says so. After an interval ends with a failed renewal, `graceMs` of access remains unless the subscription was cancelled.
 */
export function entitlement(f: Facts, now: number, graceMs: number): Entitlement {
 time(now, 'now'); check(Number.isSafeInteger(graceMs) && graceMs >= 0, 'INVALID_INPUT', 'graceMs');
 const reasons: string[] = [], none: Entitlement = { state: 'none', planId: null, invoiceId: null, until: null, disputed: false, reasons };
 const usable = Object.entries(f.paid).filter(([id, p]) => {
  const refunded = Object.values(f.refunds).filter(r => r.invoiceId === id).reduce((s, r) => s + r.amountCents, 0);
  if (refunded > p.amountCents) reasons.push(`over-refunded:${id}`);
  if (refunded >= p.amountCents) { reasons.push(`refunded:${id}`); return false; }
  if (Object.values(f.disputes).some(d => d.invoiceId === id && d.state === 'lost')) { reasons.push(`dispute-lost:${id}`); return false; }
  if (refunded > 0) reasons.push(`partially-refunded:${id}`);
  return true;
 });
 reasons.sort(); // arrival order must not show in the answer
 const cancelled = (sub: string) => Object.values(f.cancellations).some(c => c.subscriptionId === sub && c.effectiveAt <= now);
 const answer = (state: 'active' | 'grace', id: string, p: Paid, until: number): Entitlement => ({ state, planId: p.planId, invoiceId: id, until, reasons,
  disputed: Object.values(f.disputes).some(d => d.invoiceId === id && d.state === 'open') });
 const covering = usable.filter(([, p]) => p.startsAt <= now && now < p.endsAt).sort(([ia, a], [ib, b]) => b.endsAt - a.endsAt || (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0) || (ia < ib ? -1 : 1))[0];
 if (covering) return answer('active', covering[0], covering[1], covering[1].endsAt);
 const lapsed = usable.filter(([, p]) => p.endsAt <= now && now < p.endsAt + graceMs && !cancelled(p.subscriptionId)
  && Object.values(f.failures).some(x => x.subscriptionId === p.subscriptionId && x.at >= p.endsAt && x.at <= now)).sort(([ia, a], [ib, b]) => b.endsAt - a.endsAt || (ia < ib ? -1 : 1))[0];
 return lapsed ? answer('grace', lapsed[0], lapsed[1], lapsed[1].endsAt + graceMs) : none;
}

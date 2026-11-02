import {capacityView,LedgerError,type Ledger,type Lot,type Telemetry} from './capacity-ledger';

// WH-043: what a customer capacity screen or a Chat answer may say about capacity, as plain data derived from the ledger alone. Pure: no D1, clock, provider or Stripe call, and not
// wired to any route, UI, billing or admission path. Terms are the synthetic proposal in docs/resource-pool-economics.md and no purchased balance exists. Monthly, rollover and paid
// units stay separate. Partial or unknown usage telemetry gives "still calculating" with no remaining number, percentage, allowance or history, so it never shows full capacity.
// Internal ids (consent receipts, reservations, operations) and provider costs never appear. Ledger units are integer micro-units; text shows whole units (1,000,000 micro-units),
// rounding what is left down and what was used or held up, so neither is overstated in the customer's favour.
export const microUnitsPerUnit = 1_000_000;
const check = (ok: unknown, detail: string) => { if (!ok) throw new LedgerError('INVALID_INPUT', detail); };
export function formatUnits(micro: number, round: 'down' | 'up') {
 check(Number.isSafeInteger(micro) && micro >= 0, 'units are whole micro-units');
 const hundredths = round === 'down' ? Math.floor(micro / 10_000) : Math.ceil(micro / 10_000);
 const whole = Math.floor(hundredths / 100), part = hundredths % 100;
 return `${whole.toLocaleString('en-US')}${part ? `.${String(part).padStart(2, '0').replace(/0$/, '')}` : ''}`;
}
const plural = (micro: number, round: 'down' | 'up') => { const t = formatUnits(micro, round); return `${t} ${t === '1' ? 'unit' : 'units'}`; };
export type ExplanationCause = 'monthly-allowance' | 'purchase' | 'rollover' | 'held' | 'used' | 'returned' | 'refunded';
export type ExplanationLine = { at: number; cause: ExplanationCause; units: number; text: string };
const live = (lot: Lot, at: number) => lot.expiresAt === null || lot.expiresAt > at;
const sum = (lots: Lot[]) => lots.reduce((s, x) => s + x.remaining, 0);
const earliest = (lots: Lot[]) => lots.filter(x => x.remaining > 0).map(x => x.expiresAt).filter((x): x is number => x !== null).sort((a, b) => a - b)[0] ?? null;

/** Plain-language causes from the ledger's own recorded operations, oldest first, the latest `limit`. Expiry is shown per balance (expiredUnits), not as a line. */
function history(l: Ledger, limit: number): ExplanationLine[] {
 const lines: ExplanationLine[] = [];
 for (const { op, id, at } of l.journal) {
  const text = l.ops[`${op}:${id}`]; if (typeof text !== 'string') continue;
  const input = JSON.parse(text) as Record<string, unknown>;
  const r = Object.hasOwn(l.reservations, id) ? l.reservations[id] : undefined;
  if (op === 'grant' && input.kind === 'monthly') lines.push({ at, cause: 'monthly-allowance', units: input.units as number, text: `Monthly allowance for ${input.periodKey as string}: ${plural(input.units as number, 'down')}.` });
  else if (op === 'grant' && input.kind === 'purchased') lines.push({ at, cause: 'purchase', units: input.units as number, text: `Purchased with your approval: ${plural(input.units as number, 'down')}.` });
  else if (op === 'rollover') {
   const carried = l.lots.find(x => x.id === `rollover:${id}`)?.granted ?? 0;
   lines.push({ at, cause: 'rollover', units: carried, text: carried ? `Carried ${plural(carried, 'down')} unused in ${input.fromPeriod as string} into ${input.toPeriod as string}.` : `Nothing unused in ${input.fromPeriod as string} to carry into ${input.toPeriod as string}.` });
  }
  else if (op === 'reserve') lines.push({ at, cause: 'held', units: input.units as number, text: `Held ${plural(input.units as number, 'up')} for work in progress.` });
  else if (op === 'settle' && r) {
   const used = input.actualUnits as number, back = r.units - used;
   lines.push({ at, cause: 'used', units: used, text: `Finished work used ${plural(used, 'up')}.` });
   if (back) lines.push({ at, cause: 'returned', units: back, text: `${plural(back, 'down')} held but not needed came back.` });
  }
  else if (op === 'release' && r) lines.push({ at, cause: 'returned', units: r.units, text: `Work did not run; ${plural(r.units, 'down')} held came back.` });
  else if (op === 'refund') lines.push({ at, cause: 'refunded', units: input.units as number, text: `Refunded ${plural(input.units as number, 'down')}.` });
 }
 return lines.slice(-limit);
}

/**
 * The customer explanation at time `at`. `known` only when usage telemetry is complete; otherwise `still-calculating`, which keeps the period dates, the next expiry date and the held
 * units but no balance, percentage, allowance or history. Units returning to a lot after it expired are counted as expired, as in the ledger.
 */
export function capacityExplanation(l: Ledger, at: number, telemetry: Telemetry, options: { historyLimit?: number } = {}) {
 check(l && l.version === 1 && l.terms === 'synthetic-proposal', 'a version 1 ledger with synthetic terms');
 const limit = options.historyLimit ?? 50; check(Number.isSafeInteger(limit) && limit >= 0 && limit <= 200, 'historyLimit is 0 to 200');
 const view = capacityView(l, at, telemetry);
 const lots = l.lots.filter(x => live(x, at)), of = (kind: Lot['kind']) => lots.filter(x => x.kind === kind);
 const monthly = of('monthly').filter(x => x.grantedAt <= at).sort((a, b) => b.grantedAt - a.grantedAt || (a.id < b.id ? -1 : 1))[0] ?? null;
 const period = monthly && { key: monthly.periodKey, grantedAt: monthly.grantedAt, endsAt: monthly.expiresAt as number };
 const common = {
  terms: l.terms, termsNote: 'Proposed capacity terms for testing. This is not a bill, a purchase or an enabled plan term.',
  period, heldUnits: view.heldUnits, nextExpiryAt: view.nextExpiry,
  standardAssistance: { debitsUnits: 0 as const, text: 'Standard assistance does not use capacity.' },
  automaticTopUp: false as const, automaticUpgrade: false as const,
 };
 if (view.state !== 'known') return {
  ...common, state: 'still-calculating' as const, balances: null, availableUnits: null, monthlyRemainingPercent: null, exhausted: null, history: null,
  text: `Still calculating: usage data is ${telemetry}, so no remaining capacity is shown yet.`,
 };
 const rolled = of('rollover'), bought = of('purchased'), carriedFrom = (key: string) => l.lots.find(x => x.kind === 'monthly' && x.rolledTo === key)?.periodKey ?? null;
 const balances = {
  monthly: { units: sum(of('monthly')), allowance: monthly?.granted ?? 0, expiresAt: earliest(of('monthly')), expiredUnits: l.lots.filter(x => x.kind === 'monthly').reduce((s, x) => s + x.expiredUnits, 0) },
  rollover: { units: sum(rolled), fromPeriod: rolled[0] ? carriedFrom(rolled[0].periodKey) : null, expiresAt: earliest(rolled), expiredUnits: l.lots.filter(x => x.kind === 'rollover').reduce((s, x) => s + x.expiredUnits, 0) },
  purchased: { units: sum(bought), expiresAt: earliest(bought), expiredUnits: l.lots.filter(x => x.kind === 'purchased').reduce((s, x) => s + x.expiredUnits, 0) },
 };
 // Floor, so a nearly full allowance never reads as 100% and a nearly empty one never reads as more than is left.
 const monthlyRemainingPercent = monthly ? Math.floor(monthly.remaining * 100 / monthly.granted) : null;
 const available = view.availableUnits, exhausted = available === 0;
 const parts = [`${plural(available, 'down')} available`];
 if (balances.rollover.units) parts.push(`${plural(balances.rollover.units, 'down')} carried over`);
 if (balances.purchased.units) parts.push(`${plural(balances.purchased.units, 'down')} purchased`);
 if (view.heldUnits) parts.push(`${plural(view.heldUnits, 'up')} held for work in progress`);
 return {
  ...common, state: 'known' as const, balances, availableUnits: available, monthlyRemainingPercent, exhausted, history: history(l, limit),
  text: exhausted
   ? 'No capacity is left for metered work. Standard assistance still costs nothing; new metered work waits until more capacity is granted, and nothing is bought or upgraded automatically.'
   : `${parts.join(', ')}.`,
 };
}

// WH-171: operator-side import of exported provider statements and the aggregate reconciliation report. Pure functions over plain
// data: no database, network or clock. Statements are never stored; the report holds aggregates only (no owner, project, resource,
// task or provider-record identifiers). Mirrors the reference `reconcile()` in the WH-168 offline prototype.
import { costScale, dimensions, tariffs, type CostEvent } from './cost-events';

export class CostReconcileError extends Error {
 constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'CostReconcileError'; }
}
const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new CostReconcileError(code, detail); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const exact = (v: bigint, what: string) => { check(v >= -MAX_SAFE && v <= MAX_SAFE, 'AMOUNT_UNSAFE', `${what} is outside the exactly representable range`); return Number(v); };
const isInt = (v: unknown): v is number => Number.isSafeInteger(v);
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const SAFE = /^[A-Za-z0-9._:-]{1,128}$/, PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const TENANT_KEY = /owner|project|resource|tenant|account|user|customer|task|workspace/i;
const CONTENT_KEY = /prompt|content|text|body|message|email|secret|token|authorization|apikey|password|cookie|name|url/i;

export type StatementLine = { lineKey: string; category: string; kind: 'usage' | 'liability'; dimension: string | null; amountMicros: number | null };
export type Statement = { provider: string; invoiceId: string; period: string; currency: 'USD'; lines: StatementLine[] };

const strict = (value: unknown, keys: readonly string[], where: string): Record<string, unknown> => {
 check(plain(value), 'INVALID_STATEMENT', where);
 for (const k of Object.keys(value)) {
  if (keys.includes(k)) continue;
  check(!TENANT_KEY.test(k), 'TENANT_FIELD', `${where}.${k}`);
  check(!CONTENT_KEY.test(k), 'CONTENT_FIELD', `${where}.${k}`);
  check(false, 'UNKNOWN_FIELD', `${where}.${k}`);
 }
 for (const k of keys) check(Object.hasOwn(value, k), 'MISSING_FIELD', `${where}.${k}`);
 return value;
};

/** Validates one statement. `amountMicros: null` is an explicit unknown amount (never read as zero); a negative amount is a credit. */
export function validateStatement(input: unknown): Statement {
 const s = strict(input, ['provider', 'invoiceId', 'period', 'currency', 'lines'], 'statement');
 check(typeof s.provider === 'string' && SAFE.test(s.provider) && Object.values(dimensions).some(d => d.provider === s.provider), 'INVALID_STATEMENT', 'provider');
 check(typeof s.invoiceId === 'string' && SAFE.test(s.invoiceId), 'INVALID_STATEMENT', 'invoiceId');
 check(typeof s.period === 'string' && PERIOD.test(s.period), 'INVALID_STATEMENT', 'period');
 check(s.currency === 'USD', 'INVALID_STATEMENT', 'currency');
 check(Array.isArray(s.lines) && s.lines.length <= 5000, 'INVALID_STATEMENT', 'lines');
 const lines = (s.lines as unknown[]).map((raw, i): StatementLine => {
  const l = strict(raw, ['lineKey', 'category', 'kind', 'dimension', 'amountMicros'], `lines[${i}]`);
  check(typeof l.lineKey === 'string' && SAFE.test(l.lineKey), 'INVALID_LINE', `lines[${i}].lineKey`);
  check(typeof l.category === 'string' && SAFE.test(l.category), 'INVALID_LINE', `lines[${i}].category`);
  check(l.kind === 'usage' || l.kind === 'liability', 'INVALID_LINE', `lines[${i}].kind`);
  check(l.amountMicros === null || isInt(l.amountMicros), 'INVALID_LINE', `lines[${i}].amountMicros`);
  const dim = l.dimension === null ? null : typeof l.dimension === 'string' && Object.hasOwn(dimensions, l.dimension) ? (dimensions as Record<string, { kind: string; provider: string }>)[l.dimension] : undefined;
  check(dim === null || (dim !== undefined && dim.kind === l.kind && dim.provider === s.provider), 'INVALID_LINE', `lines[${i}].dimension`);
  return { lineKey: l.lineKey, category: l.category, kind: l.kind, dimension: l.dimension as string | null, amountMicros: l.amountMicros as number | null };
 });
 return { provider: s.provider as string, invoiceId: s.invoiceId as string, period: s.period as string, currency: 'USD', lines };
}

type Line = StatementLine & { provider: string; invoiceId: string; period: string };
/** Validates statements and dedupes lines by (provider, invoiceId, lineKey). An identical repeat is counted and dropped (re-importing
 * a file is a no-op); the same key with different content is refused rather than picked between. */
export function importStatements(inputs: unknown[]) {
 const seen = new Map<string, string>(), lines: Line[] = [];
 let duplicates = 0;
 for (const input of inputs) {
  const s = validateStatement(input);
  for (const l of s.lines) {
   const key = `${s.provider}|${s.invoiceId}|${l.lineKey}`, body = JSON.stringify([s.period, l.category, l.kind, l.dimension, l.amountMicros]);
   if (seen.has(key)) { check(seen.get(key) === body, 'STATEMENT_CONFLICT', `line ${l.lineKey} of ${s.invoiceId} repeats with different content`); duplicates++; continue; }
   seen.set(key, body); lines.push({ ...l, provider: s.provider, invoiceId: s.invoiceId, period: s.period });
  }
 }
 return { lines, duplicates };
}

const periodOf = (e: CostEvent) => e.occurredAt.slice(0, 7);
export type Side = { known: bigint; tariffNum: bigint; unknownEvents: number; unfinished: number; bounded: bigint; unbounded: number; events: number };
export const side = (): Side => ({ known: 0n, tariffNum: 0n, unknownEvents: 0, unfinished: 0, bounded: 0n, unbounded: 0, events: 0 });
export function add(b: Side, e: CostEvent) {
 b.events++;
 if (e.outcome === 'pending' || e.outcome === 'uncertain') b.unfinished++;
 const c = e.cost;
 if (c.basis === 'tariff' && e.quantity.state === 'known') {
  const r = tariffs[c.tariff.id][c.tariff.version].rates[e.dimension];
  b.tariffNum += BigInt(e.quantity.value) * BigInt(r.micros) * (costScale / BigInt(r.perUnits)); // the pinned version prices it; no allowance is subtracted
 } else if (c.basis === 'receipt' || c.basis === 'provider-reported') b.known += BigInt(c.micros);
 else if (c.basis === 'unknown') { b.unknownEvents++; if (c.exposureMicros === null) b.unbounded++; else b.bounded += BigInt(c.exposureMicros); }
}
export const knownOf = (b: Side) => b.known + (b.tariffNum + costScale - 1n) / costScale;

/**
 * One aggregate row per provider and period. `events` are cost-event heads (any owner). Shadow estimates are excluded and only
 * their total is shown; liability events and invoice liability lines are compared as account-wide totals, never split by tenant.
 * Reconciled only when nothing is unknown or unfinished (events or statement lines) and the residual is within tolerance.
 */
export function reconciliationReport(statements: unknown[], events: CostEvent[], { toleranceMicros = 0 } = {}) {
 check(isInt(toleranceMicros) && toleranceMicros >= 0, 'INVALID_TOLERANCE', 'toleranceMicros must be a non-negative safe integer');
 const { lines, duplicates } = importStatements(statements);
 type Group = { provider: string; period: string; lines: Line[]; usage: Side; liab: Side; shadow: bigint; byDim: Map<string, Side> };
 const groups = new Map<string, Group>();
 const group = (provider: string, period: string) => {
  const k = `${provider}|${period}`;
  if (!groups.has(k)) groups.set(k, { provider, period, lines: [], usage: side(), liab: side(), shadow: 0n, byDim: new Map() });
  return groups.get(k)!;
 };
 for (const l of lines) group(l.provider, l.period).lines.push(l);
 for (const e of events) {
  const dim = dimensions[e.dimension], g = group(dim.provider, periodOf(e));
  if (e.cost.basis === 'shadow') { g.shadow += BigInt(e.cost.micros); continue; }
  add(dim.kind === 'liability' ? g.liab : g.usage, e);
  if (dim.kind === 'liability') { if (!g.byDim.has(e.dimension)) g.byDim.set(e.dimension, side()); add(g.byDim.get(e.dimension)!, e); }
 }
 const rows = [...groups.values()].sort((a, b) => (a.provider + a.period < b.provider + b.period ? -1 : 1)).map(g => {
  const inv = (kind: string) => g.lines.filter(l => l.kind === kind);
  const sum = (ls: Line[]) => ls.reduce((s, l) => s + BigInt(l.amountMicros ?? 0), 0n);
  const unknownLines = g.lines.filter(l => l.amountMicros === null).length;
  const iu = sum(inv('usage')), il = sum(inv('liability')), ru = knownOf(g.usage), rl = knownOf(g.liab);
  const residual = iu + il - ru - rl;
  const unknown = g.usage.unknownEvents + g.liab.unknownEvents + unknownLines, unfinished = g.usage.unfinished + g.liab.unfinished;
  const status = !g.lines.length ? 'no-statement' : unknown > 0 || unfinished > 0 ? 'incomplete' : (residual < 0n ? -residual : residual) <= BigInt(toleranceMicros) ? 'reconciled' : 'unexplained-residual';
  // The register keeps unknown amounts explicit: a null amount is unknown, never summed as zero.
  const register = inv('liability').map(l => ({ category: l.category, dimension: l.dimension, amountMicros: l.amountMicros, state: l.amountMicros === null ? 'unknown' : 'known' })).sort((a, b) => (a.category < b.category ? -1 : 1));
  return {
   provider: g.provider, period: g.period, status, invoiceIds: [...new Set(g.lines.map(l => l.invoiceId))].sort(), invoiceLines: g.lines.length, unknownInvoiceLines: unknownLines,
   invoiceUsageMicros: exact(iu, 'invoiceUsageMicros'), invoiceLiabilityMicros: exact(il, 'invoiceLiabilityMicros'),
   recordedUsageMicros: exact(ru, 'recordedUsageMicros'), recordedLiabilityMicros: exact(rl, 'recordedLiabilityMicros'), shadowExcludedMicros: exact(g.shadow, 'shadowExcludedMicros'),
   usageResidualMicros: exact(iu - ru, 'usageResidualMicros'), liabilityResidualMicros: exact(il - rl, 'liabilityResidualMicros'), residualMicros: exact(residual, 'residualMicros'),
   unknownEvents: g.usage.unknownEvents + g.liab.unknownEvents, unfinishedEvents: unfinished,
   boundedExposureMicros: exact(g.usage.bounded + g.liab.bounded, 'boundedExposureMicros'), unboundedExposureEvents: g.usage.unbounded + g.liab.unbounded,
   liabilityRegister: register,
   recordedLiabilities: [...g.byDim.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([dimension, b]) => ({ dimension, events: b.events, knownMicros: exact(knownOf(b), dimension), unknownEvents: b.unknownEvents })),
   // shortcut: there is no period-close table (out of scope for WH-171), so late-after-close restatements are not tracked here.
   lateAfterClose: null,
   allowanceTreatment: 'account-wide allowances and floors are never allocated to tenants; a negative residual is account upside, not tenant credit'
  };
 });
 return { toleranceMicros, duplicateLinesDropped: duplicates, rows };
}

export const statementCsvHeader = 'provider,invoiceId,period,currency,lineKey,category,kind,dimension,amountMicros';
/** One CSV line per statement line, grouped into statements by (provider, invoiceId, period). Empty `dimension` is null; empty
 * `amountMicros` is an explicit unknown amount. shortcut: no quoting or escaping (every field is a restricted identifier or integer), so a quote is refused. */
export function parseStatementCsv(text: string): Statement[] {
 const rows = text.replace(/\r\n/g, '\n').split('\n').filter(r => r !== '');
 check(rows[0] === statementCsvHeader, 'INVALID_STATEMENT', 'csv header');
 const out = new Map<string, Record<string, unknown> & { lines: unknown[] }>();
 for (const [i, row] of rows.slice(1).entries()) {
  check(!row.includes('"'), 'INVALID_STATEMENT', `csv row ${i + 1} must not be quoted`);
  const f = row.split(',');
  check(f.length === 9, 'INVALID_STATEMENT', `csv row ${i + 1} column count`);
  check(f[8] === '' || /^-?\d{1,16}$/.test(f[8]), 'INVALID_LINE', `csv row ${i + 1} amountMicros`);
  const key = f.slice(0, 4).join(',');
  if (!out.has(key)) out.set(key, { provider: f[0], invoiceId: f[1], period: f[2], currency: f[3], lines: [] });
  out.get(key)!.lines.push({ lineKey: f[4], category: f[5], kind: f[6], dimension: f[7] === '' ? null : f[7], amountMicros: f[8] === '' ? null : Number(f[8]) });
 }
 return [...out.values()] as unknown as Statement[];
}

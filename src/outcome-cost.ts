// WH-078: cost per successful owner outcome, by architecture class. Pure functions over plain data: no database, network, clock or provider, and nothing here
// is wired into a route or admission path. Cost events remain evidence about consumption; the report charges, credits, admits and throttles nothing
// (`customerUnits` stays 0 upstream). An outcome record names a class and a result with closed vocabularies only, so no prompt, source, visitor text, name or
// free-form reason can enter analytics. Events join an outcome only by the same owner and task reference, are de-duplicated to their latest revision first, and
// join at most once. Observed cost, tariff estimates, shadow estimates, unknown dimensions and unfinished work are reported apart; pooled standing overhead is
// never allocated to an outcome; no savings percentage is ever produced, only micros per successful outcome when the comparison is equivalent.
import { canonical, dimensions, type CostEvent } from './cost-events';
import { add, knownOf, side, type Side } from './cost-reconcile';

export class OutcomeCostError extends Error {
 constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'OutcomeCostError'; }
}
const check: (ok: unknown, code: string, detail: string) => asserts ok = (ok, code, detail) => { if (!ok) throw new OutcomeCostError(code, detail); };
const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const exact = (v: bigint, what: string) => { check(v >= -MAX_SAFE && v <= MAX_SAFE, 'AMOUNT_UNSAFE', `${what} is outside the exactly representable range`); return Number(v); };
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/, REF = /^[A-Za-z0-9._:-]{1,64}$/, TOKEN = /^[a-z]+(?:-[a-z]+){0,3}$/;

/** How the owner's change was delivered, cheapest first: settings, a shared-module composition, a custom component, a custom backend, a dedicated runtime. */
export const outcomeClasses = Object.freeze(['configuration', 'composition', 'custom-component', 'custom-backend', 'dedicated-runtime'] as const);
/** Why a request left the shared path: the only free text analytics may hold is one of these. */
export const fallbackReasons = Object.freeze(['capability-missing', 'quality-insufficient', 'performance', 'isolation', 'integration', 'owner-choice'] as const);
export type OutcomeClass = typeof outcomeClasses[number];
export type FallbackReason = typeof fallbackReasons[number];
export type OutcomeRecord = {
 ownerId: string; taskRef: string; outcomeClass: OutcomeClass; success: boolean;
 /** null = quality was not assessed; it is never read as a pass. */
 qualityPass: boolean | null;
 /** Present only when custom work followed a shared-path attempt; `capability` is the missing capability's token or null. */
 fallback: null | { reason: FallbackReason; capability: string | null };
};
const recordKeys = ['ownerId', 'taskRef', 'outcomeClass', 'success', 'qualityPass', 'fallback'];

export function validateOutcome(input: unknown): OutcomeRecord {
 check(plain(input), 'INVALID_OUTCOME', 'an outcome record is a plain object');
 const keys = Object.keys(input);
 check(keys.length === recordKeys.length && recordKeys.every(k => Object.hasOwn(input, k)), 'INVALID_OUTCOME', 'exactly the fields ' + recordKeys.join(', '));
 check(typeof input.ownerId === 'string' && UUID.test(input.ownerId), 'INVALID_OUTCOME', 'ownerId');
 check(typeof input.taskRef === 'string' && REF.test(input.taskRef), 'INVALID_OUTCOME', 'taskRef');
 check(typeof input.outcomeClass === 'string' && (outcomeClasses as readonly string[]).includes(input.outcomeClass), 'INVALID_OUTCOME', 'outcomeClass');
 check(typeof input.success === 'boolean', 'INVALID_OUTCOME', 'success');
 check(input.qualityPass === null || typeof input.qualityPass === 'boolean', 'INVALID_OUTCOME', 'qualityPass');
 check(input.qualityPass === null || input.success, 'INVALID_OUTCOME', 'quality is assessed only for a successful outcome');
 const f = input.fallback;
 if (f !== null) {
  check(plain(f) && Object.keys(f).length === 2 && Object.hasOwn(f, 'reason') && Object.hasOwn(f, 'capability'), 'INVALID_OUTCOME', 'fallback is {reason, capability}');
  check(typeof f.reason === 'string' && (fallbackReasons as readonly string[]).includes(f.reason), 'INVALID_OUTCOME', 'fallback reason');
  // A word list of at most four lower-case words (no digits, no free text); it is still only shape-checked, so a producer must draw it from a reviewed list before it is wired.
  check(f.capability === null || (typeof f.capability === 'string' && f.capability.length <= 40 && TOKEN.test(f.capability)), 'INVALID_OUTCOME', 'fallback capability is a short lower-case word list');
  check(f.reason === 'capability-missing' || f.capability === null, 'INVALID_OUTCOME', 'only a missing-capability fallback names a capability');
  check(input.outcomeClass !== 'configuration' && input.outcomeClass !== 'composition', 'INVALID_OUTCOME', 'a shared-path outcome has no fallback');
 }
 return { ownerId: input.ownerId, taskRef: input.taskRef, outcomeClass: input.outcomeClass as OutcomeClass, success: input.success, qualityPass: input.qualityPass as boolean | null, fallback: f === null ? null : { reason: f.reason as FallbackReason, capability: f.capability as string | null } };
}

/** The latest revision of each idempotency key; an exact repeat of a revision is counted and dropped, a conflicting one is refused. */
export function latestHeads(events: readonly CostEvent[]) {
 const byKey = new Map<string, CostEvent>();
 let duplicates = 0;
 for (const e of events) {
  const seen = byKey.get(e.idempotencyKey);
  if (!seen || e.revision > seen.revision) { if (seen) duplicates++; byKey.set(e.idempotencyKey, e); }
  else { duplicates++; if (e.revision === seen.revision) check(canonical(e) === canonical(seen), 'EVENT_CONFLICT', 'one revision of an event repeats with different content'); }
 }
 return { heads: [...byKey.values()], duplicatesDropped: duplicates };
}

const categories = ['inference', 'hosting', 'support', 'other'] as const;
type Bucket = { side: Side; shadow: bigint; byCategory: Map<string, Side>; byTier: Map<string, Side> };
const bucket = (): Bucket => ({ side: side(), shadow: 0n, byCategory: new Map(), byTier: new Map() });
function put(b: Bucket, e: CostEvent) {
 const dim = dimensions[e.dimension];
 const into = (m: Map<string, Side>, k: string) => { if (!m.has(k)) m.set(k, side()); return m.get(k)!; };
 if (e.cost.basis === 'shadow') { b.shadow += BigInt(e.cost.micros); return; }
 add(b.side, e); add(into(b.byCategory, dim.financeCategory), e);
 if (e.aiTier) add(into(b.byTier, e.aiTier), e);
}
const view = (s: Side, what: string) => ({ events: s.events, knownMicros: exact(knownOf(s), what), observedMicros: exact(s.known, what + ' observed'), tariffMicros: exact(knownOf(s) - s.known, what + ' tariff'), unknownEvents: s.unknownEvents, unfinishedEvents: s.unfinished, boundedExposureMicros: exact(s.bounded, what + ' exposure'), unboundedExposureEvents: s.unbounded });
const complete = (s: Side) => s.unknownEvents === 0 && s.unfinished === 0;

/** Exact receipt links only, not semantic task grouping. The event and its idempotency key are never rewritten. */
export type OutcomeTaskLink = { ownerId: string; taskRef: string; outcomeTaskRef: string; projectId: string };
/**
 * One row per outcome class plus the fallback picture and what could not be attributed. `events` may hold several revisions and repeats; `outcomes` are validated.
 * Per-success cost is null unless the class has a successful outcome, and `complete` says whether any unknown or unfinished event sits under it: an incomplete
 * number is a lower bound, never an estimate of the total.
 */
export function outcomeCostReport(events: readonly CostEvent[], outcomes: readonly unknown[], taskLinks: readonly OutcomeTaskLink[] = []) {
 const records = outcomes.map(validateOutcome);
 const index = new Map<string, OutcomeRecord>();
 for (const r of records) { const k = `${r.ownerId}|${r.taskRef}`; check(!index.has(k), 'DUPLICATE_OUTCOME', 'one outcome per owner and task'); index.set(k, r); }
 const links = new Map<string, OutcomeTaskLink>();
 for (const link of taskLinks) {
  check(plain(link) && Object.keys(link).length === 4 && ['ownerId', 'taskRef', 'outcomeTaskRef', 'projectId'].every(k => Object.hasOwn(link, k)), 'INVALID_TASK_LINK', 'exact receipt link fields');
  check(UUID.test(link.ownerId) && UUID.test(link.projectId) && REF.test(link.taskRef) && REF.test(link.outcomeTaskRef), 'INVALID_TASK_LINK', 'receipt identities');
  const key = `${link.ownerId}|${link.taskRef}`, target = index.get(`${link.ownerId}|${link.outcomeTaskRef}`);
  check(target && (!index.has(key) || link.taskRef === link.outcomeTaskRef) && !links.has(key), 'INVALID_TASK_LINK', 'one unambiguous owner-scoped outcome per source task');
  links.set(key, link);
 }
 const { heads, duplicatesDropped } = latestHeads(events);
 const perClass = new Map<OutcomeClass, Bucket>(outcomeClasses.map(c => [c, bucket()]));
 const perOutcome = new Map<string, boolean>();
 const unattributed = bucket(), pooled = bucket();
 for (const e of heads) {
  if (e.workClass === 'standing' || e.attribution.scope === 'platform') { put(pooled, e); continue; }
  const key = `${e.attribution.ownerId}|${e.taskRef}`, link = links.get(key);
  const r = e.taskRef === null || (link && e.attribution.projectId !== null && e.attribution.projectId !== link.projectId) ? undefined : index.get(link ? `${link.ownerId}|${link.outcomeTaskRef}` : key);
  if (!r) { put(unattributed, e); continue; }
  put(perClass.get(r.outcomeClass)!, e);
  // Only observed or estimated usage counts as cost for the outcome: a shadow estimate is shown apart and never makes an outcome 'costed'.
  if (e.cost.basis !== 'shadow') perOutcome.set(`${r.ownerId}|${r.taskRef}`, true);
 }
 const classes = outcomeClasses.map(c => {
  const rs = records.filter(r => r.outcomeClass === c), b = perClass.get(c)!;
  const succeeded = rs.filter(r => r.success).length, pass = rs.filter(r => r.qualityPass === true).length, fail = rs.filter(r => r.qualityPass === false).length;
  const known = knownOf(b.side);
  return {
   outcomeClass: c, outcomes: rs.length, succeeded, failed: rs.length - succeeded, qualityPassed: pass, qualityFailed: fail, qualityNotAssessed: succeeded - pass - fail,
   noCostEvents: rs.filter(r => !perOutcome.has(`${r.ownerId}|${r.taskRef}`)).length,
   cost: { ...view(b.side, c), shadowMicros: exact(b.shadow, c + ' shadow'), complete: complete(b.side),
    byCategory: categories.map(k => ({ category: k, ...view(b.byCategory.get(k) ?? side(), k) })), byAiTier: ['standard', 'premium'].map(t => ({ aiTier: t, ...view(b.byTier.get(t) ?? side(), t) })) },
   microsPerSuccess: succeeded === 0 ? null : exact(known / BigInt(succeeded), c + ' per success')
  };
 });
 const fallbacks = records.filter(r => r.fallback !== null);
 const byReason = fallbackReasons.map(reason => ({ reason, outcomes: fallbacks.filter(r => r.fallback!.reason === reason).length }));
 const capabilityCounts = new Map<string, number>();
 for (const r of fallbacks) if (r.fallback!.capability) capabilityCounts.set(r.fallback!.capability, (capabilityCounts.get(r.fallback!.capability) ?? 0) + 1);
 const missingCapabilities = [...capabilityCounts.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([capability, outcomesAffected]) => ({ capability, outcomesAffected, repeated: outcomesAffected >= 2 }));
 return {
  classes, fallbacks: { outcomes: fallbacks.length, byReason, missingCapabilities },
  unattributed: { ...view(unattributed.side, 'unattributed'), shadowMicros: exact(unattributed.shadow, 'unattributed shadow') },
  pooledOverhead: { ...view(pooled.side, 'pooled'), shadowMicros: exact(pooled.shadow, 'pooled shadow'), allocated: false as const, note: 'standing and platform cost is fixed pooled overhead and is never split across outcomes' },
  duplicateEventsDropped: duplicatesDropped, customerUnits: 0 as const,
  limits: 'Per-success cost counts only events attributed to an outcome by owner and task; shadow estimates are shown apart and never added; an incomplete class is a lower bound.'
 };
}
type Report = ReturnType<typeof outcomeCostReport>;

/**
 * Two classes are compared only on equivalent evidence: the same minimum number of successful outcomes, the same quality assessment on all of them, and complete
 * cost on both. The answer is micros per success for each and their difference, or the reasons it is not comparable. It never yields a percentage.
 */
export function compareClasses(report: Report, a: OutcomeClass, b: OutcomeClass, { minSuccesses = 5 } = {}) {
 check(Number.isSafeInteger(minSuccesses) && minSuccesses >= 1, 'INVALID_THRESHOLD', 'minSuccesses is a positive integer');
 check(a !== b, 'INVALID_COMPARISON', 'compare two different classes');
 const x = report.classes.find(c => c.outcomeClass === a)!, y = report.classes.find(c => c.outcomeClass === b)!;
 const reasons: string[] = [];
 for (const c of [x, y]) {
  if (c.succeeded < minSuccesses) reasons.push(`${c.outcomeClass}: fewer than ${minSuccesses} successful outcomes`);
  if (c.qualityNotAssessed > 0) reasons.push(`${c.outcomeClass}: quality not assessed on ${c.qualityNotAssessed} successful outcomes`);
  if (c.qualityFailed > 0) reasons.push(`${c.outcomeClass}: ${c.qualityFailed} successful outcomes failed quality`);
  if (!c.cost.complete) reasons.push(`${c.outcomeClass}: unknown or unfinished cost`);
  if (c.noCostEvents > 0) reasons.push(`${c.outcomeClass}: ${c.noCostEvents} outcomes have no cost events`);
 }
 if (reasons.length) return { comparable: false as const, reasons };
 return { comparable: true as const, [a]: x.microsPerSuccess, [b]: y.microsPerSuccess, differenceMicros: x.microsPerSuccess! - y.microsPerSuccess!, note: 'micros per successful outcome; no percentage is claimed' };
}

/** Standard module instance kinds and the standard modules beyond the required `content` module: the only names reuse evidence may carry. */
export const reuseKinds = Object.freeze(['content', 'records', 'files', 'access'] as const);
export const reuseModules = Object.freeze(['notifications', 'automation'] as const);
/** Structural evidence for one outcome: instance counts per standard kind and which extra standard modules the saved specification includes. */
export type CompositionUse = { ownerId: string; outcomeTaskRef: string; projectId: string; instances: Record<typeof reuseKinds[number], number>; modules: Record<typeof reuseModules[number], boolean> };
const useKeys = ['ownerId', 'outcomeTaskRef', 'projectId', 'instances', 'modules'];
const exactShape = (v: unknown, keys: readonly string[]): v is Record<string, unknown> => plain(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));

/**
 * Composition reuse: how many successful shared-path outcomes, and how many distinct projects, use each standard module kind and module. `uses` is structural
 * evidence for an outcome (instance counts per closed kind, presence of each standard module); no instance id, configuration, name or content is accepted. The
 * evidence must agree with the outcome's class (a composition uses at least one instance or extra module, a configuration none), and custom classes carry none.
 * Counts are never turned into cost per module or a saving: module maintenance is not measured, so break-even stays unknown.
 */
export function compositionReuse(outcomes: readonly unknown[], uses: readonly unknown[]) {
 const records = outcomes.map(validateOutcome), index = new Map<string, OutcomeRecord>();
 for (const r of records) { const k = `${r.ownerId}|${r.taskRef}`; check(!index.has(k), 'DUPLICATE_OUTCOME', 'one outcome per owner and task'); index.set(k, r); }
 const seen = new Set<string>(), kinds = reuseKinds.map(() => ({ outcomes: 0, instances: 0, projects: new Set<string>() })), modules = reuseModules.map(() => ({ outcomes: 0, projects: new Set<string>() }));
 const compositionProjects = new Set<string>();
 let configuration = 0, composition = 0, unsuccessful = 0;
 for (const u of uses) {
  check(exactShape(u, useKeys), 'INVALID_REUSE', 'exactly the fields ' + useKeys.join(', '));
  check(typeof u.ownerId === 'string' && UUID.test(u.ownerId) && typeof u.projectId === 'string' && UUID.test(u.projectId) && typeof u.outcomeTaskRef === 'string' && REF.test(u.outcomeTaskRef), 'INVALID_REUSE', 'identities');
  check(exactShape(u.instances, reuseKinds) && reuseKinds.every(k => Number.isSafeInteger((u.instances as Record<string, unknown>)[k]) && ((u.instances as Record<string, number>)[k]) >= 0), 'INVALID_REUSE', 'instances are counts per standard kind');
  check(exactShape(u.modules, reuseModules) && reuseModules.every(k => typeof (u.modules as Record<string, unknown>)[k] === 'boolean'), 'INVALID_REUSE', 'modules are presence flags per standard module');
  const key = `${u.ownerId}|${u.outcomeTaskRef}`, r = index.get(key);
  check(r && !seen.has(key), 'INVALID_REUSE', 'one use per existing outcome');
  seen.add(key);
  const counts = u.instances as Record<string, number>, present = u.modules as Record<string, boolean>, projectId = u.projectId as string;
  const structural = reuseKinds.some(k => counts[k] > 0) || reuseModules.some(k => present[k]);
  check(r.outcomeClass === 'configuration' || r.outcomeClass === 'composition', 'REUSE_MISMATCH', 'only shared-path outcomes carry reuse evidence');
  check(structural === (r.outcomeClass === 'composition'), 'REUSE_MISMATCH', 'reuse evidence disagrees with the outcome class');
  if (!r.success) { unsuccessful++; continue; }
  if (!structural) { configuration++; continue; }
  composition++; compositionProjects.add(projectId);
  reuseKinds.forEach((k, i) => { if (counts[k] > 0) { kinds[i].outcomes++; kinds[i].instances += counts[k]; kinds[i].projects.add(projectId); } });
  reuseModules.forEach((k, i) => { if (present[k]) { modules[i].outcomes++; modules[i].projects.add(projectId); } });
 }
 const withoutEvidence = records.filter(r => (r.outcomeClass === 'configuration' || r.outcomeClass === 'composition') && !seen.has(`${r.ownerId}|${r.taskRef}`)).length;
 return {
  successfulConfiguration: configuration, successfulComposition: composition, compositionProjects: compositionProjects.size, unsuccessful, withoutEvidence,
  byKind: reuseKinds.map((kind, i) => ({ kind, outcomes: kinds[i].outcomes, projects: kinds[i].projects.size, instances: kinds[i].instances, reusedAcrossProjects: kinds[i].projects.size >= 2 })),
  byModule: reuseModules.map((module, i) => ({ module, outcomes: modules[i].outcomes, projects: modules[i].projects.size, reusedAcrossProjects: modules[i].projects.size >= 2 })),
  costAllocated: false as const, moduleMaintenance: 'not-measured' as const,
  limits: 'Counts of successful outcomes and distinct projects using each standard module; no cost is allocated to a module and no saving is claimed. Break-even needs measured module maintenance and an equivalent custom baseline.'
 };
}

/**
 * Shared-module break-even: how many outcomes it takes before a fixed maintenance cost is repaid by the per-outcome saving. Inputs must be measured (null = unknown
 * gives an unknown answer, never a guess). Returns null outcomes when the shared path does not save anything per outcome.
 */
export function breakEvenOutcomes(input: { fixedMaintenanceMicros: number | null; customMicrosPerOutcome: number | null; sharedMicrosPerOutcome: number | null }) {
 const { fixedMaintenanceMicros: fixed, customMicrosPerOutcome: custom, sharedMicrosPerOutcome: shared } = input;
 for (const [k, v] of Object.entries({ fixed, custom, shared })) check(v === null || (Number.isSafeInteger(v) && v >= 0), 'INVALID_INPUT', `${k} is a non-negative integer or null`);
 if (fixed === null || custom === null || shared === null) return { state: 'unknown' as const, reason: 'an input is not measured' };
 if (custom <= shared) return { state: 'no-saving' as const, outcomes: null };
 const saving = BigInt(custom - shared);
 return { state: 'known' as const, outcomes: exact((BigInt(fixed) + saving - 1n) / saving, 'break-even outcomes') };
}

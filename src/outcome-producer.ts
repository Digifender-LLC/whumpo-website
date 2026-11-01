import { validateCostEvent, type CostEvent } from './cost-events';
import { outcomeCostReport, type OutcomeRecord, type OutcomeTaskLink } from './outcome-cost';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const LIMIT = 2000, EVENT_LIMIT = 10000;
export class OutcomeProducerError extends Error {
 constructor(readonly code: string) { super(code); }
}
const requireFact: (ok: unknown, code: string) => asserts ok = (ok, code) => { if (!ok) throw new OutcomeProducerError(code); };
function window(from: string, to: string, owner: string) {
 requireFact(UUID.test(owner), 'INVALID_OWNER');
 for (const date of [from, to]) requireFact(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === date, 'INVALID_WINDOW');
 requireFact(from < to && Date.parse(to) - Date.parse(from) <= 93 * 86400000, 'INVALID_WINDOW');
}

type Receipt = { id: string; user_id: string; project_id: string; proposal_id: string; valid_version: number; schema_version: number | null; compiler_version: number | null; instances: number | null; modules: number | null; known_instances: number; known_modules: number };

/** An empty reviewed vocabulary is intentional: today's receipts do not prove a delivered custom fallback. */
export const producedMissingCapabilities = Object.freeze([] as const);
export async function produceOutcomes(db: Pick<D1Database, 'prepare'>, from: string, to: string, owner: string) {
 window(from, to, owner);
 // Only structural metadata crosses this projection. Current admission validates schema-3/compiler-7 pins.
 const { results } = await db.prepare(`SELECT r.id,r.user_id,r.project_id,r.proposal_id,
 v.version_id IS NOT NULL AND v.proposal_id=r.proposal_id AND v.revision=r.revision valid_version,
 json_extract(v.spec_json,'$.schemaVersion') schema_version,
 json_extract(v.lock_json,'$.compiler.version') compiler_version,
 json_array_length(v.spec_json,'$.instances') instances,
 json_array_length(v.spec_json,'$.modules') modules,
 NOT EXISTS(SELECT 1 FROM json_each(v.spec_json,'$.instances') i WHERE json_extract(i.value,'$.kind') IS NULL OR json_extract(i.value,'$.kind') NOT IN ('content','records','files','access')) known_instances,
 NOT EXISTS(SELECT 1 FROM json_each(v.spec_json,'$.modules') m WHERE json_extract(m.value,'$.id') IS NULL OR json_extract(m.value,'$.id') NOT IN ('content','notifications','automation')) known_modules
FROM project_spec_applies r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id
LEFT JOIN project_spec_versions v ON v.version_id=r.version_id AND v.project_id=r.project_id
WHERE r.user_id=? AND r.created_at>=? AND r.created_at<? ORDER BY r.id LIMIT 2001`).bind(owner, from, to).all<Receipt>();
 requireFact(results.length <= LIMIT, 'OUTCOME_BOUND');
 const outcomes: OutcomeRecord[] = [], taskLinks: OutcomeTaskLink[] = [];
 const unsupported = { missingVersion: 0, classificationUnknown: 0 };
 for (const r of results) {
  requireFact(r.user_id === owner && [r.id, r.project_id, r.proposal_id].every(v => typeof v === 'string' && UUID.test(v)), 'RECEIPT_SCOPE');
  if (!r.valid_version) { unsupported.missingVersion++; continue; }
  if (r.schema_version !== 3 || r.compiler_version !== 7 || !r.known_instances || !r.known_modules || !Number.isSafeInteger(r.instances) || r.instances! < 0 || !Number.isSafeInteger(r.modules) || r.modules! < 1) { unsupported.classificationUnknown++; continue; }
  outcomes.push({ ownerId: owner, taskRef: r.id, outcomeClass: r.instances! > 0 || r.modules! > 1 ? 'composition' : 'configuration', success: true, qualityPass: null, fallback: null });
  for (const taskRef of new Set([r.id, r.proposal_id])) taskLinks.push({ ownerId: owner, taskRef, outcomeTaskRef: r.id, projectId: r.project_id });
 }
 // Validate ambiguous links even when no cost event exists yet.
 outcomeCostReport([], outcomes, taskLinks);
 return { outcomes, taskLinks, receipts: results.length, unsupported };
}

/** Private operator read: retained receipts by commit time; all currently recorded costs for their exact task links.
 * Other events in the window stay unattributed (including failed/unfinished work); pool cost is never allocated. */
export async function producedOutcomeCostReport(db: Pick<D1Database, 'prepare'>, from: string, to: string, owner: string) {
 const produced = await produceOutcomes(db, from, to, owner);
 const tasks = new Map(produced.taskLinks.map(l => [l.taskRef, l.projectId]));
 const { results } = await db.prepare(`SELECT event_json,scope,owner_id,project_id FROM cost_events
 WHERE owner_id=? OR (scope='platform' AND occurred_at>=? AND occurred_at<?)
 ORDER BY seq LIMIT 10001`).bind(owner, from, to).all<{ event_json: string; scope: string; owner_id: string | null; project_id: string | null }>();
 requireFact(results.length <= EVENT_LIMIT, 'EVENT_BOUND');
 const events: CostEvent[] = [];
 for (const row of results) {
  const e = await validateCostEvent(JSON.parse(row.event_json));
  const a = e.attribution;
  requireFact(a.scope === row.scope && (a.scope === 'platform' ? row.owner_id === null && row.project_id === null : a.ownerId === owner && a.ownerId === row.owner_id && a.projectId === row.project_id), 'EVENT_SCOPE');
  if ((e.occurredAt >= from && e.occurredAt < to) || (a.scope === 'tenant' && e.taskRef !== null && tasks.has(e.taskRef) && (a.projectId === null || a.projectId === tasks.get(e.taskRef)))) events.push(e);
 }
 return { version: 1, scope: 'one-account', from, toExclusive: to,
  evidence: { receipts: produced.receipts, produced: produced.outcomes.length, unsupported: produced.unsupported, quality: 'not-assessed', fallback: 'unavailable', unsupportedClasses: ['custom-component', 'custom-backend', 'dedicated-runtime'] },
  report: outcomeCostReport(events, produced.outcomes, produced.taskLinks),
  limitations: [
   'Success means an owner-confirmed saved private specification apply, not publication, module activation, useful task completion or a quality pass. First-draft creations lack owner confirmation and are not outcomes.',
   'Class describes the saved specification architecture, not which modules changed. Planner intent, compiled proposals and saved custom source are not delivered outcomes.',
   'Only exact proposal and confirmation turn identities join. Creation, other Chat, interaction and planner tasks are not inferred to be the same work.',
   'Receipt cohort uses commit time; linked costs include current retained revisions outside the window. Other in-window failed and unfinished work stays unattributed. Not a historical period close.',
   'Missing/deleted versions cannot be classified. Deleted history, missed emissions, build/test, support and module-maintenance measurements remain unavailable; complete cost-event coverage is not full lifecycle cost.',
   'Quality is unknown on every produced outcome, so no equivalent-quality savings comparison is available. Standard AI customer units remain zero.'
  ] };
}

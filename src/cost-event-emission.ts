// WH-170: shadow emission at the existing receipt transitions. Each emitter runs AFTER the receipt transition has committed, in its own
// statements, rereads the receipt row, builds the event with the WH-169 adapter and appends it. It is evidence only: a failure of any
// step (a refused event, a missing row, a database error) is caught and logged by category and never rolls back, blocks or changes the
// customer operation, and it never records a zero for a cost it could not build. Nothing here is awaited inside a receipt batch.
import { costEventFromGatewayAttempt, costEventFromInferenceCall, costEventFromProjectStorageUsage, type GatewayAttemptRow, type InferenceCallRow } from './cost-event-adapters';
import { appendCostEvent } from './cost-event-store';
import { CostEventError, idempotencyKey } from './cost-events';

/** The one place an emission failure ends. The log names the category only: no owner, project, task or provider identifier. */
export async function emitCostEvent(run: () => Promise<unknown>) {
 try { await run(); } catch (cause) {
  console.warn(JSON.stringify({ event: 'cost_event.emission_failed', code: cause instanceof CostEventError ? cause.code : 'unexpected' }));
 }
}

/** Reread the inference receipt (the adapter reads only these columns) and append its current revision. */
export const emitInferenceCall = (db: D1Database, owner: string, id: string) => emitCostEvent(async () => {
 const row = await db.prepare('SELECT id,turn_id,user_id,role,status,cost_basis,rate_id,reserved_micros,input_tokens,output_tokens,estimated_micros,created_at FROM inference_calls WHERE id=? AND user_id=?').bind(id, owner).first<InferenceCallRow>();
 if (row) await appendCostEvent(db, await costEventFromInferenceCall(row));
});

/** The attempt keeps no timestamps (gap G-C5), so `occurredAt` is the first revision's stored time, or now for the first emission;
 * `observedAt` equals it, so a redelivery of any revision reproduces the stored bytes. The provider's own event or log ID is learned
 * from the provider receipt once captured. */
export const emitGatewayAttempt = (db: D1Database, owner: string, id: string) => emitCostEvent(async () => {
 const row = await db.prepare('SELECT id,user_id,task_id,snapshot,status,provider_reserved,input_tokens,output_tokens,provider_actual FROM gateway_spend_attempts WHERE id=? AND user_id=?').bind(id, owner).first<GatewayAttemptRow>();
 if (!row) return;
 const key = await idempotencyKey({ source: 'gateway-settlement', sourceEventId: row.id, dimension: 'ai.inference.call' });
 const first = await db.prepare('SELECT occurred_at FROM cost_events WHERE idempotency_key=? ORDER BY revision LIMIT 1').bind(key).first<{ occurred_at: string }>();
 const receipt = await db.prepare('SELECT COALESCE(event_id,log_id) AS provider_id FROM gateway_provider_receipts WHERE attempt_id=?').bind(id).first<{ provider_id: string | null }>();
 await appendCostEvent(db, await costEventFromGatewayAttempt(row, { occurredAt: first?.occurred_at ?? new Date().toISOString(), providerEventId: receipt?.provider_id ?? null }));
});

/** One project's public photo reads this month: the counter is the revision, so the latest reading wins in any arrival order. The table
 * has no owner or timestamp; the owner is the project's registered owner and `observedAt` is the start of the period. A reading is
 * recorded only when the counter reaches a power of two (at most 16 events per project and month, the last at most half the true
 * count behind it): every reading would add a row and three statements to each anonymous photo request, and the exact counter stays in
 * `storage_project_usage` for WH-171 to read at period close. */
export const emitProjectStorageRead = (db: D1Database, project: string) => emitCostEvent(async () => {
 const row = await db.prepare("SELECT u.project_id,u.period,u.read_ops,p.owner_user_id FROM storage_project_usage u JOIN projects p ON p.id=u.project_id WHERE u.project_id=? AND u.period=strftime('%Y-%m','now')").bind(project).first<{ project_id: string; period: string; read_ops: number; owner_user_id: string }>();
 if (row && (row.read_ops & (row.read_ops - 1)) === 0) await appendCostEvent(db, await costEventFromProjectStorageUsage({ project_id: row.project_id, period: row.period, read_ops: row.read_ops }, { ownerId: row.owner_user_id, observedAt: `${row.period}-01T00:00:00.000Z` }));
});

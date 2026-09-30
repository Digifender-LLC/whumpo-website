/** Private calibration only. No prompts, identifiers, inferred task classes, customer charges or admission changes. */
type Row = { state: string; calls: number; observed: number; released: number; pending: number; unpriced: number; input: number; output: number; shadow: number; held: number };
const numeric = ['calls', 'observed', 'released', 'pending', 'unpriced', 'input', 'output', 'shadow', 'held'] as const;
function distribution(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  const total = sorted.reduce((a,b)=>a+b,0);
  if (!Number.isSafeInteger(total)) throw Error('Calibration overflow');
  return { samples: sorted.length, total, mean: total / sorted.length, p50: sorted[Math.ceil(sorted.length * .5)-1], p95: sorted[Math.ceil(sorted.length * .95)-1], max: sorted.at(-1)! };
}
export async function taskCostReport(db: Pick<D1Database, 'prepare'>, from: string, toExclusive: string, owner?: string) {
  for (const date of [from,toExclusive]) if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) throw Error('Invalid report window');
  if (from >= toExclusive || Date.parse(toExclusive)-Date.parse(from)>93*86400000) throw Error('Report window must be at most 93 days');
  if (owner !== undefined && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(owner)) throw Error('Invalid owner');
  // Select turns by creation time; include their entire currently recorded call history.
  // A missing call cannot become a zero-cost sample. Join on both turn and owner.
  const {results} = await db.prepare(`SELECT t.status state, COUNT(c.id) calls,
   SUM(CASE WHEN c.status='observed' THEN 1 ELSE 0 END) observed,
   SUM(CASE WHEN c.status='released' THEN 1 ELSE 0 END) released,
   SUM(CASE WHEN c.status IN ('reserved','dispatched','uncertain') THEN 1 ELSE 0 END) pending,
   SUM(CASE WHEN c.id IS NOT NULL AND c.cost_basis!='subscription-shadow' THEN 1 ELSE 0 END) unpriced,
   COALESCE(SUM(c.input_tokens),0) input, COALESCE(SUM(c.output_tokens),0) output,
   COALESCE(SUM(CASE WHEN c.cost_basis='subscription-shadow' AND c.status='observed' THEN c.estimated_micros ELSE 0 END),0) shadow,
   COALESCE(SUM(CASE WHEN c.cost_basis='subscription-shadow' AND c.status IN ('reserved','dispatched','uncertain') THEN c.reserved_micros ELSE 0 END),0) held
   FROM chat_turns t LEFT JOIN inference_calls c ON c.turn_id=t.id AND c.user_id=t.user_id
   WHERE t.mode='ai' AND t.created_at>=? AND t.created_at<? AND (? IS NULL OR t.user_id=?)
   GROUP BY t.id,t.user_id,t.status ORDER BY t.id LIMIT 10001`).bind(from,toExclusive,owner??null,owner??null).all<Row>();
  if (results.length>10000) throw Error('Report exceeds 10000 turns; narrow the window');
  const groups: Record<string,{turns:number;calls:number;observedShadowMicros:number;heldShadowMicros:number}> = {};
  const costs:number[]=[],inputs:number[]=[],outputs:number[]=[],callCounts:number[]=[];
  const excluded={noReceipts:0,unfinishedCalls:0,unpriced:0,noObservedCalls:0,notCompleted:0};
  for (const row of results) {
    if (!['pending','completed','failed','uncertain'].includes(row.state)) throw Error('Unknown turn state');
    for (const key of numeric) if (!Number.isSafeInteger(row[key]) || row[key]<0) throw Error('Invalid calibration aggregate');
    if (row.observed+row.released+row.pending!==row.calls || row.unpriced>row.calls) throw Error('Unrecognized inference receipt');
    const group = groups[row.state] ??= {turns:0,calls:0,observedShadowMicros:0,heldShadowMicros:0};
    group.turns++;group.calls+=row.calls;group.observedShadowMicros+=row.shadow;group.heldShadowMicros+=row.held;
    if (Object.values(group).some(v=>!Number.isSafeInteger(v))) throw Error('Calibration overflow');
    if (!row.calls) excluded.noReceipts++;
    if (row.pending) excluded.unfinishedCalls++;
    if (row.unpriced) excluded.unpriced++;
    if (!row.observed) excluded.noObservedCalls++;
    if (row.state!=='completed') excluded.notCompleted++;
    if (row.state==='completed' && row.observed>0 && row.pending===0 && row.unpriced===0) {
      costs.push(row.shadow);inputs.push(row.input);outputs.push(row.output);callCounts.push(row.observed);
    }
  }
  return { version:1, scope:owner?'one_account':'all_accounts', from,toExclusive,turns:results.length,groups,excluded,
    completedFullyObserved:{shadowCostMicros:distribution(costs),inputTokens:distribution(inputs),outputTokens:distribution(outputs),observedCalls:distribution(callCounts)},
    actualProviderExpenseMicros:null, customerUnits:null, classCalibration:'unavailable',
    limitations:['Shadow estimates use historical receipt rates, not API invoices or OpenCode subscription allocations.',
      'A completed Chat turn is not proof of useful work or a completed multi-turn project. Task classes are not recorded.',
      'Excluded counts overlap. Failed and unfinished turns remain in group totals; their costs are not assigned to successful samples.',
      'Released calls are undispatched and add no consumption. Any unfinished or unpriced call excludes the whole turn from cost percentiles.',
      'Percentiles are nearest-rank observations, not forecasts; empty samples are null, never zero.',
      'Retained AI turns selected by creation time, including their calls recorded after the window. Deleted history and provider work without receipts are unavailable. This is current stored state, not a historical snapshot.',
      'Infrastructure, premium gateway attempts and external tools are not covered. No balance, profit, abuse decision or billing action follows from this report.'] };
}

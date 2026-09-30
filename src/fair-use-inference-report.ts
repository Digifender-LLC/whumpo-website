type Row={role:string;providerState:string;chatState:string;costBasis:string;calls:number;observedInputTokens:number;observedOutputTokens:number;observedShadowMicros:number;heldShadowMicros:number};
/** Private operator aggregates. No model input, content, identifiers or ledger mutations. */
export async function fairUseInferenceReport(db:Pick<D1Database,'prepare'>,owner:string|undefined,start:string,end:string){
 const {results}=await db.prepare(`SELECT c.role,c.status providerState,t.status chatState,c.cost_basis costBasis,
 count(*) calls,COALESCE(sum(c.input_tokens),0) observedInputTokens,COALESCE(sum(c.output_tokens),0) observedOutputTokens,
 COALESCE(sum(CASE WHEN c.cost_basis='subscription-shadow' AND c.status='observed' THEN c.estimated_micros ELSE 0 END),0) observedShadowMicros,
 COALESCE(sum(CASE WHEN c.cost_basis='subscription-shadow' AND c.status IN ('reserved','dispatched','uncertain') THEN c.reserved_micros ELSE 0 END),0) heldShadowMicros
 FROM inference_calls c JOIN chat_turns t ON t.id=c.turn_id AND t.user_id=c.user_id
 WHERE c.created_at>=? AND c.created_at<=? AND (? IS NULL OR c.user_id=?)
 GROUP BY c.role,c.status,t.status,c.cost_basis ORDER BY c.role,c.status,t.status,c.cost_basis`).bind(start,end,owner??null,owner??null).all<Row>();
 const totals={calls:0,observedInputTokens:0,observedOutputTokens:0,observedShadowMicros:0,heldShadowMicros:0};
 for(const row of results){
  if(!['ack','orchestrator','normal','advanced'].includes(row.role)||!['reserved','dispatched','observed','released','uncertain'].includes(row.providerState)||!['pending','completed','failed','uncertain'].includes(row.chatState)||!['subscription-shadow','unpriced'].includes(row.costBasis))throw Error('Unknown inference receipt classification');
  for(const field of Object.keys(totals) as (keyof typeof totals)[]){if(!Number.isSafeInteger(row[field])||row[field]<0)throw Error('Invalid inference aggregate');totals[field]+=row[field];if(!Number.isSafeInteger(totals[field]))throw Error('Inference aggregate overflow');}
 }
 return {from:start,to:end,totals,groups:results,actualProviderExpenseMicros:null,
  coverage:'Retained inference receipts by creation time; includes acknowledgments and failed/pending/uncertain Chat turns. Deleted account history is unavailable.',
  interpretation:['Calls are receipt counts, not distinct requests: reserved calls may never dispatch and one request can have several calls.','Observed tokens and shadow estimates include calls whose Chat turn did not complete successfully. They do not measure whether the delivered work was useful.','Held shadow estimates are planning reservations, not known consumption or payable charges. Dispatched or uncertain calls must not be retried automatically.','Unpriced receipts have no known price; zero monetary totals do not establish zero provider expense.','These diagnostics do not establish customer misuse and do not change Monitor mode or request admission.']};
}

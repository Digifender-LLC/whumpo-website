/** WH-025 content-free funnel contract.
 * Events are derived from existing receipts by a bounded, idempotent sweep that never
 * touches the receipt-writing statements (D1 counts trigger writes in meta.changes).
 * Two handler-side recorders cover facts whose receipts lose their template family:
 * server-rejected answers and form cancellation. Both are consent-gated in SQL. */
export const funnelRetentionDays=180;
const sweepLimit=500;
const templateCase=(alias:string)=>`CASE json_extract(${alias}.envelope_json,'$.definition.template') WHEN 'content-change@1' THEN 'content_change' WHEN 'project-brief@1' THEN 'project_brief' WHEN 'project-select@1' THEN 'project_select' WHEN 'choice@1' THEN 'choice' WHEN 'custom@1' THEN 'custom' WHEN 'status@1' THEN 'status_view' END`;
/** Removed forms no longer hold their envelope; reuse the family recorded when the form started. */
const template=(alias:string)=>`COALESCE(${templateCase(alias)},(SELECT s.dimension FROM funnel_events s WHERE s.user_id=${alias}.user_id AND s.event='interaction_started' AND s.source_key='interaction:'||${alias}.id),'other')`;
const minute=(time:string)=>`strftime('%Y-%m-%dT%H:%MZ',${time})`;
const unixTime=(column:string)=>`strftime('%Y-%m-%dT%H:%M:%fZ',${column},'unixepoch')`;
const absent=(user:string,event:string,key:string)=>`NOT EXISTS(SELECT 1 FROM funnel_events x WHERE x.user_id=${user} AND x.event=${event} AND x.source_key=${key})`;
/** Receipt time must follow the current consent and lie inside retention (?1), so pruned rows are never re-derived. */
const eligible=(time:string)=>`${time}>=a.consented_at AND ${minute(time)}>=?1`;
type Derivation={event:string;select:string};
// Each SELECT yields (user_id,event,dimension,source_key,occurred_at). Static SQL; ?1 is the retention cutoff minute.
export const funnelDerivations:Derivation[]=[
 {event:'welcome_completed',select:`SELECT w.user_id,'welcome_completed','welcome','welcome',${minute('w.completed_at')} FROM welcome_onboarding w JOIN funnel_measured_accounts a ON a.user_id=w.user_id
  WHERE w.completed_at IS NOT NULL AND ${eligible('w.completed_at')} AND ${absent('w.user_id',"'welcome_completed'","'welcome'")}`},
 {event:'draft_created',select:`SELECT c.user_id,'draft_created','website','website:'||c.project_id,${minute('c.created_at')} FROM project_spec_creations c JOIN funnel_measured_accounts a ON a.user_id=c.user_id
  WHERE ${eligible('c.created_at')} AND ${absent('c.user_id',"'draft_created'","'website:'||c.project_id")}`},
 {event:'draft_created',select:`SELECT p.owner_user_id,'draft_created','application','application:'||v.project_id,${minute('min(v.created_at)')} FROM backend_versions v JOIN projects p ON p.id=v.project_id JOIN funnel_measured_accounts a ON a.user_id=p.owner_user_id
  WHERE ${absent('p.owner_user_id',"'draft_created'","'application:'||v.project_id")} GROUP BY v.project_id HAVING ${eligible('min(v.created_at)')}`},
 {event:'edit_accepted',select:`SELECT c.user_id,'edit_accepted','website_content','content:'||c.id,${minute('c.created_at')} FROM project_spec_applies c JOIN funnel_measured_accounts a ON a.user_id=c.user_id
  WHERE ${eligible('c.created_at')} AND ${absent('c.user_id',"'edit_accepted'","'content:'||c.id")}`},
 {event:'edit_accepted',select:`SELECT c.user_id,'edit_accepted','website_services','services:'||c.id,${minute('c.created_at')} FROM service_client_applies c JOIN funnel_measured_accounts a ON a.user_id=c.user_id
  WHERE ${eligible('c.created_at')} AND ${absent('c.user_id',"'edit_accepted'","'services:'||c.id")}`},
 // Publication reviews expire ten minutes after preparation; that is the receipt's own time.
 {event:'review_prepared',select:`SELECT r.user_id,'review_prepared','website_'||r.kind,'publication:'||r.id,${minute("strftime('%Y-%m-%dT%H:%M:%fZ',r.expires_at,'-10 minutes')")} FROM publication_actions r JOIN funnel_measured_accounts a ON a.user_id=r.user_id
  WHERE r.kind IN ('publish','restore') AND ${eligible("strftime('%Y-%m-%dT%H:%M:%fZ',r.expires_at,'-10 minutes')")} AND ${absent('r.user_id',"'review_prepared'","'publication:'||r.id")}`},
 {event:'review_prepared',select:`SELECT r.user_id,'review_prepared',CASE r.kind WHEN 'application' THEN 'application' WHEN 'appPage' THEN 'app_page' WHEN 'appRestore' THEN 'app_restore' WHEN 'backendPublication' THEN 'backend_publication' ELSE 'backend_form' END,'review:'||r.turn_id,${minute('t.created_at')}
  FROM chat_review_receipts r JOIN chat_turns t ON t.id=r.turn_id AND t.user_id=r.user_id JOIN funnel_measured_accounts a ON a.user_id=r.user_id
  WHERE r.kind IN ('application','appPage','appRestore','backendPublication','backendForm') AND ${eligible('t.created_at')} AND ${absent('r.user_id',"'review_prepared'","'review:'||r.turn_id")}`},
 // The atomic apply trigger records 'publication:'||id activity at confirmation.
 {event:'publication_confirmed',select:`SELECT r.user_id,'publication_confirmed','website_'||r.kind,'publication:'||r.id,${minute('e.created_at')} FROM publication_actions r JOIN activity_events e ON e.id='publication:'||r.id AND e.user_id=r.user_id JOIN funnel_measured_accounts a ON a.user_id=r.user_id
  WHERE r.status='applied' AND r.kind IN ('publish','restore') AND ${eligible('e.created_at')} AND ${absent('r.user_id',"'publication_confirmed'","'publication:'||r.id")}`},
 // First owner Chat turn inside bounded windows after welcome; windows close before retention ends.
 {event:'workspace_returned',select:`SELECT a.user_id,'workspace_returned',d.dimension,'return:'||d.dimension,${minute('min(t.created_at)')} FROM funnel_measured_accounts a JOIN welcome_onboarding w ON w.user_id=a.user_id AND w.completed_at IS NOT NULL
  JOIN (SELECT 'day_7' AS dimension,7 AS first_day,30 AS end_day UNION ALL SELECT 'day_30',30,180) d JOIN chat_turns t ON t.user_id=a.user_id
   AND julianday(t.created_at)>=julianday(w.completed_at)+d.first_day AND julianday(t.created_at)<julianday(w.completed_at)+d.end_day
  WHERE ${absent('a.user_id',"'workspace_returned'","'return:'||d.dimension")} GROUP BY a.user_id,d.dimension HAVING ${eligible('min(t.created_at)')}`},
 {event:'interaction_started',select:`SELECT i.user_id,'interaction_started',${template('i')},'interaction:'||i.id,${minute('i.created_at')} FROM chat_interactions i JOIN funnel_measured_accounts a ON a.user_id=i.user_id
  WHERE ${eligible('i.created_at')} AND ${absent('i.user_id',"'interaction_started'","'interaction:'||i.id")}`},
 {event:'interaction_request',select:`SELECT r.user_id,CASE r.operation WHEN 'submit' THEN 'interaction_submitted' ELSE 'interaction_draft_saved' END,${template('i')},'request:'||r.request_id,${minute('r.created_at')}
  FROM chat_interaction_requests r JOIN chat_interactions i ON i.id=r.interaction_id AND i.user_id=r.user_id JOIN funnel_measured_accounts a ON a.user_id=r.user_id
  WHERE r.operation IN ('save-draft','submit') AND ${eligible('r.created_at')} AND ${absent('r.user_id',"CASE r.operation WHEN 'submit' THEN 'interaction_submitted' ELSE 'interaction_draft_saved' END","'request:'||r.request_id")}`},
 // Resumed: any later save/submit/cancel after an earlier saved draft. A proxy; it does not prove a separate visit.
 {event:'interaction_resumed',select:`SELECT r.user_id,'interaction_resumed',${template('i')},'interaction:'||r.interaction_id,${minute('min(r.created_at)')}
  FROM chat_interaction_requests r JOIN chat_interactions i ON i.id=r.interaction_id AND i.user_id=r.user_id JOIN funnel_measured_accounts a ON a.user_id=r.user_id
  WHERE EXISTS(SELECT 1 FROM chat_interaction_requests d WHERE d.user_id=r.user_id AND d.interaction_id=r.interaction_id AND d.operation='save-draft' AND d.answer_revision<r.answer_revision)
   AND ${absent('r.user_id',"'interaction_resumed'","'interaction:'||r.interaction_id")} GROUP BY r.user_id,r.interaction_id HAVING ${eligible('min(r.created_at)')}`},
 {event:'interaction_removed',select:`SELECT i.user_id,CASE i.removal_reason WHEN 'discarded' THEN 'interaction_canceled' ELSE 'interaction_expired' END,${template('i')},'interaction:'||i.id,${minute('i.removed_at')}
  FROM chat_interactions i JOIN funnel_measured_accounts a ON a.user_id=i.user_id
  WHERE i.removed_at IS NOT NULL AND ${eligible('i.removed_at')} AND ${absent('i.user_id',"CASE i.removal_reason WHEN 'discarded' THEN 'interaction_canceled' ELSE 'interaction_expired' END","'interaction:'||i.id")}`},
 // Technical continuation outcome only; usefulness is judged separately by people.
 {event:'interaction_continued',select:`SELECT s.user_id,'interaction_continued',CASE c.state WHEN 'succeeded' THEN 'succeeded' ELSE 'failed_'||c.reason END,'continuation:'||c.id,${minute('c.finished_at')}
  FROM chat_interaction_continuations c JOIN chat_interaction_submissions s ON s.id=c.id JOIN funnel_measured_accounts a ON a.user_id=s.user_id
  WHERE c.state IN ('succeeded','failed') AND ${eligible('c.finished_at')} AND ${absent('s.user_id',"'interaction_continued'","'continuation:'||c.id")}`},
 // Identity keys are ceremony/effect request IDs, never credential IDs, tokens, verifiers, emails or recovery keys.
 {event:'passkey_registered',select:`SELECT r.account_id,'passkey_registered',CASE WHEN r.kind='signup' THEN 'signup_first' WHEN r.attempt_id IS NULL THEN 'workspace_added'
   WHEN (SELECT kind FROM identity_attempts WHERE id=r.attempt_id)='recovery' THEN 'recovery_replacement' ELSE 'enrollment_additional' END,'ceremony:'||r.id,${minute(unixTime('r.created_at'))}
  FROM identity_ceremony_receipts r JOIN funnel_measured_accounts a ON a.user_id=r.account_id
  WHERE r.kind IN ('signup','add') AND ${eligible(unixTime('r.created_at'))} AND ${absent('r.account_id',"'passkey_registered'","'ceremony:'||r.id")}`},
 // kit_save is the customer's save acknowledgment, not proof of a stored or printed kit.
 {event:'identity_effect',select:`SELECT r.account_id,CASE r.kind WHEN 'kit_save' THEN 'recovery_kit_saved' WHEN 'enrollment_complete' THEN 'enrollment_completed' WHEN 'enrollment_cancel' THEN 'enrollment_cancelled'
   WHEN 'recovery_start' THEN 'recovery_started' WHEN 'recovery_secure' THEN 'recovery_secured' ELSE 'recovery_completed' END,
  CASE WHEN r.kind LIKE 'enrollment_%' THEN 'enrollment' WHEN r.kind LIKE 'recovery_%' THEN 'recovery' WHEN r.attempt_id IS NULL THEN 'workspace'
   WHEN (SELECT kind FROM identity_attempts WHERE id=r.attempt_id)='recovery' THEN 'recovery' ELSE 'enrollment' END,'effect:'||r.id,${minute(unixTime('r.created_at'))}
  FROM identity_effect_receipts r JOIN funnel_measured_accounts a ON a.user_id=r.account_id
  WHERE r.kind IN ('kit_save','enrollment_complete','enrollment_cancel','recovery_start','recovery_secure','recovery_complete') AND ${eligible(unixTime('r.created_at'))}
   AND NOT EXISTS(SELECT 1 FROM funnel_events x WHERE x.user_id=r.account_id AND x.source_key='effect:'||r.id)`},
];
export function funnelCutoff(now=Date.now()){return new Date(now-funnelRetentionDays*86400000).toISOString().slice(0,16)+'Z';}
/** Idempotent: INSERT OR IGNORE plus NOT EXISTS on (account,event,receipt key). Bounded per statement;
 * a later run continues. One D1 batch keeps the sweep atomic and consent-consistent. */
export async function deriveFunnelEvents(db:D1Database,now=Date.now()){
 const cutoff=funnelCutoff(now);
 const results=await db.batch(funnelDerivations.map(d=>db.prepare(`INSERT OR IGNORE INTO funnel_events(user_id,event,dimension,source_key,occurred_at) SELECT * FROM (${d.select}) LIMIT ${sweepLimit}`).bind(cutoff)));
 return results.reduce((sum,r)=>sum+(r.meta?.changes??0),0);
}
/** Bounded retention. Account deletion and consent withdrawal remove rows immediately. */
export async function cleanupFunnelEvents(db:D1Database,now=Date.now()){
 return db.prepare('DELETE FROM funnel_events WHERE occurred_at<?').bind(funnelCutoff(now)).run();
}
export async function maintainFunnelEvents(db:D1Database,now=Date.now()){await cleanupFunnelEvents(db,now);await deriveFunnelEvents(db,now);}

export const interactionTemplates={
 'content-change@1':'content_change','project-brief@1':'project_brief','project-select@1':'project_select',
 'choice@1':'choice','custom@1':'custom','status@1':'status_view'
} as const;
export function interactionTemplateDimension(templateId:unknown){
 return typeof templateId==='string'&&Object.hasOwn(interactionTemplates,templateId)?interactionTemplates[templateId as keyof typeof interactionTemplates]:'other';
}
const requestKey=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
/** Best effort and consent-gated. Only the template family and the client request ID
 * (replay deduplication) are kept; never a field ID or answer. */
export async function recordInteractionValidationFailure(db:D1Database,user:string,templateId:unknown,requestId:unknown){
 if(typeof requestId!=='string'||!requestKey.test(requestId))return;
 try{
  await db.prepare(`INSERT OR IGNORE INTO funnel_events(user_id,event,dimension,source_key,occurred_at)
   SELECT user_id,'interaction_validation_failed',?,?,strftime('%Y-%m-%dT%H:%MZ','now') FROM funnel_measured_accounts WHERE user_id=?`)
   .bind(interactionTemplateDimension(templateId),'validation:'+requestId,user).run();
 }catch{/* Measurement must never change the customer-facing validation result. */}
}
/** After a committed cancel, keep the template family the cleared envelope can no longer supply.
 * The sweep derives the same keys if this best-effort write is lost. */
export async function recordInteractionCancel(db:D1Database,user:string,interactionId:string,templateId:unknown){
 const dimension=interactionTemplateDimension(templateId);
 try{
  await db.batch([
   db.prepare(`INSERT OR IGNORE INTO funnel_events(user_id,event,dimension,source_key,occurred_at) SELECT a.user_id,'interaction_started',?,'interaction:'||i.id,${minute('i.created_at')}
    FROM chat_interactions i JOIN funnel_measured_accounts a ON a.user_id=i.user_id WHERE i.id=? AND i.user_id=? AND i.created_at>=a.consented_at`).bind(dimension,interactionId,user),
   db.prepare(`INSERT OR IGNORE INTO funnel_events(user_id,event,dimension,source_key,occurred_at) SELECT a.user_id,'interaction_canceled',?,'interaction:'||i.id,${minute('i.removed_at')}
    FROM chat_interactions i JOIN funnel_measured_accounts a ON a.user_id=i.user_id WHERE i.id=? AND i.user_id=? AND i.removal_reason='discarded' AND i.removed_at>=a.consented_at`).bind(dimension,interactionId,user)]);
 }catch{/* The scheduled derivation remains the durable path. */}
}

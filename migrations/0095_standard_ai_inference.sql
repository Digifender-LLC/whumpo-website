-- Preserve historical metered inference while admitting separate non-billable receipts.
-- A request can never change customer accounting paths after admission.
CREATE TRIGGER standard_ai_no_metered BEFORE INSERT ON standard_ai_requests
WHEN EXISTS(SELECT 1 FROM usage_operations WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'ai_accounting_path_conflict'); END;
CREATE TRIGGER metered_ai_no_standard BEFORE INSERT ON usage_operations
WHEN EXISTS(SELECT 1 FROM standard_ai_requests WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'ai_accounting_path_conflict'); END;
DROP TRIGGER inference_admit;
CREATE TRIGGER inference_admit BEFORE INSERT ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
 AND (EXISTS(SELECT 1 FROM usage_operations o WHERE o.id=t.id AND o.user_id=NEW.user_id AND o.period=NEW.period AND o.status IN ('reserved','dispatched'))
 OR EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND substr(s.created_at,1,7)=NEW.period AND s.state IN ('reserved','dispatched'))));
 SELECT RAISE(ABORT,'inference_initial') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'inference_budget') WHERE NOT EXISTS(SELECT 1 FROM inference_budgets WHERE user_id=NEW.user_id AND period=NEW.period AND budget_micros-spent_micros-reserved_micros>=NEW.reserved_micros);
 -- Subagent dispatch is not exposed yet. All actual calls use the orchestrator route.
 SELECT RAISE(ABORT,'inference_role_unavailable') WHERE NEW.role NOT IN ('orchestrator','ack');
END;
DROP TRIGGER agent_inspection_admit;
CREATE TRIGGER agent_inspection_admit BEFORE INSERT ON agent_inspections BEGIN
 SELECT RAISE(ABORT,'agent_inspection_closed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN inference_calls i ON i.id=t.id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
   AND i.user_id=NEW.user_id AND i.status='dispatched'
   AND (EXISTS(SELECT 1 FROM usage_operations o WHERE o.id=t.id AND o.user_id=NEW.user_id AND o.status='dispatched')
    OR EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND s.state='dispatched')));
END;

-- Pre-release reset: discard retired test billing state. No compatibility readers or conversion.
DROP VIEW plan_entitlements;
CREATE VIEW plan_entitlements AS SELECT user_id,plan_id,starts_at,ends_at FROM stripe_paid_invoices;

-- Old metered requests cannot resume in the current standard-AI path.
UPDATE chat_turns SET status='failed',assistant_text='This test request was retired. Start a new message.'
 WHERE status='pending' AND id IN (SELECT id FROM usage_operations);
DROP TRIGGER standard_ai_no_metered;
DROP TRIGGER inference_admit;
DROP TRIGGER agent_inspection_admit;
DROP TRIGGER chat_result_open;
CREATE TRIGGER inference_admit BEFORE INSERT ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
 AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND substr(s.created_at,1,7)=NEW.period AND s.state IN ('reserved','dispatched')));
 SELECT RAISE(ABORT,'inference_initial') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'inference_budget') WHERE NOT EXISTS(SELECT 1 FROM inference_budgets WHERE user_id=NEW.user_id AND period=NEW.period AND budget_micros-spent_micros-reserved_micros>=NEW.reserved_micros);
 -- Subagent dispatch is not exposed yet. All actual calls use the orchestrator route.
 SELECT RAISE(ABORT,'inference_role_unavailable') WHERE NEW.role NOT IN ('orchestrator','ack');
END;
CREATE TRIGGER agent_inspection_admit BEFORE INSERT ON agent_inspections BEGIN
 SELECT RAISE(ABORT,'agent_inspection_closed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN inference_calls i ON i.id=t.id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
   AND i.user_id=NEW.user_id AND i.status='dispatched'
   AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND s.state='dispatched'));
END;
CREATE TRIGGER chat_result_open BEFORE UPDATE OF input_tokens,output_tokens ON chat_turns
WHEN OLD.mode='ai' AND (OLD.status!='pending' OR NOT EXISTS(
 SELECT 1 FROM standard_ai_requests s WHERE s.id=OLD.id AND s.user_id=OLD.user_id AND s.state IN ('dispatched','uncertain')))
BEGIN SELECT RAISE(ABORT,'chat_result_closed'); END;

DROP TABLE checkout_orders;
DROP TABLE usage_waivers;
DROP TABLE usage_operations;
DROP TABLE plan_grants;
DROP TABLE usage_periods;
DROP TABLE credit_grants;
DROP TABLE billing_ledger;
DROP TABLE billing_accounts;

-- Remove retired plan fixtures, then close the catalogue to current identities.
DROP TRIGGER stripe_invoice_delete_guard;
DELETE FROM stripe_paid_invoices WHERE plan_id IN ('launch','studio');
DELETE FROM stripe_subscription_orders WHERE plan_id IN ('launch','studio');
CREATE TRIGGER stripe_invoice_delete_guard BEFORE DELETE ON stripe_paid_invoices
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'stripe_invoice_immutable'); END;
DROP TRIGGER plan_catalog_delete_guard;
DELETE FROM plan_catalog WHERE id IN ('launch','studio');
ALTER TABLE plan_catalog DROP COLUMN monthly_units;
CREATE TRIGGER plan_catalog_delete_guard BEFORE DELETE ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;
CREATE TRIGGER plan_catalog_insert_guard BEFORE INSERT ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;
CREATE TRIGGER stripe_current_order BEFORE INSERT ON stripe_subscription_orders
WHEN NEW.plan_id NOT IN ('starter','personal','business','business-pro')
BEGIN SELECT RAISE(ABORT,'current_plan_required'); END;
CREATE TRIGGER stripe_current_invoice BEFORE INSERT ON stripe_paid_invoices
WHEN NEW.plan_id NOT IN ('starter','personal','business','business-pro')
BEGIN SELECT RAISE(ABORT,'current_plan_required'); END;

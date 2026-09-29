-- Operator economics, entirely separate from customer build units/credits.
-- All live routes currently use subscription-shadow planning costs, never invoice spend.
CREATE TABLE inference_budgets (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 budget_micros INTEGER NOT NULL CHECK(budget_micros BETWEEN 1 AND 20000000),
 spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(spent_micros>=0),
 reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),
 PRIMARY KEY(user_id,period),
 CHECK(spent_micros+reserved_micros<=budget_micros)
);
CREATE TABLE inference_calls (
 id TEXT PRIMARY KEY,
 turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ack','orchestrator','normal','advanced')),
 model TEXT NOT NULL,
 provider_origin TEXT NOT NULL,
 protocol TEXT NOT NULL CHECK(protocol IN ('chat','responses')),
 policy TEXT NOT NULL,
 cost_basis TEXT NOT NULL CHECK(cost_basis IN ('subscription-shadow','unpriced')),
 ack_text TEXT CHECK(ack_text IS NULL OR (role='ack' AND status='observed' AND length(ack_text)<=180)),
 rate_id TEXT NOT NULL,
 input_rate INTEGER NOT NULL CHECK(input_rate>=0),
 output_rate INTEGER NOT NULL CHECK(output_rate>=0),
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','dispatched','observed','released','uncertain')),
 input_tokens INTEGER,
 output_tokens INTEGER,
 estimated_micros INTEGER,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(turn_id,role),
 FOREIGN KEY(user_id,period) REFERENCES inference_budgets(user_id,period),
 CHECK((status='observed' AND input_tokens>=0 AND output_tokens>=0 AND estimated_micros>=0 AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND estimated_micros IS NOT NULL)
 OR (status!='observed' AND input_tokens IS NULL AND output_tokens IS NULL AND estimated_micros IS NULL))
);
CREATE INDEX inference_calls_owner_time ON inference_calls(user_id,created_at,role);
CREATE TRIGGER inference_admit BEFORE INSERT ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN usage_operations o ON o.id=t.id WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND o.user_id=NEW.user_id AND o.period=NEW.period AND t.status='pending' AND o.status IN ('reserved','dispatched'));
 SELECT RAISE(ABORT,'inference_initial') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'inference_budget') WHERE NOT EXISTS(SELECT 1 FROM inference_budgets WHERE user_id=NEW.user_id AND period=NEW.period AND budget_micros-spent_micros-reserved_micros>=NEW.reserved_micros);
 -- Subagent dispatch is not exposed yet. All actual calls use the orchestrator route.
 SELECT RAISE(ABORT,'inference_role_unavailable') WHERE NEW.role NOT IN ('orchestrator','ack');
END;
CREATE TRIGGER inference_reserved AFTER INSERT ON inference_calls BEGIN
 UPDATE inference_budgets SET reserved_micros=reserved_micros+NEW.reserved_micros WHERE user_id=NEW.user_id AND period=NEW.period;
END;
CREATE TRIGGER inference_immutable BEFORE UPDATE ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_immutable') WHERE NEW.id!=OLD.id OR NEW.turn_id!=OLD.turn_id OR NEW.user_id!=OLD.user_id OR NEW.period!=OLD.period OR NEW.role!=OLD.role OR NEW.model!=OLD.model OR NEW.provider_origin!=OLD.provider_origin OR NEW.protocol!=OLD.protocol OR NEW.policy!=OLD.policy OR NEW.cost_basis!=OLD.cost_basis OR NEW.rate_id!=OLD.rate_id OR NEW.input_rate!=OLD.input_rate OR NEW.output_rate!=OLD.output_rate OR NEW.reserved_micros!=OLD.reserved_micros OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'inference_transition') WHERE NOT (
  (OLD.status='reserved' AND NEW.status IN ('dispatched','released')) OR
  (OLD.status IN ('dispatched','uncertain') AND NEW.status='observed') OR
  (OLD.status='dispatched' AND NEW.status='uncertain'));
 SELECT RAISE(ABORT,'inference_cost_mismatch') WHERE NEW.status='observed' AND (NEW.estimated_micros>OLD.reserved_micros OR NEW.estimated_micros!=CAST((NEW.input_tokens*OLD.input_rate+NEW.output_tokens*OLD.output_rate+999999)/1000000 AS INTEGER));
END;
CREATE TRIGGER inference_finished AFTER UPDATE ON inference_calls WHEN NEW.status IN ('observed','released') BEGIN
 UPDATE inference_budgets SET reserved_micros=reserved_micros-OLD.reserved_micros,spent_micros=spent_micros+COALESCE(NEW.estimated_micros,0) WHERE user_id=NEW.user_id AND period=NEW.period;
END;
CREATE TRIGGER inference_delete_guard BEFORE DELETE ON inference_calls WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'inference_immutable'); END;

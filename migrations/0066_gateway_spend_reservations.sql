-- Inactive gateway funding groundwork. No buckets, credits or paid routes are created.
CREATE TABLE gateway_spend_buckets (
 id TEXT PRIMARY KEY,
 scope TEXT NOT NULL CHECK(scope IN ('platform','account','task','premium','approval')),
 user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 task_id TEXT,
 limit_micros INTEGER NOT NULL CHECK(typeof(limit_micros)='integer' AND limit_micros BETWEEN 0 AND 1000000000000),
 held_micros INTEGER NOT NULL DEFAULT 0 CHECK(typeof(held_micros)='integer' AND held_micros>=0),
 spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spent_micros)='integer' AND spent_micros>=0),
 terms_json TEXT NOT NULL DEFAULT '{}',
 CHECK(json_valid(terms_json)),
 CHECK(held_micros+spent_micros<=limit_micros),
 CHECK((scope='platform' AND user_id IS NULL AND task_id IS NULL) OR (scope IN ('account','premium') AND user_id IS NOT NULL AND task_id IS NULL) OR (scope IN ('task','approval') AND user_id IS NOT NULL AND task_id IS NOT NULL))
);
CREATE TRIGGER gateway_bucket_identity BEFORE UPDATE ON gateway_spend_buckets BEGIN
 SELECT RAISE(ABORT,'gateway_bucket_identity') WHERE NEW.id!=OLD.id OR NEW.scope!=OLD.scope OR NEW.user_id IS NOT OLD.user_id OR NEW.task_id IS NOT OLD.task_id OR NEW.terms_json!=OLD.terms_json;
 -- Approval caps cannot be raised by changing a balance. A new approval is required.
 SELECT RAISE(ABORT,'gateway_approval_immutable') WHERE OLD.scope='approval' AND NEW.limit_micros!=OLD.limit_micros;
END;
CREATE TABLE gateway_spend_attempts (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 task_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 account_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 platform_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 premium_bucket TEXT REFERENCES gateway_spend_buckets(id),
 approval_bucket TEXT REFERENCES gateway_spend_buckets(id),
 provider_reserved INTEGER NOT NULL CHECK(typeof(provider_reserved)='integer' AND provider_reserved BETWEEN 0 AND 1000000000000),
 customer_reserved INTEGER NOT NULL CHECK(typeof(customer_reserved)='integer' AND customer_reserved BETWEEN 0 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','dispatched','uncertain','settled','released')),
 input_tokens INTEGER, output_tokens INTEGER, provider_actual INTEGER, customer_actual INTEGER,
 CHECK((status='settled' AND typeof(input_tokens)='integer' AND typeof(output_tokens)='integer' AND typeof(provider_actual)='integer' AND typeof(customer_actual)='integer' AND input_tokens>=0 AND output_tokens>=0 AND provider_actual BETWEEN 0 AND provider_reserved AND customer_actual BETWEEN 0 AND customer_reserved)
 OR (status!='settled' AND input_tokens IS NULL AND output_tokens IS NULL AND provider_actual IS NULL AND customer_actual IS NULL))
);
CREATE INDEX gateway_attempts_owner_task ON gateway_spend_attempts(user_id,task_id);
CREATE TRIGGER gateway_attempt_admit BEFORE INSERT ON gateway_spend_attempts BEGIN
 SELECT RAISE(ABORT,'gateway_initial_state') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'gateway_snapshot') WHERE json_extract(NEW.snapshot,'$.ownerId') IS NOT NEW.user_id OR json_extract(NEW.snapshot,'$.taskId') IS NOT NEW.task_id OR json_extract(NEW.snapshot,'$.providerReservationMicros') IS NOT NEW.provider_reserved OR json_extract(NEW.snapshot,'$.customerReservationMicros') IS NOT NEW.customer_reserved OR json_extract(NEW.snapshot,'$.role') NOT IN ('ack','orchestrator') OR json_extract(NEW.snapshot,'$.role') IS NULL;
 SELECT RAISE(ABORT,'gateway_rate_bounds') WHERE
 typeof(json_extract(NEW.snapshot,'$.inputBound'))!='integer' OR json_extract(NEW.snapshot,'$.inputBound') NOT BETWEEN 1 AND 10000000 OR
 typeof(json_extract(NEW.snapshot,'$.outputBound'))!='integer' OR json_extract(NEW.snapshot,'$.outputBound') NOT BETWEEN 1 AND 10000000 OR
 typeof(json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion'))!='integer' OR json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion'))!='integer' OR json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.extraMicrosPerCall'))!='integer' OR json_extract(NEW.snapshot,'$.extraMicrosPerCall') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.rateValidUntil'))!='integer';
 SELECT RAISE(ABORT,'gateway_quote') WHERE NEW.provider_reserved!=CAST((json_extract(NEW.snapshot,'$.inputBound')*json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion')+json_extract(NEW.snapshot,'$.outputBound')*json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion')+999999)/1000000 AS INTEGER)+json_extract(NEW.snapshot,'$.extraMicrosPerCall');
 SELECT RAISE(ABORT,'gateway_retail_quote') WHERE json_extract(NEW.snapshot,'$.tier')='premium' AND (
 typeof(json_extract(NEW.snapshot,'$.retailMultiplierBps'))!='integer' OR json_extract(NEW.snapshot,'$.retailMultiplierBps') NOT BETWEEN 10000 AND 100000 OR
 NEW.customer_reserved!=CAST((NEW.provider_reserved*json_extract(NEW.snapshot,'$.retailMultiplierBps')+9999)/10000 AS INTEGER));
 SELECT RAISE(ABORT,'gateway_rate_expired') WHERE json_extract(NEW.snapshot,'$.rateValidUntil') IS NULL OR json_extract(NEW.snapshot,'$.rateValidUntil')<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER));
 SELECT RAISE(ABORT,'gateway_task_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.task_bucket AND scope='task' AND user_id=NEW.user_id AND task_id=NEW.task_id AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_account_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.account_bucket AND scope='account' AND user_id=NEW.user_id AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_platform_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.platform_bucket AND scope='platform' AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_tier') WHERE NOT (
  (json_extract(NEW.snapshot,'$.tier')='standard' AND NEW.customer_reserved=0 AND NEW.premium_bucket IS NULL AND NEW.approval_bucket IS NULL) OR
  (json_extract(NEW.snapshot,'$.tier')='premium' AND NEW.premium_bucket IS NOT NULL AND NEW.approval_bucket IS NOT NULL)
 ) OR json_extract(NEW.snapshot,'$.tier') IS NULL;
 SELECT RAISE(ABORT,'gateway_premium_balance') WHERE NEW.premium_bucket IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.premium_bucket AND scope='premium' AND user_id=NEW.user_id AND limit_micros-held_micros-spent_micros>=NEW.customer_reserved);
 SELECT RAISE(ABORT,'gateway_premium_approval') WHERE NEW.approval_bucket IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM gateway_spend_buckets b WHERE b.id=NEW.approval_bucket AND b.scope='approval' AND b.user_id=NEW.user_id AND b.task_id=NEW.task_id
  AND b.id=json_extract(NEW.snapshot,'$.approvalId') AND json_extract(b.terms_json,'$.catalogVersion')=json_extract(NEW.snapshot,'$.catalogVersion')
  AND json_extract(b.terms_json,'$.policy')='gateway-cost-routing-v1' AND json_extract(b.terms_json,'$.tariffId')=json_extract(NEW.snapshot,'$.tariffId')
  AND json_extract(b.terms_json,'$.retailMultiplierBps')=json_extract(NEW.snapshot,'$.retailMultiplierBps')
  AND json_extract(b.terms_json,'$.expiresAt')>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND EXISTS(SELECT 1 FROM json_each(b.terms_json,'$.candidateIds') WHERE value=json_extract(NEW.snapshot,'$.candidateId'))
  AND b.limit_micros-b.held_micros-b.spent_micros>=NEW.customer_reserved
 );
END;
CREATE TRIGGER gateway_attempt_hold AFTER INSERT ON gateway_spend_attempts BEGIN
 UPDATE gateway_spend_buckets SET held_micros=held_micros+NEW.provider_reserved WHERE id IN (NEW.task_bucket,NEW.account_bucket,NEW.platform_bucket);
 UPDATE gateway_spend_buckets SET held_micros=held_micros+NEW.customer_reserved WHERE id IN (NEW.premium_bucket,NEW.approval_bucket);
END;
CREATE TRIGGER gateway_attempt_immutable BEFORE UPDATE ON gateway_spend_attempts BEGIN
 SELECT RAISE(ABORT,'gateway_attempt_immutable') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.task_id!=OLD.task_id OR NEW.snapshot!=OLD.snapshot OR NEW.task_bucket!=OLD.task_bucket OR NEW.account_bucket!=OLD.account_bucket OR NEW.platform_bucket!=OLD.platform_bucket OR NEW.premium_bucket IS NOT OLD.premium_bucket OR NEW.approval_bucket IS NOT OLD.approval_bucket OR NEW.provider_reserved!=OLD.provider_reserved OR NEW.customer_reserved!=OLD.customer_reserved;
 SELECT RAISE(ABORT,'gateway_dispatch_expired') WHERE NEW.status='dispatched' AND (json_extract(OLD.snapshot,'$.rateValidUntil')<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) OR (OLD.approval_bucket IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=OLD.approval_bucket AND json_extract(terms_json,'$.expiresAt')>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))));
 SELECT RAISE(ABORT,'gateway_settlement_cost') WHERE NEW.status='settled' AND (
 NEW.input_tokens>json_extract(OLD.snapshot,'$.inputBound') OR NEW.output_tokens>json_extract(OLD.snapshot,'$.outputBound') OR
 NEW.provider_actual!=CAST((NEW.input_tokens*json_extract(OLD.snapshot,'$.rate.inputMicrosPerMillion')+NEW.output_tokens*json_extract(OLD.snapshot,'$.rate.outputMicrosPerMillion')+999999)/1000000 AS INTEGER)+json_extract(OLD.snapshot,'$.extraMicrosPerCall') OR
 NEW.customer_actual!=CASE WHEN json_extract(OLD.snapshot,'$.tier')='standard' THEN 0 ELSE CAST((NEW.provider_actual*json_extract(OLD.snapshot,'$.retailMultiplierBps')+9999)/10000 AS INTEGER) END);
 SELECT RAISE(ABORT,'gateway_transition') WHERE NOT ((OLD.status='reserved' AND NEW.status IN ('dispatched','released')) OR (OLD.status='dispatched' AND NEW.status IN ('uncertain','settled')) OR (OLD.status='uncertain' AND NEW.status='settled'));
END;
CREATE TRIGGER gateway_attempt_finish AFTER UPDATE ON gateway_spend_attempts WHEN NEW.status IN ('settled','released') BEGIN
 UPDATE gateway_spend_buckets SET held_micros=held_micros-OLD.provider_reserved,spent_micros=spent_micros+COALESCE(NEW.provider_actual,0) WHERE id IN (NEW.task_bucket,NEW.account_bucket,NEW.platform_bucket);
 UPDATE gateway_spend_buckets SET held_micros=held_micros-OLD.customer_reserved,spent_micros=spent_micros+COALESCE(NEW.customer_actual,0) WHERE id IN (NEW.premium_bucket,NEW.approval_bucket);
END;
CREATE TRIGGER gateway_attempt_no_delete BEFORE DELETE ON gateway_spend_attempts BEGIN SELECT RAISE(ABORT,'gateway_attempt_immutable'); END;

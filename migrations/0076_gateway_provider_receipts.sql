-- Header-only evidence for later invoice reconciliation; no prompt or response bodies.
CREATE TABLE gateway_provider_receipts (
 attempt_id TEXT PRIMARY KEY REFERENCES gateway_inference_requests(attempt_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL CHECK(length(account_id)=32 AND account_id NOT GLOB '*[^0-9a-f]*'),
 gateway_id TEXT NOT NULL CHECK(length(gateway_id) BETWEEN 1 AND 64 AND gateway_id NOT GLOB '*[^a-z0-9-]*'),
 http_status INTEGER NOT NULL CHECK(typeof(http_status)='integer' AND http_status BETWEEN 100 AND 599),
 event_id TEXT CHECK(event_id IS NULL OR (length(event_id) BETWEEN 1 AND 128 AND event_id NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 log_id TEXT CHECK(log_id IS NULL OR (length(log_id) BETWEEN 1 AND 128 AND log_id NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER gateway_provider_receipt_admit BEFORE INSERT ON gateway_provider_receipts BEGIN
 SELECT RAISE(ABORT,'gateway_provider_receipt_state') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=NEW.attempt_id AND status='dispatched');
END;
CREATE TRIGGER gateway_provider_receipt_no_update BEFORE UPDATE ON gateway_provider_receipts BEGIN SELECT RAISE(ABORT,'gateway_provider_receipt_immutable'); END;
CREATE TRIGGER gateway_provider_receipt_no_delete BEFORE DELETE ON gateway_provider_receipts BEGIN SELECT RAISE(ABORT,'gateway_provider_receipt_immutable'); END;

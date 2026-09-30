-- Inactive inference dispatch receipts. No routes, funding or credentials are created.
CREATE TABLE gateway_inference_requests (
 attempt_id TEXT PRIMARY KEY REFERENCES gateway_spend_attempts(id) ON DELETE RESTRICT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND
  json_type(result_json,'$.text') IS 'text' AND length(json_extract(result_json,'$.text')) BETWEEN 1 AND 32000 AND
  json_type(result_json,'$.inputTokens') IS 'integer' AND json_extract(result_json,'$.inputTokens')>=0 AND
  json_type(result_json,'$.outputTokens') IS 'integer' AND json_extract(result_json,'$.outputTokens')>=0))
);
CREATE TRIGGER gateway_request_admit BEFORE INSERT ON gateway_inference_requests BEGIN
 SELECT RAISE(ABORT,'gateway_request_state') WHERE NEW.result_json IS NOT NULL OR NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=NEW.attempt_id AND status='reserved');
END;
CREATE TRIGGER gateway_request_immutable BEFORE UPDATE ON gateway_inference_requests BEGIN
 SELECT RAISE(ABORT,'gateway_request_immutable') WHERE NEW.attempt_id!=OLD.attempt_id OR NEW.request_hash!=OLD.request_hash OR OLD.result_json IS NOT NULL OR NEW.result_json IS NULL;
 SELECT RAISE(ABORT,'gateway_request_state') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=OLD.attempt_id AND status='dispatched');
END;
CREATE TRIGGER gateway_request_no_delete BEFORE DELETE ON gateway_inference_requests BEGIN SELECT RAISE(ABORT,'gateway_request_immutable'); END;

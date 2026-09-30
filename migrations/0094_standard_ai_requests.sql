-- Non-billable standard assistance receipts; separate from historical test units.
CREATE TABLE standard_ai_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','uncertain','completed','released')),
 input_tokens INTEGER,
 output_tokens INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((state='completed' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND input_tokens>=0 AND output_tokens>=0)
 OR (state!='completed' AND input_tokens IS NULL AND output_tokens IS NULL))
);
CREATE INDEX standard_ai_owner_time ON standard_ai_requests(user_id,created_at,id);
CREATE TRIGGER standard_ai_insert BEFORE INSERT ON standard_ai_requests
WHEN NEW.state!='reserved' OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL
BEGIN SELECT RAISE(ABORT,'standard_ai_initial'); END;
CREATE TRIGGER standard_ai_update BEFORE UPDATE ON standard_ai_requests
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.request_hash!=OLD.request_hash OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.state='reserved' AND NEW.state IN ('dispatched','released'))
 OR (OLD.state='dispatched' AND NEW.state IN ('completed','uncertain'))
 OR (OLD.state='uncertain' AND NEW.state='completed'))
BEGIN SELECT RAISE(ABORT,'standard_ai_transition'); END;

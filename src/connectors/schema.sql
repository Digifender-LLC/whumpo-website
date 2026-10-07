-- Current connector consent and minimized receipts. Content and query/body values are never stored here.
CREATE TABLE connector_lookup_consents (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot')),
 operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 3 AND 100),
 credential_id TEXT NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 128),
 operation_digest TEXT NOT NULL CHECK(length(operation_digest)=64 AND operation_digest NOT GLOB '*[^0-9a-f]*'),
 params_digest TEXT NOT NULL CHECK(length(params_digest)=64 AND params_digest NOT GLOB '*[^0-9a-f]*'),
 destination TEXT NOT NULL CHECK(destination IN ('owner-panel','model-context')),
 state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','confirmed','consumed','void')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 confirmed_at TEXT,
 consumed_at TEXT,
 CHECK(expires_at>created_at AND unixepoch(expires_at)<=unixepoch(created_at)+900),
 CHECK((state='review' AND confirmed_at IS NULL AND consumed_at IS NULL) OR (state='confirmed' AND confirmed_at IS NOT NULL AND consumed_at IS NULL) OR (state='consumed' AND confirmed_at IS NOT NULL AND consumed_at IS NOT NULL) OR state='void')
);
CREATE INDEX connector_lookup_owner ON connector_lookup_consents(user_id,created_at,id);
CREATE TRIGGER connector_lookup_initial BEFORE INSERT ON connector_lookup_consents
BEGIN
 SELECT RAISE(ABORT,'connector_lookup_initial') WHERE NEW.state!='review';
 SELECT RAISE(ABORT,'connector_lookup_capacity') WHERE (SELECT count(*) FROM connector_lookup_consents WHERE user_id=NEW.user_id)>=100;
END;
CREATE TRIGGER connector_lookup_identity BEFORE UPDATE ON connector_lookup_consents
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.provider!=OLD.provider OR NEW.operation_id!=OLD.operation_id OR NEW.credential_id!=OLD.credential_id OR NEW.operation_digest!=OLD.operation_digest OR NEW.params_digest!=OLD.params_digest OR NEW.destination!=OLD.destination OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
 OR NOT ((OLD.state='review' AND NEW.state IN ('confirmed','void')) OR (OLD.state='confirmed' AND NEW.state IN ('consumed','void')))
BEGIN SELECT RAISE(ABORT,'connector_lookup_immutable'); END;
-- Disconnect/reconnect invalidates unconsumed consent in the same committing statement.
CREATE TRIGGER connector_lookup_github_pointer AFTER UPDATE OF active_token_id ON github_connections
WHEN NEW.active_token_id IS NOT OLD.active_token_id
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='github' AND credential_id=OLD.active_token_id AND state IN ('review','confirmed'); END;
CREATE TRIGGER connector_lookup_github_connection_delete BEFORE DELETE ON github_connections
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='github' AND state IN ('review','confirmed'); END;
CREATE TRIGGER connector_lookup_github_token AFTER UPDATE OF state ON github_token_vault
WHEN NEW.state!='active'
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='github' AND credential_id=OLD.id AND state IN ('review','confirmed'); END;
CREATE TRIGGER connector_lookup_github_delete BEFORE DELETE ON github_token_vault
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='github' AND credential_id=OLD.id AND state IN ('review','confirmed'); END;
CREATE TRIGGER connector_lookup_cloudflare_token AFTER UPDATE OF state ON cloudflare_token_vault
WHEN NEW.state!='active'
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='cloudflare' AND credential_id=OLD.id AND state IN ('review','confirmed'); END;
CREATE TRIGGER connector_lookup_cloudflare_delete BEFORE DELETE ON cloudflare_token_vault
BEGIN UPDATE connector_lookup_consents SET state='void' WHERE user_id=OLD.user_id AND provider='cloudflare' AND credential_id=OLD.id AND state IN ('review','confirmed'); END;

-- Content-free counters, never credential or action authority. At most four rows per account.
CREATE TABLE connector_request_budgets (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('github','cloudflare')),
 kind TEXT NOT NULL CHECK(kind IN ('read','action')),
 window_start INTEGER NOT NULL CHECK(window_start>=0 AND window_start%60=0),
 used INTEGER NOT NULL CHECK(used>=1),
 PRIMARY KEY(user_id,provider,kind)
);
CREATE TRIGGER connector_budget_initial BEFORE INSERT ON connector_request_budgets
WHEN NEW.used!=1
BEGIN SELECT RAISE(ABORT,'connector_budget_initial'); END;
CREATE TRIGGER connector_budget_identity BEFORE UPDATE ON connector_request_budgets
WHEN NEW.user_id!=OLD.user_id OR NEW.provider!=OLD.provider OR NEW.kind!=OLD.kind
 OR NOT ((NEW.window_start=OLD.window_start AND NEW.used=OLD.used+1) OR (NEW.window_start>OLD.window_start AND NEW.used=1))
BEGIN SELECT RAISE(ABORT,'connector_budget_immutable'); END;
CREATE TRIGGER connector_budget_limit BEFORE UPDATE ON connector_request_budgets
WHEN NEW.used>CASE NEW.kind WHEN 'read' THEN 60 ELSE 10 END
BEGIN SELECT RAISE(ABORT,'connector_provider_rate_limited'); END;
-- These counters and the receipt claim commit together. Replayed and losing claims consume no slot.
CREATE TRIGGER connector_budget_github_action BEFORE UPDATE OF state ON github_backups
WHEN OLD.state='pending' AND NEW.state='dispatching'
BEGIN
 INSERT INTO connector_request_budgets(user_id,provider,kind,window_start,used) VALUES(NEW.user_id,'github','action',(unixepoch()/60)*60,1)
 ON CONFLICT(user_id,provider,kind) DO UPDATE SET window_start=MAX(window_start,excluded.window_start),used=CASE WHEN excluded.window_start>window_start THEN 1 ELSE used+1 END;
END;
CREATE TRIGGER connector_budget_cloudflare_action BEFORE UPDATE OF state ON cloudflare_dns_actions
WHEN OLD.state='review' AND NEW.state='sending'
BEGIN
 INSERT INTO connector_request_budgets(user_id,provider,kind,window_start,used) VALUES(NEW.user_id,'cloudflare','action',(unixepoch()/60)*60,1)
 ON CONFLICT(user_id,provider,kind) DO UPDATE SET window_start=MAX(window_start,excluded.window_start),used=CASE WHEN excluded.window_start>window_start THEN 1 ELSE used+1 END;
END;

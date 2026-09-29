CREATE TABLE github_oauth_states (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL UNIQUE,
 session_hash TEXT NOT NULL,
 verifier_ciphertext TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1))
);
CREATE TABLE github_token_vault (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','revoking'))
);
CREATE INDEX github_tokens_cleanup ON github_token_vault(state,expires_at);
CREATE TABLE github_connections (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 github_user_id TEXT NOT NULL,
 login TEXT NOT NULL,
 active_token_id TEXT REFERENCES github_token_vault(id) ON DELETE SET NULL,
 connected_at TEXT NOT NULL
);
CREATE TRIGGER github_connection_owner_insert BEFORE INSERT ON github_connections
WHEN NEW.active_token_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'github_token_owner') WHERE NOT EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.active_token_id AND user_id=NEW.user_id AND state='active'); END;
CREATE TRIGGER github_connection_owner_update BEFORE UPDATE ON github_connections
WHEN NEW.active_token_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'github_token_owner') WHERE NOT EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.active_token_id AND user_id=NEW.user_id AND state='active'); END;
CREATE TRIGGER github_token_quota BEFORE INSERT ON github_token_vault
WHEN (SELECT COUNT(*) FROM github_token_vault WHERE user_id=NEW.user_id)>=10
BEGIN SELECT RAISE(ABORT,'github_token_quota'); END;

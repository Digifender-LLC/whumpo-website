CREATE TABLE cloudflare_oauth_states (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL UNIQUE, session_hash TEXT NOT NULL,
 verifier_ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1)),
 cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1))
);
CREATE TABLE cloudflare_token_vault (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 revoke_attempt TEXT, revoke_after TEXT,
 state TEXT NOT NULL CHECK(state IN ('staged','active','revoking'))
);
CREATE UNIQUE INDEX cloudflare_one_active ON cloudflare_token_vault(user_id) WHERE state='active';
CREATE TRIGGER cloudflare_vault_quota BEFORE INSERT ON cloudflare_token_vault
WHEN (SELECT COUNT(*) FROM cloudflare_token_vault WHERE user_id=NEW.user_id)>=10
BEGIN SELECT RAISE(ABORT,'cloudflare_vault_quota'); END;
CREATE TRIGGER cloudflare_vault_identity BEFORE UPDATE ON cloudflare_token_vault
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.ciphertext!=OLD.ciphertext OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'cloudflare_vault_immutable'); END;

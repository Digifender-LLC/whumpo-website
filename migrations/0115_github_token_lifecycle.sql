-- Staged tokens have no connection pointer and therefore confer no capability.
-- Preserve the vault format, ownership triggers, encryption context and quotas.
CREATE TABLE github_token_staging (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX github_staging_expiry ON github_token_staging(expires_at);
CREATE TABLE github_revocation_claims (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

-- Telemetry follows credential lifetime. Existing requests retain unknown age.
CREATE TABLE github_revocation_health (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 requested_at TEXT
);
CREATE TABLE cloudflare_revocation_health (
 token_id TEXT PRIMARY KEY REFERENCES cloudflare_token_vault(id) ON DELETE CASCADE,
 requested_at TEXT
);
INSERT INTO github_revocation_health SELECT id,NULL FROM github_token_vault WHERE state='revoking';
INSERT INTO cloudflare_revocation_health SELECT id,NULL FROM cloudflare_token_vault WHERE state='revoking';
CREATE TRIGGER github_revocation_health_insert AFTER INSERT ON github_token_vault WHEN NEW.state='revoking'
BEGIN INSERT OR IGNORE INTO github_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER github_revocation_health_update AFTER UPDATE OF state ON github_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO github_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER cloudflare_revocation_health_insert AFTER INSERT ON cloudflare_token_vault WHEN NEW.state='revoking'
BEGIN INSERT OR IGNORE INTO cloudflare_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER cloudflare_revocation_health_update AFTER UPDATE OF state ON cloudflare_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO cloudflare_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

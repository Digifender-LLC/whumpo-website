CREATE TABLE cloudflare_dns_actions (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL REFERENCES domain_claims(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 token_id TEXT NOT NULL,zone_id TEXT NOT NULL,zone_name TEXT NOT NULL,
 record_name TEXT NOT NULL,content TEXT NOT NULL,inventory_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','sending','uncertain','applied','unchanged','observed')),
 provider_id TEXT,detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX cloudflare_dns_owner ON cloudflare_dns_actions(user_id,created_at);
CREATE UNIQUE INDEX cloudflare_dns_pending ON cloudflare_dns_actions(zone_id,record_name) WHERE state IN ('sending','uncertain');
CREATE UNIQUE INDEX cloudflare_dns_attempt ON cloudflare_dns_actions(zone_id,record_name,content) WHERE state IN ('sending','uncertain','applied','observed');
CREATE TRIGGER cloudflare_dns_quota BEFORE INSERT ON cloudflare_dns_actions
WHEN (SELECT COUNT(*) FROM cloudflare_dns_actions WHERE user_id=NEW.user_id)>=100
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_quota'); END;
CREATE TRIGGER cloudflare_dns_identity BEFORE UPDATE ON cloudflare_dns_actions
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.claim_id!=OLD.claim_id OR NEW.project_id!=OLD.project_id OR NEW.token_id!=OLD.token_id OR NEW.zone_id!=OLD.zone_id OR NEW.zone_name!=OLD.zone_name OR NEW.record_name!=OLD.record_name OR NEW.content!=OLD.content OR NEW.inventory_hash!=OLD.inventory_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_immutable'); END;
CREATE TRIGGER cloudflare_dns_dispatch BEFORE UPDATE OF state ON cloudflare_dns_actions
WHEN OLD.state='review' AND NEW.state IN ('sending','unchanged')
BEGIN
 SELECT RAISE(ABORT,'cloudflare_dns_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN cloudflare_token_vault t ON t.user_id=p.owner_user_id WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND '_tellumo.'||d.hostname=NEW.record_name AND 'tellumo-verification='||d.token=NEW.content AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND t.id=NEW.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER cloudflare_dns_receipt AFTER UPDATE OF state ON cloudflare_dns_actions
WHEN NEW.state IN ('applied','unchanged','observed') AND OLD.state NOT IN ('applied','unchanged','observed')
BEGIN
 INSERT OR IGNORE INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('cf-dns:'||NEW.id,NEW.user_id,NEW.project_id,'domain.dns.receipt','Recorded Cloudflare TXT proof result; public DNS verification remains separate',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

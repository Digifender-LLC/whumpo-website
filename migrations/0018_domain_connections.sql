CREATE TABLE domain_connections (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 claim_id TEXT NOT NULL REFERENCES domain_claims(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 hostname TEXT NOT NULL,
 zone_id TEXT NOT NULL,
 target TEXT NOT NULL,
 proof_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('review','creating','uncertain','provisioning','active','disconnecting','disconnected')),
 provider_id TEXT,
 provider_status TEXT NOT NULL DEFAULT '',
 ssl_status TEXT NOT NULL DEFAULT '',
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 checked_at TEXT,
 serve_until TEXT
);
CREATE UNIQUE INDEX domain_connection_hostname ON domain_connections(hostname) WHERE state NOT IN ('review','disconnected');
CREATE UNIQUE INDEX domain_connection_provider ON domain_connections(zone_id,provider_id) WHERE provider_id IS NOT NULL;
CREATE INDEX domain_connection_owner ON domain_connections(user_id,created_at DESC);
CREATE TRIGGER domain_connection_owner BEFORE INSERT ON domain_connections BEGIN
 SELECT RAISE(ABORT,'domain_connection_initial') WHERE NEW.state!='review' OR NEW.provider_id IS NOT NULL OR NEW.serve_until IS NOT NULL;
 SELECT RAISE(ABORT,'domain_connection_owner') WHERE NOT EXISTS(SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND d.hostname=NEW.hostname AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'domain_connection_reviews') WHERE (SELECT COUNT(*) FROM domain_connections WHERE user_id=NEW.user_id)>=100;
END;
CREATE TRIGGER domain_connection_capacity BEFORE UPDATE OF state ON domain_connections
WHEN OLD.state='review' AND NEW.state='creating'
BEGIN SELECT RAISE(ABORT,'domain_connection_capacity') WHERE (SELECT COUNT(*) FROM domain_connections WHERE state NOT IN ('review','disconnected'))>=80; END;
CREATE TRIGGER domain_connection_identity BEFORE UPDATE ON domain_connections
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.claim_id!=OLD.claim_id OR NEW.project_id!=OLD.project_id OR NEW.hostname!=OLD.hostname OR NEW.zone_id!=OLD.zone_id OR NEW.target!=OLD.target OR NEW.proof_hash!=OLD.proof_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id)
BEGIN SELECT RAISE(ABORT,'domain_connection_immutable'); END;

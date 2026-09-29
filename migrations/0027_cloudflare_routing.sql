ALTER TABLE cloudflare_dns_actions ADD COLUMN record_type TEXT NOT NULL DEFAULT 'TXT' CHECK(record_type IN ('TXT','CNAME'));
ALTER TABLE cloudflare_dns_actions ADD COLUMN connection_id TEXT REFERENCES domain_connections(id) ON DELETE RESTRICT;
ALTER TABLE cloudflare_dns_actions ADD COLUMN proof_token TEXT;
CREATE TRIGGER cloudflare_dns_routing_identity BEFORE UPDATE ON cloudflare_dns_actions
WHEN NEW.record_type!=OLD.record_type OR NEW.connection_id IS NOT OLD.connection_id OR NEW.proof_token IS NOT OLD.proof_token
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_immutable'); END;
CREATE TRIGGER cloudflare_dns_routing_insert BEFORE INSERT ON cloudflare_dns_actions
WHEN (NEW.record_type='TXT' AND (NEW.connection_id IS NOT NULL OR NEW.proof_token IS NOT NULL)) OR
(NEW.record_type='CNAME' AND (NEW.content!='hosting.digifender.com' OR NEW.record_name=NEW.zone_name OR NEW.connection_id IS NULL OR NEW.proof_token IS NULL OR NOT EXISTS(
 SELECT 1 FROM domain_connections c JOIN domain_claims d ON d.id=c.claim_id JOIN projects p ON p.id=c.project_id
 WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.claim_id=NEW.claim_id AND c.project_id=NEW.project_id AND d.project_id=c.project_id AND d.hostname=c.hostname AND c.hostname=NEW.record_name AND c.target=NEW.content AND c.zone_id='fbf8bf845a46cadbb793ffeb8b5716f5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL AND d.token=NEW.proof_token AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_stale'); END;
DROP TRIGGER cloudflare_dns_dispatch;
CREATE TRIGGER cloudflare_dns_dispatch BEFORE UPDATE OF state ON cloudflare_dns_actions
WHEN OLD.state='review' AND NEW.state IN ('sending','unchanged')
BEGIN
 SELECT RAISE(ABORT,'cloudflare_dns_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN cloudflare_token_vault t ON t.user_id=p.owner_user_id
 WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND t.id=NEW.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (
 (NEW.record_type='TXT' AND '_whumpo.'||d.hostname=NEW.record_name AND 'whumpo-verification='||d.token=NEW.content)
 OR (NEW.record_type='CNAME' AND d.hostname=NEW.record_name AND d.token=NEW.proof_token AND NEW.content='hosting.digifender.com' AND NEW.record_name!=NEW.zone_name AND EXISTS(
 SELECT 1 FROM domain_connections c WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND c.claim_id=d.id AND c.project_id=d.project_id AND c.hostname=d.hostname AND c.target=NEW.content AND c.zone_id='fbf8bf845a46cadbb793ffeb8b5716f5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL))));
END;
DROP TRIGGER cloudflare_dns_receipt;
CREATE TRIGGER cloudflare_dns_receipt AFTER UPDATE OF state ON cloudflare_dns_actions
WHEN NEW.state IN ('applied','unchanged','observed') AND OLD.state NOT IN ('applied','unchanged','observed')
BEGIN
 INSERT OR IGNORE INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('cf-dns:'||NEW.id,NEW.user_id,NEW.project_id,'domain.dns.receipt','Recorded Cloudflare '||NEW.record_type||' result; public DNS and hosting verification remain separate',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

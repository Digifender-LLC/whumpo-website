-- Keep database admission rules aligned with the Whumpo origins.
-- Existing resource identities and review receipts remain immutable.

DROP TRIGGER cms_deployment_insert;
CREATE TRIGGER cms_deployment_insert BEFORE INSERT ON cms_deployments WHEN NEW.state<>'reserved' OR NOT EXISTS(
 SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_setup_reviews r ON r.id=c.review_id WHERE c.project_id=NEW.project_id AND p.owner_user_id=c.user_id AND r.status='approved' AND c.state<>'ready' AND NEW.origin='https://'||c.worker_name||'.whumpo.site' AND (SELECT count(*) FROM cms_resource_jobs j WHERE j.project_id=c.project_id AND j.account_id=NEW.account_id AND j.state='complete')=3
) BEGIN SELECT RAISE(ABORT,'cms_deployment_not_approved'); END;

DROP TRIGGER cloudflare_dns_routing_insert;
CREATE TRIGGER cloudflare_dns_routing_insert BEFORE INSERT ON cloudflare_dns_actions
WHEN (NEW.record_type='TXT' AND (NEW.connection_id IS NOT NULL OR NEW.proof_token IS NOT NULL)) OR
(NEW.record_type='CNAME' AND (NEW.content!='hosting.whumpo.site' OR NEW.record_name=NEW.zone_name OR NEW.connection_id IS NULL OR NEW.proof_token IS NULL OR NOT EXISTS(
 SELECT 1 FROM domain_connections c JOIN domain_claims d ON d.id=c.claim_id JOIN projects p ON p.id=c.project_id
 WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.claim_id=NEW.claim_id AND c.project_id=NEW.project_id AND d.project_id=c.project_id AND d.hostname=c.hostname AND c.hostname=NEW.record_name AND c.target=NEW.content AND c.zone_id='8d46ee4e394514402479acf16579f7b5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL AND d.token=NEW.proof_token AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_stale'); END;

DROP TRIGGER cloudflare_dns_dispatch;
CREATE TRIGGER cloudflare_dns_dispatch BEFORE UPDATE OF state ON cloudflare_dns_actions
WHEN OLD.state='review' AND NEW.state IN ('sending','unchanged')
BEGIN
 SELECT RAISE(ABORT,'cloudflare_dns_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN cloudflare_token_vault t ON t.user_id=p.owner_user_id
 WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND t.id=NEW.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (
 (NEW.record_type='TXT' AND '_whumpo.'||d.hostname=NEW.record_name AND 'whumpo-verification='||d.token=NEW.content)
 OR (NEW.record_type='CNAME' AND d.hostname=NEW.record_name AND d.token=NEW.proof_token AND NEW.content='hosting.whumpo.site' AND NEW.record_name!=NEW.zone_name AND EXISTS(
 SELECT 1 FROM domain_connections c WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND c.claim_id=d.id AND c.project_id=d.project_id AND c.hostname=d.hostname AND c.target=NEW.content AND c.zone_id='8d46ee4e394514402479acf16579f7b5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL))));
END;

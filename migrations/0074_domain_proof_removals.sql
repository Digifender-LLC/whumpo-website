CREATE TABLE domain_proof_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL, hostname TEXT NOT NULL, proof_token TEXT NOT NULL,
 proof_expires_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);
CREATE INDEX domain_proof_removal_claim ON domain_proof_removals(claim_id,status);
CREATE TRIGGER domain_proof_removal_identity BEFORE UPDATE ON domain_proof_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.claim_id!=OLD.claim_id OR NEW.hostname!=OLD.hostname OR NEW.proof_token!=OLD.proof_token OR NEW.proof_expires_at!=OLD.proof_expires_at OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'domain_proof_removal_immutable'); END;
CREATE TRIGGER domain_proof_removal_guard BEFORE UPDATE ON domain_proof_removals
BEGIN
 SELECT RAISE(ABORT,'domain_proof_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'domain_proof_removal_changed') WHERE NOT EXISTS(
  SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by
  WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND d.hostname=NEW.hostname AND d.token=NEW.proof_token AND d.expires_at=NEW.proof_expires_at AND p.owner_user_id=NEW.user_id
  AND t.user_id=NEW.user_id AND t.mode='guided' AND lower(trim(t.user_text))='/confirm-domain-proof-remove '||NEW.id);
END;
CREATE TRIGGER domain_proof_removal_apply AFTER UPDATE ON domain_proof_removals
BEGIN
 DELETE FROM domain_claims WHERE id=NEW.claim_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('domain-proof-removal:'||NEW.claim_id,NEW.user_id,NEW.project_id,'domain.proof.removed','Removed unused domain ownership proof',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER domain_proof_retained BEFORE DELETE ON domain_claims
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN
 SELECT RAISE(ABORT,'domain_proof_removal_retained') WHERE EXISTS(SELECT 1 FROM domain_connections WHERE claim_id=OLD.id) OR EXISTS(SELECT 1 FROM cloudflare_dns_actions WHERE claim_id=OLD.id);
 SELECT RAISE(ABORT,'domain_proof_removal_unreviewed') WHERE NOT EXISTS(SELECT 1 FROM domain_proof_removals WHERE claim_id=OLD.id AND project_id=OLD.project_id AND proof_token=OLD.token AND status='applied');
END;
CREATE TRIGGER domain_proof_removed BEFORE INSERT ON domain_claims
WHEN EXISTS(SELECT 1 FROM domain_proof_removals WHERE claim_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'domain_proof_removal_replay'); END;

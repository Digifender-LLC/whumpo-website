CREATE TABLE domain_claims (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 3 AND 253),
 token TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 verified_at TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,hostname)
);
CREATE TRIGGER domain_claim_quota BEFORE INSERT ON domain_claims BEGIN
 SELECT RAISE(ABORT,'domain_claim_quota') WHERE
 (SELECT COUNT(*) FROM domain_claims WHERE project_id=NEW.project_id)>=3 OR
 (SELECT COUNT(*) FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=10 OR
 (SELECT COUNT(*) FROM domain_claims)>=80;
END;
CREATE TRIGGER domain_claim_identity BEFORE UPDATE OF id,project_id,hostname,created_at ON domain_claims BEGIN
 SELECT RAISE(ABORT,'domain_claim_identity');
END;

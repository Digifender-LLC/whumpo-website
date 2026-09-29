ALTER TABLE domain_connections ADD COLUMN check_id TEXT;
ALTER TABLE domain_connections ADD COLUMN reconciliation_id TEXT;
ALTER TABLE domain_connections ADD COLUMN reconciliation_evidence TEXT;
ALTER TABLE domain_connections ADD COLUMN reconciliation_operator TEXT;
CREATE TABLE domain_reconciliations (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL REFERENCES domain_connections(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL,
 hostname TEXT NOT NULL,
 zone_id TEXT NOT NULL,
 provider_id TEXT NOT NULL,
 old_state TEXT NOT NULL,
 new_state TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(length(evidence) BETWEEN 12 AND 1000),
 operator TEXT NOT NULL CHECK(length(operator) BETWEEN 1 AND 100),
 created_at TEXT NOT NULL
);
CREATE TRIGGER domain_reconciliation_audit AFTER UPDATE OF reconciliation_id ON domain_connections
WHEN NEW.reconciliation_id IS NOT NULL AND NEW.reconciliation_id IS NOT OLD.reconciliation_id
BEGIN
 SELECT RAISE(ABORT,'domain_reconciliation_state') WHERE OLD.provider_id IS NOT NULL OR OLD.state NOT IN ('uncertain','disconnecting') OR NEW.provider_id IS NULL OR NEW.state NOT IN ('provisioning','disconnecting') OR NEW.serve_until IS NOT NULL OR (OLD.state='disconnecting' AND NEW.state!='disconnecting');
 INSERT INTO domain_reconciliations(id,connection_id,user_id,hostname,zone_id,provider_id,old_state,new_state,evidence,operator,created_at) VALUES(NEW.reconciliation_id,NEW.id,NEW.user_id,NEW.hostname,NEW.zone_id,NEW.provider_id,OLD.state,NEW.state,NEW.reconciliation_evidence,NEW.reconciliation_operator,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('hosting-recovery:'||NEW.reconciliation_id,NEW.user_id,NEW.project_id,'domain.reconciled','Operator reconciled an uncertain hostname; routing remains disabled',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER domain_reconciliation_no_update BEFORE UPDATE ON domain_reconciliations BEGIN SELECT RAISE(ABORT,'domain_reconciliation_immutable'); END;
CREATE TRIGGER domain_reconciliation_no_delete BEFORE DELETE ON domain_reconciliations BEGIN SELECT RAISE(ABORT,'domain_reconciliation_immutable'); END;

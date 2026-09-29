-- Preserve daily resource admission when a visitor erases their private history.
CREATE TABLE app_daily_usage (
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 day TEXT NOT NULL,
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 PRIMARY KEY(project_id,day)
);
INSERT INTO app_daily_usage SELECT project_id,day,count(*) FROM app_runs GROUP BY project_id,day;
DROP TRIGGER app_run_admit;
CREATE TRIGGER app_run_admit BEFORE INSERT ON app_runs BEGIN
 SELECT RAISE(ABORT,'app_run_identity') WHERE NEW.state<>'running' OR NOT EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=0 AND a.enabled=1 AND a.version_id=NEW.version_id AND a.revision=NEW.program_revision AND d.revision=NEW.base_revision AND s.token_hash=NEW.session_hash AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'app_run_quota') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR (SELECT count(*) FROM app_runs)>=10000 OR (SELECT count(*) FROM app_runs WHERE visitor_id=NEW.visitor_id AND day=NEW.day)>=20 OR coalesce((SELECT attempts FROM app_daily_usage WHERE project_id=NEW.project_id AND day=NEW.day),0)>=100 OR coalesce((SELECT sum(attempts) FROM app_daily_usage WHERE day=NEW.day),0)>=1000;
END;
CREATE TRIGGER app_run_meter AFTER INSERT ON app_runs BEGIN
 INSERT INTO app_daily_usage(project_id,day,attempts) VALUES(NEW.project_id,NEW.day,1) ON CONFLICT(project_id,day) DO UPDATE SET attempts=attempts+1;
END;
CREATE TABLE app_deletion_receipts (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 proof_hash TEXT NOT NULL CHECK(length(proof_hash)=64),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);
CREATE TRIGGER app_deletion_receipt_immutable BEFORE UPDATE ON app_deletion_receipts BEGIN SELECT RAISE(ABORT,'app_deletion_receipt_immutable'); END;
CREATE TRIGGER app_deletion_receipt_capacity BEFORE INSERT ON app_deletion_receipts WHEN (SELECT count(*) FROM app_deletion_receipts)>=1000
 BEGIN SELECT RAISE(ABORT,'app_deletion_receipt_capacity'); END;
CREATE TRIGGER app_visitor_erase BEFORE DELETE ON app_visitors BEGIN
 DELETE FROM app_auth_challenges WHERE visitor_id=OLD.id;
 DELETE FROM app_invitations WHERE used_by=OLD.id;
 DELETE FROM app_passkeys WHERE visitor_id=OLD.id;
 DELETE FROM app_recovery_codes WHERE visitor_id=OLD.id;
 DELETE FROM app_sessions WHERE visitor_id=OLD.id;
 DELETE FROM app_runs WHERE visitor_id=OLD.id;
 DELETE FROM app_documents WHERE visitor_id=OLD.id;
END;

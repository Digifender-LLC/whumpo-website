-- Keep immutable request receipts; remove temporary transformed payloads.
CREATE TABLE app_migration_cancellations (
 id TEXT PRIMARY KEY REFERENCES app_migration_checks(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER app_migration_cancel_admit BEFORE INSERT ON app_migration_cancellations BEGIN
 SELECT RAISE(ABORT,'migration_cancel_owner') WHERE NOT EXISTS(SELECT 1 FROM app_migration_checks m JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id WHERE m.id=NEW.id AND m.user_id=NEW.user_id);
 SELECT RAISE(ABORT,'migration_already_applied') WHERE EXISTS(SELECT 1 FROM app_migration_approvals WHERE id=NEW.id);
END;
CREATE TRIGGER app_migration_cancel_update BEFORE UPDATE ON app_migration_cancellations BEGIN SELECT RAISE(ABORT,'migration_cancel_immutable'); END;
CREATE TRIGGER app_migration_cancel_delete BEFORE DELETE ON app_migration_cancellations BEGIN SELECT RAISE(ABORT,'migration_cancel_immutable'); END;
CREATE TRIGGER app_migration_cancel_cleanup AFTER INSERT ON app_migration_cancellations BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;
CREATE TRIGGER app_migration_applied_cleanup AFTER UPDATE OF status ON app_migration_approvals WHEN NEW.status='applied' BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;
DROP VIEW app_migration_current;
CREATE VIEW app_migration_current AS SELECT m.id FROM app_migration_checks m
 JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id
 JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id
 JOIN app_recovery_points b ON b.id=m.id AND b.project_id=m.project_id AND b.user_id=m.user_id AND b.version_id=m.from_version AND b.removed=0 AND b.sealed=1
 JOIN app_recovery_rosters roster ON roster.project_id=m.project_id
 WHERE a.enabled=0 AND a.version_id=m.from_version AND a.revision=m.base_revision AND roster.roster_json=m.roster_json AND m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM json_each(m.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=m.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.revision=json_extract(entry.value,'$.revision'))) AND NOT EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=m.id);
DROP TRIGGER app_migration_check_admit;
CREATE TRIGGER app_migration_check_admit BEFORE INSERT ON app_migration_checks BEGIN
 SELECT RAISE(ABORT,'migration_authority') WHERE NEW.to_version=NEW.from_version OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points b ON b.id=NEW.id AND b.user_id=a.owner_user_id AND b.project_id=a.project_id AND b.version_id=a.version_id AND b.removed=0 AND b.sealed=1 JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.version_id=NEW.from_version AND a.revision=NEW.base_revision AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'migration_version') WHERE NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.to_version AND project_id=NEW.project_id) OR NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.transform_version AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'migration_test') WHERE NOT EXISTS(SELECT 1 FROM backend_runs r WHERE r.id=NEW.test_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.to_version AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1 AND json_extract(r.result_json,'$.check.status')='passed' AND json_type(r.result_json,'$.value')='object' AND (SELECT count(*) FROM json_each(r.result_json,'$.value'))=2 AND json_type(r.result_json,'$.value.state') IS NOT NULL AND json_type(r.result_json,'$.value.result') IS NOT NULL AND length(CAST(json_quote(json_extract(r.result_json,'$.value.state')) AS BLOB))<=4096 AND length(CAST(json_quote(json_extract(r.result_json,'$.value.result')) AS BLOB))<=4096);
 SELECT RAISE(ABORT,'migration_capacity') WHERE (SELECT count(*) FROM app_migration_checks m JOIN app_migration_current c ON c.id=m.id WHERE m.project_id=NEW.project_id)>=5 OR (SELECT count(*) FROM app_migration_current)>=50 OR (SELECT count(*) FROM app_migration_checks)>=1000;
END;
-- Remove obsolete staging on rollout, preserving recovery points and receipts.
DELETE FROM app_migration_documents WHERE NOT EXISTS(SELECT 1 FROM app_migration_current c WHERE c.id=migration_id);

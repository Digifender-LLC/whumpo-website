-- Atomic offline program/data replacement after a complete staged check.
CREATE TABLE app_migration_approvals (
 id TEXT PRIMARY KEY REFERENCES app_migration_checks(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 changed_documents INTEGER NOT NULL CHECK(changed_documents BETWEEN 0 AND 100),
 status TEXT NOT NULL DEFAULT 'applying' CHECK(status IN ('applying','applied')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
ALTER TABLE app_spaces ADD COLUMN migration_id TEXT REFERENCES app_migration_approvals(id);
CREATE TRIGGER app_migration_initial_space BEFORE INSERT ON app_spaces WHEN NEW.migration_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'migration_initial'); END;
CREATE TRIGGER app_migration_approval_admit BEFORE INSERT ON app_migration_approvals BEGIN
 SELECT RAISE(ABORT,'migration_changed_count') WHERE NEW.changed_documents!=(SELECT count(*) FROM app_migration_documents d JOIN app_recovery_documents b ON b.point_id=d.migration_id AND b.visitor_id=d.visitor_id WHERE d.migration_id=NEW.id AND d.state='ready' AND d.next_json!=b.state_json);
 SELECT RAISE(ABORT,'migration_approval') WHERE NEW.status!='applying' OR NOT EXISTS(SELECT 1 FROM app_migration_checks m JOIN app_migration_current current ON current.id=m.id WHERE m.id=NEW.id AND m.user_id=NEW.user_id);
 SELECT RAISE(ABORT,'migration_incomplete') WHERE (SELECT count(*) FROM app_migration_documents WHERE migration_id=NEW.id)!=(SELECT json_array_length(roster_json) FROM app_migration_checks WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=NEW.id AND state!='ready');
 SELECT RAISE(ABORT,'migration_roster') WHERE EXISTS(SELECT 1 FROM app_migration_checks m,json_each(m.roster_json) entry WHERE m.id=NEW.id AND NOT EXISTS(SELECT 1 FROM app_migration_documents d WHERE d.migration_id=m.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.base_revision=json_extract(entry.value,'$.revision')));
END;
CREATE TRIGGER app_migration_approval_update BEFORE UPDATE ON app_migration_approvals WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR NEW.changed_documents!=OLD.changed_documents OR OLD.status!='applying' OR NEW.status!='applied'
 BEGIN SELECT RAISE(ABORT,'migration_approval_immutable'); END;
CREATE TRIGGER app_migration_approval_delete BEFORE DELETE ON app_migration_approvals BEGIN SELECT RAISE(ABORT,'migration_approval_immutable'); END;
-- Ordinary activation keeps its original reviewed path. Only the transaction
-- currently applying an admitted migration may replace the offline program.
DROP TRIGGER app_space_apply_review;
CREATE TRIGGER app_space_apply_review BEFORE UPDATE ON app_spaces WHEN NOT (
 (NEW.migration_id IS OLD.migration_id AND EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.owner_user_id AND r.version_id=NEW.version_id AND r.enabled=NEW.enabled AND r.base_revision=OLD.revision AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 OR (NEW.enabled=0 AND OLD.enabled=0 AND NEW.review_id IS OLD.review_id AND NEW.migration_id IS NOT OLD.migration_id AND EXISTS(SELECT 1 FROM app_migration_approvals receipt JOIN app_migration_checks m ON m.id=receipt.id WHERE receipt.id=NEW.migration_id AND receipt.user_id=NEW.owner_user_id AND receipt.status='applying' AND m.project_id=NEW.project_id AND m.user_id=NEW.owner_user_id AND m.from_version=OLD.version_id AND m.to_version=NEW.version_id AND m.base_revision=OLD.revision))
) BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;
CREATE TRIGGER app_migration_approval_apply AFTER INSERT ON app_migration_approvals BEGIN
 UPDATE app_documents SET revision=revision+1,state_json=(SELECT next_json FROM app_migration_documents WHERE migration_id=NEW.id AND visitor_id=app_documents.visitor_id) WHERE visitor_id IN(SELECT visitor_id FROM app_migration_documents WHERE migration_id=NEW.id);
 UPDATE app_spaces SET version_id=(SELECT to_version FROM app_migration_checks WHERE id=NEW.id),revision=revision+1,migration_id=NEW.id WHERE project_id=(SELECT project_id FROM app_migration_checks WHERE id=NEW.id);
 DELETE FROM app_sessions WHERE visitor_id IN(SELECT id FROM app_visitors WHERE project_id=(SELECT project_id FROM app_migration_checks WHERE id=NEW.id));
 UPDATE app_migration_approvals SET status='applied' WHERE id=NEW.id;
END;

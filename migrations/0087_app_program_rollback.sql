-- Cross-version rollback is a separate exact review, with no automatic activation.
ALTER TABLE app_restore_reviews ADD COLUMN restore_program INTEGER NOT NULL DEFAULT 0 CHECK(restore_program IN (0,1));
ALTER TABLE app_restore_reviews ADD COLUMN from_version TEXT REFERENCES backend_versions(id);
ALTER TABLE app_spaces ADD COLUMN rollback_id TEXT REFERENCES app_restore_reviews(id);
CREATE TRIGGER app_rollback_initial_space BEFORE INSERT ON app_spaces WHEN NEW.rollback_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'rollback_initial'); END;
DROP TRIGGER app_restore_admit;
CREATE TRIGGER app_restore_admit BEFORE INSERT ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_initial') WHERE NEW.status!='pending';
 SELECT RAISE(ABORT,'restore_authority') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND ((NEW.restore_program=0 AND NEW.from_version IS NULL AND a.version_id=r.version_id) OR (NEW.restore_program=1 AND NEW.from_version=a.version_id AND a.version_id!=r.version_id)) AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
 SELECT RAISE(ABORT,'restore_capacity') WHERE (SELECT count(*) FROM app_restore_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_restore_reviews)>=1000;
END;
DROP TRIGGER app_restore_immutable;
CREATE TRIGGER app_restore_immutable BEFORE UPDATE ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_immutable') WHERE NEW.restore_program!=OLD.restore_program OR NEW.from_version IS NOT OLD.from_version OR NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.point_id!=OLD.point_id OR NEW.base_revision!=OLD.base_revision OR NEW.roster_json!=OLD.roster_json OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied';
 SELECT RAISE(ABORT,'restore_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND ((NEW.restore_program=0 AND a.version_id=r.version_id) OR (NEW.restore_program=1 AND NEW.from_version=a.version_id AND a.version_id!=r.version_id)) AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
END;
DROP TRIGGER app_restore_apply;
CREATE TRIGGER app_restore_apply AFTER UPDATE OF status ON app_restore_reviews BEGIN
 UPDATE app_documents SET revision=revision+1,state_json=(SELECT state_json FROM app_recovery_documents WHERE point_id=NEW.point_id AND visitor_id=app_documents.visitor_id) WHERE visitor_id IN(SELECT json_extract(value,'$.visitor') FROM json_each(NEW.roster_json));
 UPDATE app_spaces SET version_id=(SELECT version_id FROM app_recovery_points WHERE id=NEW.point_id),revision=revision+1,rollback_id=NEW.id WHERE project_id=NEW.project_id AND NEW.restore_program=1;
 DELETE FROM app_sessions WHERE NEW.restore_program=1 AND visitor_id IN(SELECT id FROM app_visitors WHERE project_id=NEW.project_id);
END;
DROP TRIGGER app_space_apply_review;
CREATE TRIGGER app_space_apply_review BEFORE UPDATE ON app_spaces WHEN NOT (
 (NEW.rollback_id IS OLD.rollback_id AND NEW.migration_id IS OLD.migration_id AND EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.owner_user_id AND r.version_id=NEW.version_id AND r.enabled=NEW.enabled AND r.base_revision=OLD.revision AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 OR (NEW.rollback_id IS OLD.rollback_id AND NEW.enabled=0 AND OLD.enabled=0 AND NEW.review_id IS OLD.review_id AND NEW.migration_id IS NOT OLD.migration_id AND EXISTS(SELECT 1 FROM app_migration_approvals receipt JOIN app_migration_checks m ON m.id=receipt.id WHERE receipt.id=NEW.migration_id AND receipt.user_id=NEW.owner_user_id AND receipt.status='applying' AND m.project_id=NEW.project_id AND m.user_id=NEW.owner_user_id AND m.from_version=OLD.version_id AND m.to_version=NEW.version_id AND m.base_revision=OLD.revision))
 OR (NEW.enabled=0 AND OLD.enabled=0 AND NEW.review_id IS OLD.review_id AND NEW.migration_id IS OLD.migration_id AND NEW.rollback_id IS NOT OLD.rollback_id AND EXISTS(SELECT 1 FROM app_restore_reviews r JOIN app_recovery_points p ON p.id=r.point_id WHERE r.id=NEW.rollback_id AND r.user_id=NEW.owner_user_id AND r.project_id=NEW.project_id AND r.restore_program=1 AND r.status='applied' AND r.from_version=OLD.version_id AND p.version_id=NEW.version_id AND r.base_revision=OLD.revision))
) BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;
CREATE TRIGGER app_rollback_backup_admit BEFORE INSERT ON app_restore_reviews WHEN NEW.restore_program=1 BEGIN
 SELECT RAISE(ABORT,'rollback_backup') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points b WHERE b.id=NEW.id AND b.project_id=NEW.project_id AND b.user_id=NEW.user_id AND b.version_id=NEW.from_version AND b.sealed=1 AND b.removed=0) OR EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.revision=json_extract(entry.value,'$.revision')));
END;
CREATE TRIGGER app_rollback_backup_confirm BEFORE UPDATE ON app_restore_reviews WHEN NEW.restore_program=1 BEGIN
 SELECT RAISE(ABORT,'rollback_backup') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points b WHERE b.id=NEW.id AND b.project_id=NEW.project_id AND b.user_id=NEW.user_id AND b.version_id=NEW.from_version AND b.sealed=1 AND b.removed=0);
END;

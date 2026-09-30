-- Keep request metadata so a lost-response retry cannot recreate a removed copy.
ALTER TABLE app_recovery_points ADD COLUMN removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1));
DROP TRIGGER app_recovery_admit;
CREATE TRIGGER app_recovery_admit BEFORE INSERT ON app_recovery_points BEGIN
 SELECT RAISE(ABORT,'recovery_initial') WHERE NEW.sealed!=0 OR NEW.removed!=0;
 SELECT RAISE(ABORT,'recovery_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.version_id=NEW.version_id);
 SELECT RAISE(ABORT,'recovery_capacity') WHERE (SELECT count(*) FROM app_recovery_points WHERE project_id=NEW.project_id AND removed=0)>=10 OR (SELECT count(*) FROM app_recovery_points WHERE removed=0)>=100 OR (SELECT count(*) FROM app_recovery_points)>=1000;
END;
DROP TRIGGER app_recovery_point_immutable;
CREATE TRIGGER app_recovery_point_immutable BEFORE UPDATE ON app_recovery_points BEGIN
 SELECT RAISE(ABORT,'recovery_immutable') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.created_at!=OLD.created_at OR NOT((OLD.sealed=0 AND NEW.sealed=1 AND OLD.removed=0 AND NEW.removed=0) OR (OLD.sealed=1 AND NEW.sealed=1 AND OLD.removed=0 AND NEW.removed=1));
END;
DROP TRIGGER app_recovery_document_delete;
CREATE TRIGGER app_recovery_document_delete BEFORE DELETE ON app_recovery_documents WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=OLD.point_id AND removed=0) AND EXISTS(SELECT 1 FROM app_visitors WHERE id=OLD.visitor_id AND revoked=0) BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;
CREATE TRIGGER app_recovery_remove AFTER UPDATE OF removed ON app_recovery_points WHEN NEW.removed=1 BEGIN DELETE FROM app_recovery_documents WHERE point_id=NEW.id; END;
CREATE TRIGGER app_recovery_delete_guard BEFORE DELETE ON app_recovery_points BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;
CREATE TRIGGER app_restore_removed_admit BEFORE INSERT ON app_restore_reviews WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=NEW.point_id AND removed=1) BEGIN SELECT RAISE(ABORT,'recovery_removed'); END;
CREATE TRIGGER app_restore_removed_confirm BEFORE UPDATE ON app_restore_reviews WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=NEW.point_id AND removed=1) BEGIN SELECT RAISE(ABORT,'recovery_removed'); END;

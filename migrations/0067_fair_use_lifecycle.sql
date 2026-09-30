-- Minimal observation only: identifiers/timestamps, no prompts or source contents.
-- Project identity deliberately survives project deletion; account deletion removes it.
CREATE TABLE fair_use_project_lifecycle (
 project_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 observed_since TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ai_saved_at TEXT,
 export_prepared_at TEXT,
 removed_at TEXT
);
CREATE INDEX fair_use_lifecycle_owner_created ON fair_use_project_lifecycle(user_id,created_at);
INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at,ai_saved_at)
 SELECT p.id,p.owner_user_id,p.created_at,(SELECT MIN(v.created_at) FROM site_versions v JOIN chat_turns t ON t.id=v.id AND t.user_id=p.owner_user_id AND t.mode='ai' AND t.status='completed' WHERE v.project_id=p.id) FROM projects p;
CREATE TRIGGER fair_use_project_created AFTER INSERT ON projects BEGIN
 INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at) VALUES(NEW.id,NEW.owner_user_id,NEW.created_at);
END;
CREATE TRIGGER fair_use_ai_version AFTER INSERT ON site_versions WHEN EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.id AND t.mode='ai' AND t.status='completed') BEGIN
 UPDATE fair_use_project_lifecycle SET ai_saved_at=COALESCE(ai_saved_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER fair_use_ai_completed AFTER UPDATE OF status ON chat_turns WHEN NEW.mode='ai' AND NEW.status='completed' AND OLD.status!='completed' BEGIN
 UPDATE fair_use_project_lifecycle SET ai_saved_at=COALESCE(ai_saved_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id=NEW.user_id AND project_id IN (SELECT project_id FROM site_versions WHERE id=NEW.id);
END;
CREATE TRIGGER fair_use_project_removed AFTER DELETE ON projects BEGIN
 UPDATE fair_use_project_lifecycle SET removed_at=COALESCE(removed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=OLD.id AND user_id=OLD.owner_user_id;
END;
CREATE TRIGGER fair_use_lifecycle_immutable BEFORE UPDATE ON fair_use_project_lifecycle BEGIN
 SELECT RAISE(ABORT,'fair_use_identity') WHERE NEW.project_id!=OLD.project_id OR NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR NEW.observed_since!=OLD.observed_since;
 SELECT RAISE(ABORT,'fair_use_history') WHERE (OLD.ai_saved_at IS NOT NULL AND NEW.ai_saved_at IS NOT OLD.ai_saved_at) OR (OLD.export_prepared_at IS NOT NULL AND NEW.export_prepared_at IS NOT OLD.export_prepared_at) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NOT OLD.removed_at);
END;
-- Monitor mode is explicit and global. No production enforcement consumer exists yet.
CREATE TABLE fair_use_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 requested_mode TEXT NOT NULL DEFAULT 'monitor' CHECK(requested_mode IN ('monitor','enforce')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO fair_use_control(id) VALUES(1);

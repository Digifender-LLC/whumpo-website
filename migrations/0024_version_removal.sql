CREATE TABLE version_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL,digest TEXT NOT NULL,component_id TEXT NOT NULL,
 version_created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);
CREATE INDEX version_removals_version ON version_removals(version_id,status);
CREATE TRIGGER version_removal_identity BEFORE UPDATE ON version_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.digest!=OLD.digest OR NEW.component_id!=OLD.component_id OR NEW.version_created_at!=OLD.version_created_at OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'version_removal_immutable'); END;
CREATE TRIGGER version_removal_guard BEFORE UPDATE ON version_removals
BEGIN
 SELECT RAISE(ABORT,'version_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'version_removal_changed') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by WHERE v.id=NEW.version_id AND v.project_id=NEW.project_id AND v.digest=NEW.digest AND v.component_id=NEW.component_id AND v.created_at=NEW.version_created_at AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id);
END;
CREATE TRIGGER version_removal_apply AFTER UPDATE ON version_removals
BEGIN
 DELETE FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('version-removal:'||NEW.version_id,NEW.user_id,NEW.project_id,'site.version.removed','Removed saved version '||NEW.version_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- Recheck all references at the deletion, including ones added after review.
CREATE TRIGGER site_version_retained BEFORE DELETE ON site_versions
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN
 SELECT RAISE(ABORT,'version_removal_live') WHERE EXISTS(SELECT 1 FROM publications WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_publication') WHERE EXISTS(SELECT 1 FROM publication_actions WHERE version_id=OLD.id AND status='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'version_removal_backup') WHERE EXISTS(SELECT 1 FROM github_backups WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_unreviewed') WHERE NOT EXISTS(SELECT 1 FROM version_removals WHERE version_id=OLD.id AND project_id=OLD.project_id AND digest=OLD.digest AND status='applied');
END;
CREATE TRIGGER site_version_removed BEFORE INSERT ON site_versions
WHEN EXISTS(SELECT 1 FROM version_removals WHERE version_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'version_removal_replay'); END;

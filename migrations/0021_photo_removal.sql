CREATE TABLE photo_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL,
 name TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);
CREATE INDEX photo_removals_file ON photo_removals(file_id,status);
CREATE TRIGGER photo_removal_identity BEFORE UPDATE ON photo_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.file_id!=OLD.file_id OR NEW.name!=OLD.name OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'photo_removal_immutable'); END;
CREATE TRIGGER photo_removal_guard BEFORE UPDATE ON photo_removals
BEGIN
 SELECT RAISE(ABORT,'photo_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'photo_removal_changed') WHERE NOT EXISTS(SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by WHERE f.id=NEW.file_id AND f.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id);
END;
CREATE TRIGGER photo_removal_apply AFTER UPDATE ON photo_removals
BEGIN
 DELETE FROM project_files WHERE id=NEW.file_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('photo-removal:'||NEW.file_id,NEW.user_id,NEW.project_id,'file.removed','Removed an unused private project photo',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- Saved versions must retain their assets. Parent deletion may still cascade.
CREATE TRIGGER project_file_retained BEFORE DELETE ON project_files
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM version_photos WHERE file_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'photo_removal_referenced'); END;
-- Applied reviews are durable tombstones while the project exists.
CREATE TRIGGER project_file_removed BEFORE INSERT ON project_files
WHEN EXISTS(SELECT 1 FROM photo_removals WHERE file_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'photo_removal_replay'); END;
-- Queued objects still occupy storage until the cleanup job acknowledges deletion.
CREATE TRIGGER project_file_cleanup_capacity BEFORE INSERT ON project_files
WHEN NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.id)
 AND (SELECT COUNT(*) FROM project_files)+(SELECT COUNT(*) FROM file_cleanup)>=500
BEGIN SELECT RAISE(ABORT,'file_cleanup_quota'); END;

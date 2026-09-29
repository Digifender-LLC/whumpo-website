CREATE TABLE project_files (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 object_key TEXT NOT NULL UNIQUE,
 digest TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_at TEXT NOT NULL
);
CREATE INDEX project_files_project ON project_files(project_id,created_at);
CREATE TRIGGER project_file_quota BEFORE INSERT ON project_files
WHEN NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'file_project_quota') WHERE (SELECT COUNT(*) FROM project_files WHERE project_id=NEW.project_id)>=20;
 SELECT RAISE(ABORT,'file_account_quota') WHERE (SELECT COUNT(*) FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=50;
 SELECT RAISE(ABORT,'file_platform_quota') WHERE (SELECT COUNT(*) FROM project_files)>=500;
END;
CREATE TRIGGER project_file_immutable BEFORE UPDATE ON project_files
BEGIN
 SELECT RAISE(ABORT,'file_immutable') WHERE NEW.id!=OLD.id OR NEW.project_id!=OLD.project_id OR NEW.name!=OLD.name OR NEW.object_key!=OLD.object_key OR NEW.digest!=OLD.digest OR NEW.size!=OLD.size OR NEW.width!=OLD.width OR NEW.height!=OLD.height OR NEW.created_at!=OLD.created_at OR (OLD.status='ready' AND NEW.status!='ready');
END;
-- Deleted project/account rows leave a durable record for storage cleanup.
CREATE TABLE file_cleanup (object_key TEXT PRIMARY KEY,created_at TEXT NOT NULL);
CREATE TRIGGER project_file_cleanup AFTER DELETE ON project_files
BEGIN
 INSERT OR IGNORE INTO file_cleanup(object_key,created_at) VALUES(OLD.object_key,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

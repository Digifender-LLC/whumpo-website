-- Conservative private-test storage reservations; unresolved uploads retain capacity.
CREATE TABLE cms_media_uploads (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE RESTRICT,
 origin TEXT NOT NULL,
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 5 AND 100),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 size INTEGER NOT NULL CHECK(size BETWEEN 20 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 result TEXT CHECK(result IS NULL OR (json_valid(result) AND length(result)<=2048)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX cms_media_uploads_owner ON cms_media_uploads(user_id,created_at);
CREATE TRIGGER cms_media_upload_admit BEFORE INSERT ON cms_media_uploads BEGIN
 SELECT RAISE(ABORT,'cms_upload_owner') WHERE NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected' AND d.origin=NEW.origin);
 SELECT RAISE(ABORT,'cms_upload_initial') WHERE NEW.result IS NOT NULL;
 SELECT RAISE(ABORT,'cms_upload_quota') WHERE (SELECT count(*) FROM cms_media_uploads WHERE project_id=NEW.project_id)>=20 OR (SELECT count(*) FROM cms_media_uploads WHERE user_id=NEW.user_id)>=50 OR (SELECT count(*) FROM cms_media_uploads)>=500;
END;
CREATE TRIGGER cms_media_upload_storage AFTER INSERT ON cms_media_uploads BEGIN
 INSERT INTO storage_usage(period,write_ops) VALUES(strftime('%Y-%m','now'),2) ON CONFLICT(period) DO UPDATE SET write_ops=write_ops+2 WHERE write_ops+2<=10000;
 SELECT RAISE(ABORT,'cms_upload_storage') WHERE changes()=0;
END;
CREATE TRIGGER cms_media_upload_immutable BEFORE UPDATE ON cms_media_uploads BEGIN
 SELECT RAISE(ABORT,'cms_upload_identity') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.origin!=OLD.origin OR NEW.filename!=OLD.filename OR NEW.digest!=OLD.digest OR NEW.size!=OLD.size OR NEW.width!=OLD.width OR NEW.height!=OLD.height OR NEW.created_at!=OLD.created_at OR OLD.result IS NOT NULL OR NEW.result IS NULL;
END;
CREATE TRIGGER cms_media_upload_retained BEFORE DELETE ON cms_media_uploads WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_upload_retained'); END;

-- Private test-stage export retention. Pending outcomes retain their reservation.
CREATE TABLE cms_wordpress_sources (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 5 AND 100),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id,digest)
);
CREATE TRIGGER cms_wordpress_source_admit BEFORE INSERT ON cms_wordpress_sources WHEN NEW.state<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected') OR (SELECT count(*) FROM cms_wordpress_sources WHERE project_id=NEW.project_id)>=5 OR (SELECT count(*) FROM cms_wordpress_sources WHERE user_id=NEW.user_id)>=10 OR (SELECT count(*) FROM cms_wordpress_sources)>=50
 BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_unavailable'); END;
CREATE TRIGGER cms_wordpress_source_immutable BEFORE UPDATE ON cms_wordpress_sources WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.filename<>OLD.filename OR NEW.digest<>OLD.digest OR NEW.size<>OLD.size OR NEW.created_at<>OLD.created_at OR OLD.state<>'pending' OR NEW.state<>'ready'
 BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_immutable'); END;
CREATE TRIGGER cms_wordpress_source_retained BEFORE DELETE ON cms_wordpress_sources WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_retained'); END;
ALTER TABLE cms_import_reviews ADD COLUMN source_upload_id TEXT REFERENCES cms_wordpress_sources(id);
CREATE TRIGGER cms_import_source_admit BEFORE INSERT ON cms_import_reviews WHEN NEW.source_upload_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_wordpress_sources s WHERE s.id=NEW.source_upload_id AND s.user_id=NEW.user_id AND s.project_id=NEW.project_id AND s.digest=NEW.source_digest AND s.state='ready') BEGIN SELECT RAISE(ABORT,'cms_import_source_required'); END;
CREATE TRIGGER cms_import_source_immutable BEFORE UPDATE OF source_upload_id ON cms_import_reviews WHEN NEW.source_upload_id IS NOT OLD.source_upload_id BEGIN SELECT RAISE(ABORT,'cms_import_source_immutable'); END;

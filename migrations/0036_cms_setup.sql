CREATE TABLE cms_setup_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 tagline TEXT NOT NULL CHECK(length(tagline)<=200),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
);
CREATE INDEX cms_setup_reviews_owner ON cms_setup_reviews(user_id,created_at);
CREATE TRIGGER cms_setup_review_guard BEFORE INSERT ON cms_setup_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id) OR
 EXISTS(SELECT 1 FROM cms_instances WHERE project_id=NEW.project_id) OR (SELECT count(*) FROM cms_setup_reviews WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_setup_reviews)>=1000
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_unavailable'); END;
CREATE TABLE cms_instances (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL UNIQUE REFERENCES cms_setup_reviews(id),
 worker_name TEXT NOT NULL UNIQUE,
 database_name TEXT NOT NULL UNIQUE,
 bucket_name TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','provisioning','ready','uncertain')),
 database_id TEXT UNIQUE,
 session_namespace_id TEXT UNIQUE,
 deployed_version_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state<>'ready' OR (database_id IS NOT NULL AND session_namespace_id IS NOT NULL AND deployed_version_id IS NOT NULL))
);
CREATE INDEX cms_instances_owner ON cms_instances(user_id);
CREATE TRIGGER cms_instances_insert BEFORE INSERT ON cms_instances WHEN
 NEW.state<>'queued' OR NEW.database_id IS NOT NULL OR NEW.session_namespace_id IS NOT NULL OR NEW.deployed_version_id IS NOT NULL OR
 NEW.worker_name<>'townhello-cms-'||replace(NEW.project_id,'-','') OR NEW.database_name<>NEW.worker_name OR NEW.bucket_name<>NEW.worker_name||'-media' OR
 NOT EXISTS(SELECT 1 FROM cms_setup_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND r.status='approved') OR
 (SELECT count(*) FROM cms_instances)>=5 OR (SELECT count(*) FROM cms_instances WHERE user_id=NEW.user_id)>=2
 BEGIN SELECT RAISE(ABORT,'cms_instance_unavailable'); END;
CREATE TRIGGER cms_setup_review_identity BEFORE UPDATE ON cms_setup_reviews WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.title<>OLD.title OR NEW.tagline<>OLD.tagline OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'approved'
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_immutable'); END;
CREATE TRIGGER cms_setup_confirm_guard BEFORE UPDATE OF status ON cms_setup_reviews WHEN NEW.status='approved' AND (
 NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM cms_instances WHERE project_id=NEW.project_id))
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_stale'); END;
CREATE TRIGGER cms_setup_enqueue AFTER UPDATE OF status ON cms_setup_reviews WHEN NEW.status='approved' BEGIN
 INSERT INTO cms_instances(project_id,user_id,review_id,worker_name,database_name,bucket_name) VALUES(NEW.project_id,NEW.user_id,NEW.id,'townhello-cms-'||replace(NEW.project_id,'-',''),'townhello-cms-'||replace(NEW.project_id,'-',''),'townhello-cms-'||replace(NEW.project_id,'-','')||'-media');
END;
CREATE TRIGGER cms_instance_identity BEFORE UPDATE ON cms_instances WHEN NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.review_id<>OLD.review_id OR NEW.worker_name<>OLD.worker_name OR NEW.database_name<>OLD.database_name OR NEW.bucket_name<>OLD.bucket_name OR NEW.created_at<>OLD.created_at OR (OLD.database_id IS NOT NULL AND NEW.database_id IS NOT OLD.database_id) OR (OLD.session_namespace_id IS NOT NULL AND NEW.session_namespace_id IS NOT OLD.session_namespace_id)
 BEGIN SELECT RAISE(ABORT,'cms_instance_immutable'); END;

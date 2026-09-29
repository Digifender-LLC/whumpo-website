CREATE TABLE cms_resource_jobs (
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('database','media','session')),
 account_id TEXT NOT NULL CHECK(length(account_id)=32),
 resource_name TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
 provider_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(project_id,kind),
 UNIQUE(account_id,kind,provider_id),
 CHECK((state='pending' AND provider_id IS NULL) OR (state='complete' AND provider_id IS NOT NULL))
);
CREATE TRIGGER cms_resource_job_insert BEFORE INSERT ON cms_resource_jobs WHEN NEW.state<>'pending' OR NOT EXISTS(
 SELECT 1 FROM cms_instances c JOIN cms_setup_reviews r ON r.id=c.review_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND r.status='approved' AND p.owner_user_id=c.user_id AND c.state<>'ready' AND NEW.resource_name=CASE NEW.kind WHEN 'database' THEN c.database_name WHEN 'media' THEN c.bucket_name WHEN 'session' THEN c.worker_name||'-session' END
) BEGIN SELECT RAISE(ABORT,'cms_resource_not_approved'); END;
CREATE TRIGGER cms_resource_job_immutable BEFORE UPDATE ON cms_resource_jobs WHEN NEW.project_id<>OLD.project_id OR NEW.kind<>OLD.kind OR NEW.account_id<>OLD.account_id OR NEW.resource_name<>OLD.resource_name OR NEW.created_at<>OLD.created_at OR OLD.state<>'pending' OR NEW.state<>'complete'
 BEGIN SELECT RAISE(ABORT,'cms_resource_immutable'); END;
CREATE TRIGGER cms_resource_record AFTER UPDATE OF state ON cms_resource_jobs WHEN NEW.state='complete' BEGIN
 UPDATE cms_instances SET database_id=CASE WHEN NEW.kind='database' THEN NEW.provider_id ELSE database_id END,session_namespace_id=CASE WHEN NEW.kind='session' THEN NEW.provider_id ELSE session_namespace_id END WHERE project_id=NEW.project_id;
END;

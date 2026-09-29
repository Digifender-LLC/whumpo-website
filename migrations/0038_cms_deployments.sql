CREATE TABLE cms_deployments (
 project_id TEXT PRIMARY KEY REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 secret_digest TEXT NOT NULL CHECK(length(secret_digest)=64),
 origin TEXT NOT NULL UNIQUE,
 tag TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uploaded','verified','connected')),
 worker_version_id TEXT,
 platform_version_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((state='reserved' AND worker_version_id IS NULL AND platform_version_id IS NULL) OR (state IN ('uploaded','verified') AND worker_version_id IS NOT NULL AND platform_version_id IS NULL) OR (state='connected' AND worker_version_id IS NOT NULL AND platform_version_id IS NOT NULL))
);
CREATE TRIGGER cms_deployment_insert BEFORE INSERT ON cms_deployments WHEN NEW.state<>'reserved' OR NOT EXISTS(
 SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_setup_reviews r ON r.id=c.review_id WHERE c.project_id=NEW.project_id AND p.owner_user_id=c.user_id AND r.status='approved' AND c.state<>'ready' AND NEW.origin='https://'||c.worker_name||'.digifender.com' AND (SELECT count(*) FROM cms_resource_jobs j WHERE j.project_id=c.project_id AND j.account_id=NEW.account_id AND j.state='complete')=3
) BEGIN SELECT RAISE(ABORT,'cms_deployment_not_approved'); END;
CREATE TRIGGER cms_deployment_identity BEFORE UPDATE ON cms_deployments WHEN NEW.project_id<>OLD.project_id OR NEW.account_id<>OLD.account_id OR NEW.source_digest<>OLD.source_digest OR NEW.secret_digest<>OLD.secret_digest OR NEW.origin<>OLD.origin OR NEW.tag<>OLD.tag OR NEW.created_at<>OLD.created_at OR (OLD.worker_version_id IS NOT NULL AND NEW.worker_version_id IS NOT OLD.worker_version_id) OR NOT ((OLD.state='reserved' AND NEW.state='uploaded') OR (OLD.state='uploaded' AND NEW.state='verified') OR (OLD.state='verified' AND NEW.state='connected'))
 BEGIN SELECT RAISE(ABORT,'cms_deployment_immutable'); END;
CREATE TRIGGER cms_deployment_connected AFTER UPDATE OF state ON cms_deployments WHEN NEW.state='connected' BEGIN
 UPDATE cms_instances SET state='ready',deployed_version_id=NEW.worker_version_id WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER cms_ready_guard BEFORE UPDATE OF state ON cms_instances WHEN NEW.state='ready' AND NOT EXISTS(SELECT 1 FROM cms_deployments d WHERE d.project_id=NEW.project_id AND d.state='connected' AND d.worker_version_id=NEW.deployed_version_id)
 BEGIN SELECT RAISE(ABORT,'cms_readiness_not_verified'); END;
CREATE TABLE cms_platform_deploy_lock (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at TEXT NOT NULL);
INSERT INTO cms_platform_deploy_lock VALUES(1,'','2000-01-01T00:00:00.000Z');

CREATE TABLE backend_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(length(CAST(source AS BLOB)) BETWEEN 1 AND 8192),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 created_at TEXT NOT NULL
);
CREATE INDEX backend_versions_project ON backend_versions(project_id,created_at);
CREATE TRIGGER backend_versions_immutable BEFORE UPDATE ON backend_versions BEGIN SELECT RAISE(ABORT,'backend_immutable'); END;
CREATE TRIGGER backend_versions_quota BEFORE INSERT ON backend_versions WHEN
 (SELECT count(*) FROM backend_versions WHERE project_id=NEW.project_id)>=25 OR (SELECT count(*) FROM backend_versions)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_version_quota'); END;
CREATE TABLE backend_runs (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES backend_versions(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 day TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','complete')),
 result_json TEXT CHECK(result_json IS NULL OR length(CAST(result_json AS BLOB))<=18000),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((state='running' AND result_json IS NULL) OR (state='complete' AND result_json IS NOT NULL))
);
CREATE INDEX backend_runs_user_day ON backend_runs(user_id,day);
CREATE INDEX backend_runs_project_day ON backend_runs(project_id,day);
CREATE INDEX backend_runs_day ON backend_runs(day);
CREATE TRIGGER backend_runs_authority BEFORE INSERT ON backend_runs WHEN NOT EXISTS (
 SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id
) BEGIN SELECT RAISE(ABORT,'backend_owner'); END;
CREATE TRIGGER backend_runs_quota BEFORE INSERT ON backend_runs WHEN
 NEW.day<>strftime('%Y-%m-%d','now') OR (SELECT count(*) FROM backend_runs)>=5000 OR
 (SELECT count(*) FROM backend_runs WHERE project_id=NEW.project_id AND day=NEW.day)>=20 OR
 (SELECT count(*) FROM backend_runs WHERE user_id=NEW.user_id AND day=NEW.day)>=100 OR
 (SELECT count(*) FROM backend_runs WHERE day=NEW.day)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_run_quota'); END;
CREATE TRIGGER backend_runs_identity BEFORE UPDATE ON backend_runs WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.request_hash<>OLD.request_hash OR NEW.day<>OLD.day OR NEW.created_at<>OLD.created_at OR OLD.state='complete'
 BEGIN SELECT RAISE(ABORT,'backend_run_immutable'); END;

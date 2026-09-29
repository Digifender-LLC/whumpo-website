-- Internal application storage foundation. No public enrollment or activation route.
CREATE TABLE app_spaces (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE TRIGGER app_space_owner BEFORE INSERT ON app_spaces WHEN NOT EXISTS(SELECT 1 FROM projects p JOIN backend_versions v ON v.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.owner_user_id AND v.id=NEW.version_id)
 BEGIN SELECT RAISE(ABORT,'app_space_owner'); END;
CREATE TRIGGER app_space_update BEFORE UPDATE ON app_spaces WHEN NEW.project_id<>OLD.project_id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.version_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'app_space_identity'); END;
CREATE TABLE app_visitors (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX app_visitors_project ON app_visitors(project_id);
CREATE TRIGGER app_visitor_admit BEFORE INSERT ON app_visitors BEGIN
 SELECT RAISE(ABORT,'app_unavailable') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.enabled=1);
 SELECT RAISE(ABORT,'app_visitor_capacity') WHERE (SELECT count(*) FROM app_visitors WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_visitors)>=1000;
END;
CREATE TRIGGER app_visitor_identity BEFORE UPDATE ON app_visitors WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.created_at<>OLD.created_at OR OLD.revoked=1 AND NEW.revoked<>1
 BEGIN SELECT RAISE(ABORT,'app_visitor_identity'); END;
CREATE TABLE app_sessions (
 token_hash TEXT PRIMARY KEY,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);
CREATE INDEX app_sessions_visitor ON app_sessions(visitor_id);
CREATE TRIGGER app_session_admit BEFORE INSERT ON app_sessions BEGIN
 SELECT RAISE(ABORT,'app_session_identity') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE v.id=NEW.visitor_id AND v.revoked=0 AND a.enabled=1);
 SELECT RAISE(ABORT,'app_session_capacity') WHERE (SELECT count(*) FROM app_sessions WHERE visitor_id=NEW.visitor_id)>=5 OR (SELECT count(*) FROM app_sessions)>=5000;
END;
CREATE TRIGGER app_session_immutable BEFORE UPDATE ON app_sessions BEGIN SELECT RAISE(ABORT,'app_session_immutable'); END;
CREATE TABLE app_documents (
 visitor_id TEXT PRIMARY KEY REFERENCES app_visitors(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096)
);
CREATE TRIGGER app_document_revision BEFORE UPDATE ON app_documents WHEN NEW.visitor_id<>OLD.visitor_id OR NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'app_document_revision'); END;
CREATE TRIGGER app_visitor_document AFTER INSERT ON app_visitors BEGIN INSERT INTO app_documents(visitor_id) VALUES(NEW.id); END;
CREATE TABLE app_runs (
 id TEXT PRIMARY KEY,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 session_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 base_revision INTEGER NOT NULL,
 program_revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','complete','failed','conflict')),
 result_json TEXT CHECK(result_json IS NULL OR length(CAST(result_json AS BLOB))<=4608),
 next_json TEXT CHECK(next_json IS NULL OR json_valid(next_json) AND length(CAST(next_json AS BLOB))<=4096),
 day TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
 CHECK((state='running' AND result_json IS NULL AND next_json IS NULL) OR (state='complete' AND result_json IS NOT NULL AND next_json IS NOT NULL) OR (state IN ('failed','conflict') AND result_json IS NOT NULL AND next_json IS NULL))
);
CREATE INDEX app_runs_visitor_day ON app_runs(visitor_id,day);
CREATE INDEX app_runs_project_day ON app_runs(project_id,day);
CREATE INDEX app_runs_day ON app_runs(day);
CREATE UNIQUE INDEX app_runs_applied_revision ON app_runs(visitor_id,base_revision) WHERE state='complete';
CREATE TRIGGER app_run_admit BEFORE INSERT ON app_runs BEGIN
 SELECT RAISE(ABORT,'app_run_identity') WHERE NEW.state<>'running' OR NOT EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=0 AND a.enabled=1 AND a.version_id=NEW.version_id AND a.revision=NEW.program_revision AND d.revision=NEW.base_revision AND s.token_hash=NEW.session_hash AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'app_run_quota') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR (SELECT count(*) FROM app_runs)>=10000 OR (SELECT count(*) FROM app_runs WHERE visitor_id=NEW.visitor_id AND day=NEW.day)>=20 OR (SELECT count(*) FROM app_runs WHERE project_id=NEW.project_id AND day=NEW.day)>=100 OR (SELECT count(*) FROM app_runs WHERE day=NEW.day)>=1000;
END;
CREATE TRIGGER app_run_immutable BEFORE UPDATE ON app_runs WHEN NEW.id<>OLD.id OR NEW.visitor_id<>OLD.visitor_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.session_hash<>OLD.session_hash OR NEW.request_hash<>OLD.request_hash OR NEW.base_revision<>OLD.base_revision OR NEW.program_revision<>OLD.program_revision OR NEW.day<>OLD.day OR OLD.state<>'running' OR NEW.state='running'
 BEGIN SELECT RAISE(ABORT,'app_run_immutable'); END;
CREATE TRIGGER app_run_apply BEFORE UPDATE OF state ON app_runs WHEN NEW.state='complete' BEGIN
 SELECT RAISE(ABORT,'app_state_changed') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=0 AND a.enabled=1 AND a.version_id=NEW.version_id AND a.revision=NEW.program_revision AND d.revision=NEW.base_revision AND s.token_hash=NEW.session_hash AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 UPDATE app_documents SET state_json=NEW.next_json,revision=revision+1 WHERE visitor_id=NEW.visitor_id;
END;

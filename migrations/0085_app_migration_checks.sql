-- Private staged migrations. No activation/apply authority is introduced here.
CREATE TABLE app_migration_checks (
 id TEXT PRIMARY KEY REFERENCES app_recovery_points(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 from_version TEXT NOT NULL REFERENCES backend_versions(id),
 to_version TEXT NOT NULL REFERENCES backend_versions(id),
 transform_version TEXT NOT NULL REFERENCES backend_versions(id),
 test_id TEXT NOT NULL REFERENCES backend_runs(id),
 base_revision INTEGER NOT NULL,
 roster_json TEXT NOT NULL CHECK(json_valid(roster_json) AND json_type(roster_json)='array' AND json_array_length(roster_json)<=100 AND length(CAST(roster_json AS BLOB))<=12000),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 minutes'))
);
CREATE INDEX app_migration_checks_project ON app_migration_checks(project_id);
CREATE TABLE app_migration_documents (
 migration_id TEXT NOT NULL REFERENCES app_migration_checks(id),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 base_revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','failed')),
 next_json TEXT CHECK(next_json IS NULL OR (json_valid(next_json) AND length(CAST(next_json AS BLOB))<=4096)),
 error TEXT CHECK(error IS NULL OR error IN ('invalid_output','invalid_request','invalid_code','execution_failed','work_limit','unresolved_promise','unavailable','busy')),
 PRIMARY KEY(migration_id,visitor_id),
 CHECK((state IN ('pending','running') AND next_json IS NULL AND error IS NULL) OR (state='ready' AND next_json IS NOT NULL AND error IS NULL) OR (state='failed' AND next_json IS NULL AND error IS NOT NULL))
);
CREATE VIEW app_migration_current AS SELECT m.id FROM app_migration_checks m
 JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id
 JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id
 JOIN app_recovery_points b ON b.id=m.id AND b.project_id=m.project_id AND b.user_id=m.user_id AND b.version_id=m.from_version AND b.removed=0 AND b.sealed=1
 JOIN app_recovery_rosters roster ON roster.project_id=m.project_id
 WHERE a.enabled=0 AND a.version_id=m.from_version AND a.revision=m.base_revision AND roster.roster_json=m.roster_json AND m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM json_each(m.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=m.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.revision=json_extract(entry.value,'$.revision')));
CREATE TRIGGER app_migration_check_admit BEFORE INSERT ON app_migration_checks BEGIN
 SELECT RAISE(ABORT,'migration_authority') WHERE NEW.to_version=NEW.from_version OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points b ON b.id=NEW.id AND b.user_id=a.owner_user_id AND b.project_id=a.project_id AND b.version_id=a.version_id AND b.removed=0 AND b.sealed=1 JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.version_id=NEW.from_version AND a.revision=NEW.base_revision AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'migration_version') WHERE NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.to_version AND project_id=NEW.project_id) OR NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.transform_version AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'migration_test') WHERE NOT EXISTS(SELECT 1 FROM backend_runs r WHERE r.id=NEW.test_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.to_version AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1 AND json_extract(r.result_json,'$.check.status')='passed' AND json_type(r.result_json,'$.value')='object' AND (SELECT count(*) FROM json_each(r.result_json,'$.value'))=2 AND json_type(r.result_json,'$.value.state') IS NOT NULL AND json_type(r.result_json,'$.value.result') IS NOT NULL AND length(CAST(json_quote(json_extract(r.result_json,'$.value.state')) AS BLOB))<=4096 AND length(CAST(json_quote(json_extract(r.result_json,'$.value.result')) AS BLOB))<=4096);
 SELECT RAISE(ABORT,'migration_capacity') WHERE (SELECT count(*) FROM app_migration_checks WHERE project_id=NEW.project_id)>=5 OR (SELECT count(*) FROM app_migration_checks)>=50;
END;
CREATE TRIGGER app_migration_check_capture AFTER INSERT ON app_migration_checks BEGIN
 INSERT INTO app_migration_documents(migration_id,visitor_id,base_revision) SELECT NEW.id,visitor_id,revision FROM app_recovery_documents WHERE point_id=NEW.id;
END;
CREATE TRIGGER app_migration_check_immutable BEFORE UPDATE ON app_migration_checks BEGIN SELECT RAISE(ABORT,'migration_immutable'); END;
CREATE TRIGGER app_migration_check_delete BEFORE DELETE ON app_migration_checks BEGIN SELECT RAISE(ABORT,'migration_immutable'); END;
CREATE TRIGGER app_migration_document_admit BEFORE INSERT ON app_migration_documents BEGIN
 SELECT RAISE(ABORT,'migration_document') WHERE NEW.state!='pending' OR NOT EXISTS(SELECT 1 FROM app_migration_current m JOIN app_recovery_documents d ON d.point_id=m.id WHERE m.id=NEW.migration_id AND d.visitor_id=NEW.visitor_id AND d.revision=NEW.base_revision);
END;
CREATE TRIGGER app_migration_document_update BEFORE UPDATE ON app_migration_documents BEGIN
 SELECT RAISE(ABORT,'migration_immutable') WHERE NEW.migration_id!=OLD.migration_id OR NEW.visitor_id!=OLD.visitor_id OR NEW.base_revision!=OLD.base_revision OR NOT((OLD.state='pending' AND NEW.state='running') OR (OLD.state='running' AND NEW.state IN ('ready','failed')));
 SELECT RAISE(ABORT,'migration_stale') WHERE NOT EXISTS(SELECT 1 FROM app_migration_current WHERE id=NEW.migration_id);
END;
CREATE TRIGGER app_migration_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN DELETE FROM app_migration_documents WHERE visitor_id=NEW.id; END;
CREATE TRIGGER app_migration_point_remove AFTER UPDATE OF removed ON app_recovery_points WHEN NEW.removed=1 BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;

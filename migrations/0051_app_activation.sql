ALTER TABLE app_spaces ADD COLUMN review_id TEXT;
CREATE TABLE app_activation_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 run_id TEXT REFERENCES backend_runs(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((enabled=1 AND run_id IS NOT NULL) OR (enabled=0 AND run_id IS NULL))
);
CREATE INDEX app_activation_project ON app_activation_reviews(project_id);
CREATE TRIGGER app_activation_admit BEFORE INSERT ON app_activation_reviews BEGIN
 SELECT RAISE(ABORT,'app_activation_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN backend_versions v ON v.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND a.revision=NEW.base_revision AND v.id=NEW.version_id);
 SELECT RAISE(ABORT,'app_activation_test') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM backend_runs r WHERE r.id=NEW.run_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1 AND json_type(r.result_json,'$.value')='object' AND (SELECT count(*) FROM json_each(r.result_json,'$.value'))=2 AND json_type(r.result_json,'$.value.state') IS NOT NULL AND json_type(r.result_json,'$.value.result') IS NOT NULL AND length(CAST(json_quote(json_extract(r.result_json,'$.value.state')) AS BLOB))<=4096 AND length(CAST(json_quote(json_extract(r.result_json,'$.value.result')) AS BLOB))<=4096);
 SELECT RAISE(ABORT,'app_activation_capacity') WHERE (SELECT count(*) FROM app_activation_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_activation_reviews)>=1000;
 SELECT RAISE(ABORT,'app_activation_initial') WHERE NEW.status<>'pending';
END;
CREATE TRIGGER app_activation_immutable BEFORE UPDATE ON app_activation_reviews WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.version_id<>OLD.version_id OR NEW.run_id IS NOT OLD.run_id OR NEW.enabled<>OLD.enabled OR NEW.base_revision<>OLD.base_revision OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'app_activation_immutable'); END;
CREATE TRIGGER app_space_initial_review BEFORE INSERT ON app_spaces WHEN NEW.enabled<>0 OR NEW.review_id IS NOT NULL OR NEW.revision<>0
 BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;
CREATE TRIGGER app_space_apply_review BEFORE UPDATE ON app_spaces WHEN NOT EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.owner_user_id AND r.version_id=NEW.version_id AND r.enabled=NEW.enabled AND r.base_revision=OLD.revision AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;
CREATE TRIGGER app_activation_apply BEFORE UPDATE OF status ON app_activation_reviews BEGIN
 SELECT RAISE(ABORT,'app_activation_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.base_revision);
 SELECT RAISE(ABORT,'app_migration_required') WHERE NEW.enabled=1 AND EXISTS(SELECT 1 FROM app_spaces a JOIN app_visitors v ON v.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id<>NEW.version_id);
 SELECT RAISE(ABORT,'app_disable_version') WHERE NEW.enabled=0 AND NOT EXISTS(SELECT 1 FROM app_spaces WHERE project_id=NEW.project_id AND version_id=NEW.version_id);
 UPDATE app_spaces SET enabled=NEW.enabled,version_id=NEW.version_id,revision=revision+1,review_id=NEW.id WHERE project_id=NEW.project_id;
 DELETE FROM app_sessions WHERE NEW.enabled=0 AND visitor_id IN(SELECT id FROM app_visitors WHERE project_id=NEW.project_id);
END;

CREATE TRIGGER app_activation_delete_guard BEFORE DELETE ON app_activation_reviews WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) BEGIN SELECT RAISE(ABORT,'app_activation_immutable'); END;

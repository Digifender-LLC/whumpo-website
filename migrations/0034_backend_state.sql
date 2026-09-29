-- The guest receives JSON only; this host-owned store is changed by reviewed CAS.
CREATE TABLE backend_state (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096)
);
CREATE TABLE backend_state_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 base_revision INTEGER NOT NULL,
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 input_json TEXT NOT NULL CHECK(json_valid(input_json) AND length(CAST(input_json AS BLOB))<=4096),
 after_json TEXT CHECK(after_json IS NULL OR (json_valid(after_json) AND length(CAST(after_json AS BLOB))<=4096)),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=4096)),
 status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','ready','applied','failed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((status IN ('preparing','failed') AND after_json IS NULL AND result_json IS NULL) OR (status IN ('ready','applied') AND after_json IS NOT NULL AND result_json IS NOT NULL))
);
CREATE INDEX backend_state_reviews_project ON backend_state_reviews(project_id,created_at);
CREATE TRIGGER backend_state_review_insert BEFORE INSERT ON backend_state_reviews WHEN
 NEW.status<>'preparing' OR NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id JOIN backend_state s ON s.project_id=p.id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision AND s.state_json=NEW.before_json) OR
 (SELECT count(*) FROM backend_state_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM backend_state_reviews)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_state_review_unavailable'); END;
CREATE TRIGGER backend_state_review_identity BEFORE UPDATE ON backend_state_reviews WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.base_revision<>OLD.base_revision OR NEW.before_json<>OLD.before_json OR NEW.input_json<>OLD.input_json OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR
 NOT ((OLD.status='preparing' AND NEW.status IN ('ready','failed')) OR (OLD.status='ready' AND NEW.status='applied' AND NEW.after_json IS OLD.after_json AND NEW.result_json IS OLD.result_json))
 BEGIN SELECT RAISE(ABORT,'backend_state_review_immutable'); END;
CREATE TRIGGER backend_state_confirm_guard BEFORE UPDATE OF status ON backend_state_reviews WHEN NEW.status='applied' AND (
 NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM backend_state s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision AND s.state_json=NEW.before_json))
 BEGIN SELECT RAISE(ABORT,'backend_state_review_stale'); END;
CREATE TRIGGER backend_state_apply AFTER UPDATE OF status ON backend_state_reviews WHEN NEW.status='applied' BEGIN
 UPDATE backend_state SET state_json=NEW.after_json,revision=NEW.base_revision+1 WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER backend_state_initial BEFORE INSERT ON backend_state WHEN NEW.revision<>0 OR NEW.state_json<>'{}' BEGIN SELECT RAISE(ABORT,'backend_state_initial'); END;
CREATE TRIGGER backend_state_guard BEFORE UPDATE ON backend_state WHEN NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(
 SELECT 1 FROM backend_state_reviews WHERE project_id=OLD.project_id AND status='applied' AND base_revision=OLD.revision AND before_json=OLD.state_json AND after_json=NEW.state_json
) BEGIN SELECT RAISE(ABORT,'backend_state_review_required'); END;

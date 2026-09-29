CREATE TABLE app_page_settings (
 project_id TEXT PRIMARY KEY REFERENCES app_spaces(project_id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 review_id TEXT
);
CREATE TABLE app_page_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 program_revision INTEGER NOT NULL CHECK(program_revision>=0),
 base_revision INTEGER NOT NULL CHECK(base_revision>=0),
 config_json TEXT CHECK(config_json IS NULL OR json_valid(config_json) AND length(CAST(config_json AS BLOB))<=4096),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
);
CREATE INDEX app_page_reviews_project ON app_page_reviews(project_id);
CREATE TRIGGER app_page_admit BEFORE INSERT ON app_page_reviews BEGIN
 SELECT RAISE(ABORT,'app_page_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_page_settings s ON s.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.program_revision AND s.revision=NEW.base_revision AND (NEW.config_json IS NULL OR a.enabled=1));
 SELECT RAISE(ABORT,'app_page_capacity') WHERE (SELECT count(*) FROM app_page_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_page_reviews)>=1000;
 SELECT RAISE(ABORT,'app_page_initial') WHERE NEW.status<>'pending';
END;
CREATE TRIGGER app_page_immutable BEFORE UPDATE ON app_page_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.program_revision<>OLD.program_revision OR NEW.base_revision<>OLD.base_revision OR NEW.config_json IS NOT OLD.config_json OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'app_page_immutable'); END;
CREATE TRIGGER app_page_apply AFTER UPDATE OF status ON app_page_reviews BEGIN
 SELECT RAISE(ABORT,'app_page_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_page_settings s ON s.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.program_revision AND s.revision=NEW.base_revision AND (NEW.config_json IS NULL OR a.enabled=1));
 UPDATE app_page_settings SET revision=revision+1,review_id=NEW.id WHERE project_id=NEW.project_id;
 DELETE FROM app_sessions WHERE visitor_id IN(SELECT id FROM app_visitors WHERE project_id=NEW.project_id);
 DELETE FROM app_auth_challenges WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER app_page_settings_initial BEFORE INSERT ON app_page_settings WHEN NEW.revision<>0 OR NEW.review_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'app_page_initial'); END;
CREATE TRIGGER app_page_settings_guard BEFORE UPDATE ON app_page_settings WHEN NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM app_page_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.base_revision=OLD.revision AND r.status='applied')
 BEGIN SELECT RAISE(ABORT,'app_page_settings'); END;
CREATE VIEW app_live_pages AS
 SELECT r.id,r.project_id,r.config_json,r.program_revision,s.revision
 FROM app_page_settings s JOIN app_page_reviews r ON r.id=s.review_id JOIN app_spaces a ON a.project_id=s.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id
 WHERE r.status='applied' AND r.config_json IS NOT NULL AND a.enabled=1 AND a.owner_user_id=r.user_id AND a.revision=r.program_revision;
ALTER TABLE app_auth_challenges ADD COLUMN page_review_id TEXT REFERENCES app_page_reviews(id);
ALTER TABLE app_sessions ADD COLUMN page_review_id TEXT REFERENCES app_page_reviews(id);
CREATE TRIGGER app_challenge_page BEFORE INSERT ON app_auth_challenges WHEN NEW.page_review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_live_pages WHERE id=NEW.page_review_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'app_page_changed'); END;
CREATE TRIGGER app_session_page BEFORE INSERT ON app_sessions WHEN NEW.page_review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_live_pages p JOIN app_visitors v ON v.project_id=p.project_id WHERE p.id=NEW.page_review_id AND v.id=NEW.visitor_id)
 BEGIN SELECT RAISE(ABORT,'app_page_changed'); END;

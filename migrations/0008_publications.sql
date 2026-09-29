CREATE TABLE publications (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 version_id TEXT REFERENCES site_versions(id) ON DELETE SET NULL
);
CREATE TABLE publication_actions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('publish','restore','unpublish')),
 version_id TEXT REFERENCES site_versions(id) ON DELETE CASCADE,
 expected_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE,
 CHECK((kind = 'unpublish' AND version_id IS NULL) OR (kind != 'unpublish' AND version_id IS NOT NULL))
);
CREATE INDEX publication_actions_owner ON publication_actions(user_id,project_id);
CREATE TRIGGER publication_action_identity BEFORE UPDATE ON publication_actions
WHEN NEW.id != OLD.id OR NEW.user_id != OLD.user_id OR NEW.project_id != OLD.project_id OR NEW.kind != OLD.kind OR NEW.version_id IS NOT OLD.version_id OR NEW.expected_revision != OLD.expected_revision OR NEW.expires_at != OLD.expires_at OR OLD.status != 'pending' OR NEW.status != 'applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'publication_action_immutable'); END;
CREATE TRIGGER publication_confirm_guard BEFORE UPDATE ON publication_actions
BEGIN
 SELECT RAISE(ABORT,'publication_expired') WHERE NEW.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'publication_version') WHERE NEW.kind != 'unpublish' AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'published_site_quota') WHERE NEW.kind != 'unpublish' AND (SELECT COUNT(*) FROM publications s JOIN projects p ON p.id=s.project_id WHERE p.owner_user_id=NEW.user_id AND s.version_id IS NOT NULL AND s.project_id != NEW.project_id) >= COALESCE((SELECT CASE plan_id WHEN 'studio' THEN 10 WHEN 'launch' THEN 3 ELSE 1 END FROM billing_accounts WHERE user_id=NEW.user_id),1);
END;
CREATE TRIGGER publication_apply AFTER UPDATE ON publication_actions
BEGIN
 UPDATE publications SET version_id=NEW.version_id,revision=revision+1 WHERE project_id=NEW.project_id;
 UPDATE projects SET status=CASE WHEN NEW.version_id IS NULL THEN 'draft' ELSE 'live' END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('publication:'||NEW.id,NEW.user_id,NEW.project_id,'site.'||NEW.kind,CASE WHEN NEW.kind='unpublish' THEN 'Unpublished site' WHEN NEW.kind='restore' THEN 'Restored published site version' ELSE 'Published site version' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

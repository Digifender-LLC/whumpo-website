-- A private build binds one chat request to exact source and synthetic check.
CREATE TABLE application_builds (
 id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64)
);
CREATE INDEX application_builds_owner ON application_builds(user_id,project_id);
CREATE TRIGGER application_build_admit BEFORE INSERT ON application_builds BEGIN
 SELECT RAISE(ABORT,'application_build_owner') WHERE NOT EXISTS(
  SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.status='pending'
  WHERE v.id=NEW.id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id
 );
 SELECT RAISE(ABORT,'application_build_migration') WHERE EXISTS(SELECT 1 FROM app_visitors WHERE project_id=NEW.project_id);
END;
CREATE TRIGGER application_build_immutable BEFORE UPDATE ON application_builds
 BEGIN SELECT RAISE(ABORT,'application_build_immutable'); END;

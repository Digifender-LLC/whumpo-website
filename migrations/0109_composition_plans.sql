-- Private owner-maintainer planning evidence. A plan grants no execution/publication authority.
ALTER TABLE projects ADD COLUMN backend_revision INTEGER NOT NULL DEFAULT 0 CHECK(backend_revision>=0);
CREATE TRIGGER composition_backend_added AFTER INSERT ON backend_versions BEGIN UPDATE projects SET backend_revision=backend_revision+1 WHERE id=NEW.project_id; END;
CREATE TRIGGER composition_backend_removed AFTER DELETE ON backend_versions BEGIN UPDATE projects SET backend_revision=backend_revision+1 WHERE id=OLD.project_id; END;
CREATE TABLE composition_plans (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 catalog_digest TEXT NOT NULL CHECK(length(catalog_digest)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(CAST(plan_json AS BLOB))<=16000),
 details_revision INTEGER NOT NULL CHECK(details_revision>=0),
 backend_count INTEGER NOT NULL CHECK(backend_count>=0),
 backend_revision INTEGER NOT NULL CHECK(backend_revision>=0),
 extension_scope TEXT NOT NULL CHECK(extension_scope IN ('none','pure-function','visitor-transition')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX composition_plans_owner ON composition_plans(user_id,project_id);
CREATE TRIGGER composition_plan_admit BEFORE INSERT ON composition_plans BEGIN
 SELECT RAISE(ABORT,'composition_plan_owner') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.status='pending' AND t.mode='ai'
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.details_revision=NEW.details_revision
  AND p.backend_revision=NEW.backend_revision AND (SELECT count(*) FROM backend_versions WHERE project_id=p.id)=NEW.backend_count
 );
 SELECT RAISE(ABORT,'composition_plan_quota') WHERE
  (SELECT count(*) FROM composition_plans WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM composition_plans)>=5000;
END;
CREATE TRIGGER composition_plan_immutable BEFORE UPDATE ON composition_plans BEGIN SELECT RAISE(ABORT,'composition_plan_immutable'); END;

CREATE TABLE backend_extension_uses (
 version_id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL UNIQUE REFERENCES composition_plans(id)
);
CREATE TRIGGER backend_extension_admit BEFORE INSERT ON backend_extension_uses BEGIN
 SELECT RAISE(ABORT,'composition_plan_changed') WHERE NOT EXISTS(
  SELECT 1 FROM composition_plans c JOIN projects p ON p.id=c.project_id AND p.owner_user_id=c.user_id
  JOIN backend_versions v ON v.id=NEW.version_id AND v.project_id=p.id
  JOIN chat_turns t ON t.id=v.id AND t.user_id=c.user_id AND t.status='pending' AND t.mode='ai'
  WHERE c.id=NEW.plan_id AND c.extension_scope!='none' AND c.expires_at>unixepoch()
  AND p.details_revision=c.details_revision AND p.backend_revision=c.backend_revision+1
  AND (SELECT count(*) FROM backend_versions WHERE project_id=p.id AND id!=v.id)=c.backend_count
 );
END;
CREATE TRIGGER backend_extension_immutable BEFORE UPDATE ON backend_extension_uses BEGIN SELECT RAISE(ABORT,'composition_plan_immutable'); END;
CREATE TRIGGER backend_extension_retain BEFORE DELETE ON backend_extension_uses WHEN EXISTS(SELECT 1 FROM backend_versions WHERE id=OLD.version_id)
 BEGIN SELECT RAISE(ABORT,'composition_plan_retained'); END;

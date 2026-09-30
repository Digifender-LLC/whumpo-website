-- Imported source is intentionally separate from executable backend_versions.
CREATE TABLE backend_imports (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(length(CAST(source AS BLOB)) BETWEEN 1 AND 8192),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','requires_review','blocked')),
 reason TEXT CHECK(reason IN ('scanner_required','integrity','credential','dynamic_code','remote_dependency')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 scanned_at TEXT,
 CHECK((state='pending' AND reason IS NULL AND scanned_at IS NULL) OR
       (state='requires_review' AND reason='scanner_required' AND scanned_at IS NOT NULL) OR
       (state='blocked' AND reason IN ('integrity','credential','dynamic_code','remote_dependency') AND scanned_at IS NOT NULL))
);
CREATE INDEX backend_imports_pending ON backend_imports(state,created_at,id);
CREATE INDEX backend_imports_owner ON backend_imports(user_id,project_id,created_at);
CREATE TRIGGER backend_import_owner BEFORE INSERT ON backend_imports WHEN NOT EXISTS(
 SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id
) OR EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.id) OR NEW.state!='pending'
 BEGIN SELECT RAISE(ABORT,'backend_import_owner'); END;
CREATE TRIGGER backend_import_quota BEFORE INSERT ON backend_imports WHEN
 (SELECT count(*) FROM backend_imports WHERE project_id=NEW.project_id)>=25 OR
 (SELECT count(*) FROM backend_imports WHERE user_id=NEW.user_id)>=100 OR
 (SELECT count(*) FROM backend_imports)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_import_quota'); END;
CREATE TRIGGER backend_import_immutable BEFORE UPDATE ON backend_imports WHEN
 NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR
 NEW.source!=OLD.source OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR
 NEW.created_at!=OLD.created_at OR OLD.state!='pending' OR NEW.state='pending'
 BEGIN SELECT RAISE(ABORT,'backend_import_immutable'); END;
-- No approval or promotion capability exists yet. IDs cannot bypass quarantine
-- through an alternate version-creation route, including generated drafts.
CREATE TRIGGER backend_import_not_executable BEFORE INSERT ON backend_versions WHEN
 EXISTS(SELECT 1 FROM backend_imports WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'backend_import_quarantined'); END;

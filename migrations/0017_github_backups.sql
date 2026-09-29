CREATE TABLE github_backups (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 token_id TEXT REFERENCES github_token_vault(id) ON DELETE SET NULL,
 github_user_id TEXT NOT NULL,
 repo_id INTEGER NOT NULL,
 repo_owner TEXT NOT NULL,
 repo_name TEXT NOT NULL,
 repo_private INTEGER NOT NULL CHECK(repo_private IN (0,1)),
 branch TEXT NOT NULL,
 path TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 tree_sha TEXT NOT NULL,
 base_head TEXT NOT NULL,
 files_json TEXT NOT NULL CHECK(length(files_json)<=4096),
 byte_length INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','uncertain','complete','failed')),
 commit_sha TEXT,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 dispatched_at TEXT
);
CREATE INDEX github_backups_user ON github_backups(user_id,created_at DESC);
CREATE TRIGGER github_backup_owner BEFORE INSERT ON github_backups
BEGIN
 SELECT RAISE(ABORT,'github_backup_owner') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'github_backup_quota') WHERE (SELECT COUNT(*) FROM github_backups WHERE user_id=NEW.user_id)>=100;
END;
CREATE TRIGGER github_backup_identity BEFORE UPDATE ON github_backups
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.request_hash!=OLD.request_hash OR NEW.github_user_id!=OLD.github_user_id OR NEW.repo_id!=OLD.repo_id OR NEW.repo_owner!=OLD.repo_owner OR NEW.repo_name!=OLD.repo_name OR NEW.repo_private!=OLD.repo_private OR NEW.branch!=OLD.branch OR NEW.path!=OLD.path OR NEW.sha256!=OLD.sha256 OR NEW.tree_sha!=OLD.tree_sha OR NEW.base_head!=OLD.base_head OR NEW.files_json!=OLD.files_json OR NEW.byte_length!=OLD.byte_length OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR (NEW.token_id IS NOT OLD.token_id AND NEW.token_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'github_backup_immutable'); END;

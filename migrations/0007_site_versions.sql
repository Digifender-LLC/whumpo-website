CREATE TABLE site_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 component_id TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(length(CAST(config_json AS BLOB)) <= 8192),
 html TEXT NOT NULL CHECK(length(CAST(html AS BLOB)) <= 32768),
 digest TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX site_versions_project ON site_versions(project_id, created_at DESC);
CREATE TRIGGER site_versions_quota BEFORE INSERT ON site_versions
WHEN (SELECT COUNT(*) FROM site_versions WHERE project_id = NEW.project_id) >= 25
BEGIN SELECT RAISE(ABORT, 'site_version_quota'); END;
CREATE TRIGGER site_versions_immutable BEFORE UPDATE ON site_versions
BEGIN SELECT RAISE(ABORT, 'site_version_immutable'); END;

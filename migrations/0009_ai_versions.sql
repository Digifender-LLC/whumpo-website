ALTER TABLE site_versions ADD COLUMN source TEXT NOT NULL DEFAULT 'guided' CHECK(source IN ('guided','ai'));
ALTER TABLE site_versions ADD COLUMN base_version_id TEXT;

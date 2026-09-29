ALTER TABLE projects ADD COLUMN audience TEXT NOT NULL DEFAULT '' CHECK(length(audience)<=1000);
ALTER TABLE projects ADD COLUMN style_notes TEXT NOT NULL DEFAULT '' CHECK(length(style_notes)<=1000);
ALTER TABLE projects ADD COLUMN preferred_theme TEXT NOT NULL DEFAULT 'ocean' CHECK(preferred_theme IN ('ocean','clay','forest'));
ALTER TABLE workspace_state ADD COLUMN brief_project_id TEXT;
ALTER TABLE workspace_state ADD COLUMN brief_stage TEXT CHECK(brief_stage IN ('audience','style'));

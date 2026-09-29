CREATE TABLE cms_export_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE
);
CREATE TRIGGER cms_export_link_owner BEFORE INSERT ON cms_export_links
WHEN (SELECT COUNT(*) FROM cms_export_links)>=5000 OR (SELECT COUNT(*) FROM cms_export_links WHERE user_id=NEW.user_id)>=1000 OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id JOIN chat_turns t ON t.id=NEW.turn_id WHERE d.id=NEW.draft_request_id AND d.project_id=NEW.project_id AND d.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id AND t.status IN ('pending','completed'))
BEGIN SELECT RAISE(ABORT,'cms_export_owner'); END;
CREATE TRIGGER cms_export_link_immutable BEFORE UPDATE ON cms_export_links
BEGIN SELECT RAISE(ABORT,'cms_export_immutable'); END;

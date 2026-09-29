CREATE TABLE cms_preview_links (
 turn_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE
);
CREATE TRIGGER cms_preview_admission BEFORE INSERT ON cms_preview_links WHEN NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.draft_request_id AND d.project_id=NEW.project_id AND d.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND d.item_id IS NOT NULL) OR (SELECT count(*) FROM cms_preview_links WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_preview_links)>=1000
 BEGIN SELECT RAISE(ABORT,'cms_preview_not_available'); END;
CREATE TRIGGER cms_preview_immutable BEFORE UPDATE ON cms_preview_links BEGIN SELECT RAISE(ABORT,'cms_preview_immutable'); END;

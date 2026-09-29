CREATE TABLE cms_edit_requests (
 id TEXT PRIMARY KEY,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=4096),
 result TEXT CHECK(result IS NULL OR length(CAST(result AS BLOB))<=2048),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER cms_edit_admission BEFORE INSERT ON cms_edit_requests WHEN NEW.result IS NOT NULL OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN cms_instances c ON c.project_id=d.project_id JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.draft_request_id AND d.item_id IS NOT NULL AND c.state='ready' AND p.owner_user_id=d.user_id) OR (SELECT count(*) FROM cms_draft_requests)+(SELECT count(*) FROM cms_edit_requests)>=450 OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=(SELECT project_id FROM cms_draft_requests WHERE id=NEW.draft_request_id))+(SELECT count(*) FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id WHERE d.project_id=(SELECT project_id FROM cms_draft_requests WHERE id=NEW.draft_request_id))>=90
 BEGIN SELECT RAISE(ABORT,'cms_edit_not_available'); END;
CREATE TRIGGER cms_edit_immutable BEFORE UPDATE ON cms_edit_requests WHEN NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at OR OLD.result IS NOT NULL OR NEW.result IS NULL
 BEGIN SELECT RAISE(ABORT,'cms_edit_immutable'); END;
CREATE TRIGGER cms_draft_edit_capacity BEFORE INSERT ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR (SELECT count(*) FROM cms_draft_requests)+(SELECT count(*) FROM cms_edit_requests)>=450 OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=NEW.project_id)+(SELECT count(*) FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id WHERE d.project_id=NEW.project_id)>=90
 BEGIN SELECT RAISE(ABORT,'cms_content_capacity'); END;

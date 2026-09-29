CREATE TABLE cms_draft_requests (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=4096),
 item_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER cms_draft_admission BEFORE INSERT ON cms_draft_requests WHEN NEW.item_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready') OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=NEW.project_id)>=90 OR (SELECT count(*) FROM cms_draft_requests)>=450
 BEGIN SELECT RAISE(ABORT,'cms_draft_not_available'); END;
CREATE TRIGGER cms_draft_immutable BEFORE UPDATE ON cms_draft_requests WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.collection<>OLD.collection OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at OR OLD.item_id IS NOT NULL OR NEW.item_id IS NULL
 BEGIN SELECT RAISE(ABORT,'cms_draft_immutable'); END;

CREATE TABLE cms_publication_reviews (
 id TEXT PRIMARY KEY,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 item_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB))<=16384),
 preview_html TEXT NOT NULL CHECK(length(CAST(preview_html AS BLOB))<=32768),
 public_html TEXT NOT NULL CHECK(length(CAST(public_html AS BLOB))<=32768),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','published')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER cms_publication_admission BEFORE INSERT ON cms_publication_reviews WHEN NEW.status<>'pending' OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id JOIN cms_instances c ON c.project_id=d.project_id WHERE d.id=NEW.draft_request_id AND d.user_id=NEW.user_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.collection=NEW.collection AND d.item_id=NEW.item_id AND c.state='ready') OR (SELECT count(*) FROM cms_publication_reviews WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_publication_reviews)>=500
 BEGIN SELECT RAISE(ABORT,'cms_publication_not_available'); END;
CREATE TRIGGER cms_publication_immutable BEFORE UPDATE ON cms_publication_reviews WHEN NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.collection<>OLD.collection OR NEW.item_id<>OLD.item_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.preview_html<>OLD.preview_html OR NEW.public_html<>OLD.public_html OR NEW.digest<>OLD.digest OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='published'))
 BEGIN SELECT RAISE(ABORT,'cms_publication_immutable_or_expired'); END;
CREATE UNIQUE INDEX cms_publication_live_item ON cms_publication_reviews(project_id,collection,item_id) WHERE status='published';

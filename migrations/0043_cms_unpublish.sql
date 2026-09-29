ALTER TABLE cms_publication_reviews ADD COLUMN withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN (0,1));
DROP INDEX cms_publication_live_item;
CREATE UNIQUE INDEX cms_publication_live_item ON cms_publication_reviews(project_id,collection,item_id) WHERE status='published' AND withdrawn=0;
CREATE TABLE cms_unpublish_reviews (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES cms_publication_reviews(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 revision TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','complete')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX cms_unpublish_once ON cms_unpublish_reviews(publication_id) WHERE status IN ('approved','complete');
CREATE TRIGGER cms_unpublish_admission BEFORE INSERT ON cms_unpublish_reviews WHEN NEW.status<>'pending' OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.publication_id AND r.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND r.status='published' AND r.withdrawn=0) OR (SELECT count(*) FROM cms_unpublish_reviews WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_unpublish_reviews)>=500
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_not_available'); END;
CREATE TRIGGER cms_unpublish_immutable BEFORE UPDATE ON cms_unpublish_reviews WHEN NEW.id<>OLD.id OR NEW.publication_id<>OLD.publication_id OR NEW.user_id<>OLD.user_id OR NEW.revision<>OLD.revision OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.publication_id AND r.withdrawn=0 AND r.status='published' AND p.owner_user_id=NEW.user_id)) OR (OLD.status='approved' AND NEW.status='complete'))
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_immutable_or_expired'); END;
DROP TRIGGER cms_publication_immutable;
CREATE TRIGGER cms_publication_immutable BEFORE UPDATE ON cms_publication_reviews WHEN NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.collection<>OLD.collection OR NEW.item_id<>OLD.item_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.preview_html<>OLD.preview_html OR NEW.public_html<>OLD.public_html OR NEW.digest<>OLD.digest OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.withdrawn=0 AND NEW.withdrawn=0 AND ((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='published'))) OR (OLD.status='published' AND NEW.status='published' AND OLD.withdrawn=0 AND NEW.withdrawn=1 AND EXISTS(SELECT 1 FROM cms_unpublish_reviews u WHERE u.publication_id=OLD.id AND u.status='approved')))
 BEGIN SELECT RAISE(ABORT,'cms_publication_immutable_or_expired'); END;
CREATE TRIGGER cms_unpublish_hide AFTER UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' BEGIN
 UPDATE cms_publication_reviews SET withdrawn=1 WHERE id=NEW.publication_id;
END;
CREATE TRIGGER cms_publication_unpublish_guard BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status IN ('approved','published') AND EXISTS(SELECT 1 FROM cms_unpublish_reviews u JOIN cms_publication_reviews r ON r.id=u.publication_id WHERE r.project_id=NEW.project_id AND r.collection=NEW.collection AND r.item_id=NEW.item_id AND u.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_pending'); END;
CREATE TRIGGER cms_publication_withdrawn_insert BEFORE INSERT ON cms_publication_reviews WHEN NEW.withdrawn<>0 BEGIN SELECT RAISE(ABORT,'cms_publication_invalid_state'); END;

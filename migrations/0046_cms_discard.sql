CREATE TABLE cms_discard_reviews (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES cms_publication_reviews(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 revision TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB))<=16384),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','complete')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX cms_discard_pending ON cms_discard_reviews(publication_id) WHERE status='approved';
CREATE TRIGGER cms_discard_admission BEFORE INSERT ON cms_discard_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_publication_reviews p JOIN projects project ON project.id=p.project_id WHERE p.id=NEW.publication_id AND p.user_id=NEW.user_id AND project.owner_user_id=NEW.user_id AND p.status='published' AND p.withdrawn=0) OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR (SELECT count(*) FROM cms_discard_reviews WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_discard_reviews)>=500
 BEGIN SELECT RAISE(ABORT,'cms_discard_unavailable'); END;
CREATE TRIGGER cms_discard_immutable BEFORE UPDATE ON cms_discard_reviews WHEN NEW.id<>OLD.id OR NEW.publication_id<>OLD.publication_id OR NEW.user_id<>OLD.user_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM cms_publication_reviews p JOIN projects project ON project.id=p.project_id WHERE p.id=NEW.publication_id AND project.owner_user_id=NEW.user_id AND p.status='published' AND p.withdrawn=0)) OR (OLD.status='approved' AND NEW.status='complete'))
 BEGIN SELECT RAISE(ABORT,'cms_discard_immutable_or_expired'); END;
CREATE TRIGGER cms_discard_publication_guard BEFORE UPDATE OF status ON cms_discard_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=NEW.publication_id AND replacement.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_replacement_pending'); END;
CREATE TRIGGER cms_publication_discard_guard BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_discard_reviews d WHERE d.publication_id=NEW.replaces_publication_id AND d.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_discard_pending'); END;
CREATE TRIGGER cms_unpublish_discard_guard BEFORE UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_discard_reviews d WHERE d.publication_id=NEW.publication_id AND d.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_discard_pending'); END;

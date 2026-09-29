-- Freeze the exact public version being replaced; its immutable HTML remains historical.
ALTER TABLE cms_publication_reviews ADD COLUMN replaces_publication_id TEXT REFERENCES cms_publication_reviews(id);
DROP TRIGGER cms_publication_immutable;
CREATE TRIGGER cms_publication_immutable BEFORE UPDATE ON cms_publication_reviews WHEN NEW.replaces_publication_id IS NOT OLD.replaces_publication_id OR NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.collection<>OLD.collection OR NEW.item_id<>OLD.item_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.preview_html<>OLD.preview_html OR NEW.public_html<>OLD.public_html OR NEW.digest<>OLD.digest OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.withdrawn=0 AND NEW.withdrawn=0 AND ((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='published'))) OR (OLD.status='published' AND NEW.status='published' AND OLD.withdrawn=0 AND NEW.withdrawn=1 AND (EXISTS(SELECT 1 FROM cms_unpublish_reviews u WHERE u.publication_id=OLD.id AND u.status='approved') OR EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=OLD.id AND replacement.status='approved'))))
 BEGIN SELECT RAISE(ABORT,'cms_publication_immutable_or_expired'); END;

CREATE UNIQUE INDEX cms_publication_one_pending_native ON cms_publication_reviews(project_id,collection,item_id) WHERE status='approved';
CREATE TRIGGER cms_replacement_admission BEFORE INSERT ON cms_publication_reviews WHEN NEW.replaces_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.project_id=NEW.project_id AND base.collection=NEW.collection AND base.item_id=NEW.item_id AND base.user_id=NEW.user_id AND base.status='published' AND base.withdrawn=0)
 BEGIN SELECT RAISE(ABORT,'cms_replacement_base_unavailable'); END;
CREATE TRIGGER cms_replacement_current BEFORE UPDATE OF status ON cms_publication_reviews WHEN OLD.status='pending' AND NEW.status='approved' AND (
 (NEW.replaces_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.status='published' AND base.withdrawn=0)) OR
 (NEW.replaces_publication_id IS NULL AND EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.project_id=NEW.project_id AND base.collection=NEW.collection AND base.item_id=NEW.item_id AND base.status='published' AND base.withdrawn=0))
 ) BEGIN SELECT RAISE(ABORT,'cms_publication_base_changed'); END;
-- Runs inside the publication statement; uniqueness failure rolls this withdrawal back too.
CREATE TRIGGER cms_replacement_swap BEFORE UPDATE OF status ON cms_publication_reviews WHEN OLD.status='approved' AND NEW.status='published' AND NEW.replaces_publication_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'cms_publication_base_changed') WHERE NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.status='published' AND base.withdrawn=0);
 UPDATE cms_publication_reviews SET withdrawn=1 WHERE id=NEW.replaces_publication_id AND withdrawn=0;
END;
CREATE TRIGGER cms_unpublish_replacement_guard BEFORE UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=NEW.publication_id AND replacement.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_replacement_pending'); END;

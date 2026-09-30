CREATE TABLE cms_import_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
 source_id INTEGER NOT NULL CHECK(source_id BETWEEN 1 AND 9007199254740991),
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=4096),
 provenance TEXT NOT NULL CHECK(json_valid(provenance) AND length(CAST(provenance AS BLOB))<=32768),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','imported','superseded')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'))
);
CREATE UNIQUE INDEX cms_import_source_current ON cms_import_reviews(project_id,source_digest,source_id) WHERE status<>'superseded';
CREATE TRIGGER cms_import_admission BEFORE INSERT ON cms_import_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected') OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_discard_reviews WHERE id=NEW.id) OR (SELECT count(*) FROM cms_import_reviews WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_import_reviews)>=500
 BEGIN SELECT RAISE(ABORT,'cms_import_unavailable'); END;
CREATE TRIGGER cms_import_immutable BEFORE UPDATE ON cms_import_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.source_digest<>OLD.source_digest OR NEW.source_id<>OLD.source_id OR NEW.collection<>OLD.collection OR NEW.body<>OLD.body OR NEW.provenance<>OLD.provenance OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR NOT ((OLD.status='pending' AND NEW.status='superseded' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='imported' AND EXISTS(SELECT 1 FROM cms_draft_requests d WHERE d.id=OLD.id AND d.user_id=OLD.user_id AND d.project_id=OLD.project_id AND d.collection=OLD.collection AND d.body=OLD.body AND d.content_format='structured' AND d.item_id IS NOT NULL)))
 BEGIN SELECT RAISE(ABORT,'cms_import_immutable'); END;
-- Reserve capacity and the exact native intent in the approval transaction.
CREATE TRIGGER cms_import_approve AFTER UPDATE OF status ON cms_import_reviews WHEN OLD.status='pending' AND NEW.status='approved' BEGIN
 INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body,content_format) VALUES(NEW.id,NEW.project_id,NEW.user_id,NEW.collection,NEW.body,'structured');
END;
CREATE TRIGGER cms_import_draft_guard BEFORE INSERT ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=NEW.id AND (r.status<>'approved' OR r.project_id<>NEW.project_id OR r.user_id<>NEW.user_id OR r.collection<>NEW.collection OR r.body<>NEW.body OR NEW.content_format<>'structured')) BEGIN SELECT RAISE(ABORT,'cms_import_review_required'); END;
CREATE TRIGGER cms_import_retained BEFORE DELETE ON cms_import_reviews WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_import_retained'); END;
CREATE TRIGGER cms_import_publication_id BEFORE INSERT ON cms_publication_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;
CREATE TRIGGER cms_import_edit_id BEFORE INSERT ON cms_edit_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;
CREATE TRIGGER cms_import_unpublish_id BEFORE INSERT ON cms_unpublish_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;
CREATE TRIGGER cms_import_discard_id BEFORE INSERT ON cms_discard_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;

-- A new review may atomically replace an expired, never-approved review. Failure rolls both changes back.
CREATE TRIGGER cms_import_renew BEFORE INSERT ON cms_import_reviews BEGIN
 UPDATE cms_import_reviews SET status='superseded' WHERE project_id=NEW.project_id AND user_id=NEW.user_id AND source_digest=NEW.source_digest AND source_id=NEW.source_id AND status='pending' AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

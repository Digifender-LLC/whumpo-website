ALTER TABLE directory_reviews ADD COLUMN source_review_id TEXT;
CREATE TRIGGER directory_restore_source BEFORE INSERT ON directory_reviews
WHEN NEW.source_review_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.kind!='edit' OR NOT EXISTS(SELECT 1 FROM directory_reviews r WHERE r.id=NEW.source_review_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.status='applied' AND r.kind IN ('edit','publish') AND r.snapshot_json=NEW.snapshot_json AND r.digest=NEW.digest);
END;
CREATE TRIGGER directory_restore_identity BEFORE UPDATE ON directory_reviews
WHEN NEW.source_review_id IS NOT OLD.source_review_id
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;
CREATE TABLE directory_exports (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES directory_reviews(id) ON DELETE CASCADE
);
CREATE TRIGGER directory_export_owner BEFORE INSERT ON directory_exports
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN directory_reviews r ON r.id=NEW.review_id AND r.user_id=t.user_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND r.status='applied' AND r.kind IN ('edit','publish'));
END;
CREATE TRIGGER directory_export_immutable BEFORE UPDATE ON directory_exports
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;
-- A full recovery history must not prevent the owner from taking public data offline.
DROP TRIGGER directory_review_insert;
CREATE TRIGGER directory_review_insert BEFORE INSERT ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'directory_capacity') WHERE NEW.kind!='unpublish' AND (SELECT COUNT(*) FROM directory_reviews WHERE project_id=NEW.project_id AND kind!='unpublish')>=100;
END;

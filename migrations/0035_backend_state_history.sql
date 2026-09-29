ALTER TABLE backend_state_reviews ADD COLUMN restore_review_id TEXT REFERENCES backend_state_reviews(id);
ALTER TABLE backend_state_reviews ADD COLUMN restore_side TEXT CHECK(restore_side IN ('before','after'));
CREATE TRIGGER backend_state_restore_source BEFORE INSERT ON backend_state_reviews WHEN
 (NEW.restore_review_id IS NULL)<>(NEW.restore_side IS NULL) OR
 (NEW.restore_review_id IS NOT NULL AND (NEW.input_json<>'null' OR NOT EXISTS(
 SELECT 1 FROM backend_state_reviews r WHERE r.id=NEW.restore_review_id AND r.status='applied' AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id
 ))) BEGIN SELECT RAISE(ABORT,'backend_state_restore_source'); END;
CREATE TRIGGER backend_state_restore_identity BEFORE UPDATE ON backend_state_reviews WHEN
 NEW.restore_review_id IS NOT OLD.restore_review_id OR NEW.restore_side IS NOT OLD.restore_side OR
 (NEW.restore_review_id IS NOT NULL AND NEW.status='ready' AND NOT EXISTS(
 SELECT 1 FROM backend_state_reviews r WHERE r.id=NEW.restore_review_id AND r.status='applied' AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND
 NEW.after_json=CASE NEW.restore_side WHEN 'before' THEN r.before_json ELSE r.after_json END
 )) BEGIN SELECT RAISE(ABORT,'backend_state_restore_immutable'); END;
CREATE TABLE backend_state_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES backend_state_reviews(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('review','export'))
);
CREATE TRIGGER backend_state_links_authority BEFORE INSERT ON backend_state_links WHEN NOT EXISTS(
 SELECT 1 FROM chat_turns t JOIN backend_state_reviews r ON r.id=NEW.review_id JOIN projects p ON p.id=r.project_id WHERE t.id=NEW.turn_id AND t.user_id=r.user_id AND p.owner_user_id=t.user_id AND (NEW.kind='review' OR r.status='applied')
) BEGIN SELECT RAISE(ABORT,'backend_state_link_owner'); END;
CREATE TRIGGER backend_state_links_immutable BEFORE UPDATE ON backend_state_links BEGIN SELECT RAISE(ABORT,'backend_state_link_immutable'); END;

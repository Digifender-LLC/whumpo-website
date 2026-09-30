-- Bind controls to authoritative replies, never arbitrary model text.
CREATE TABLE app_maintenance_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('upgrade','rollback')),
 review_id TEXT NOT NULL,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);
CREATE TRIGGER app_maintenance_chat_link_admit BEFORE INSERT ON app_maintenance_chat_links BEGIN
 SELECT RAISE(ABORT,'maintenance_chat_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.turn_id AND user_id=NEW.user_id);
 SELECT RAISE(ABORT,'maintenance_chat_review') WHERE NOT (
 (NEW.kind='upgrade' AND EXISTS(SELECT 1 FROM app_migration_checks WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
 (NEW.kind='rollback' AND EXISTS(SELECT 1 FROM app_restore_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id AND restore_program=1)));
END;
CREATE TRIGGER app_maintenance_chat_link_update BEFORE UPDATE ON app_maintenance_chat_links BEGIN SELECT RAISE(ABORT,'maintenance_chat_immutable'); END;

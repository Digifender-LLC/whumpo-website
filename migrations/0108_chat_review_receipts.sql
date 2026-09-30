-- Additive presentation evidence; never grants permission to confirm a review.
CREATE TABLE chat_review_receipts (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('application','appPage','appRestore','backendPublication','backendForm')),
 review_id TEXT NOT NULL,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);
CREATE INDEX chat_review_receipts_owner ON chat_review_receipts(user_id,turn_id);
CREATE TRIGGER chat_review_receipt_admit BEFORE INSERT ON chat_review_receipts BEGIN
 SELECT RAISE(ABORT,'chat_review_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.turn_id AND user_id=NEW.user_id);
 SELECT RAISE(ABORT,'chat_review_missing') WHERE NOT (
  (NEW.kind='application' AND EXISTS(SELECT 1 FROM app_activation_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='appPage' AND EXISTS(SELECT 1 FROM app_page_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='appRestore' AND EXISTS(SELECT 1 FROM app_restore_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id AND restore_program=0)) OR
  (NEW.kind='backendPublication' AND EXISTS(SELECT 1 FROM backend_publication_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='backendForm' AND EXISTS(SELECT 1 FROM backend_form_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id))
 );
END;
CREATE TRIGGER chat_review_receipt_immutable BEFORE UPDATE ON chat_review_receipts BEGIN SELECT RAISE(ABORT,'chat_review_immutable'); END;

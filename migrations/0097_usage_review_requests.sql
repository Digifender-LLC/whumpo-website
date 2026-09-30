-- Customer-initiated support records, separate from private abuse evidence.
ALTER TABLE chat_turns ADD COLUMN ai_context_allowed INTEGER NOT NULL DEFAULT 1 CHECK(ai_context_allowed IN (0,1));
CREATE TRIGGER chat_private_context BEFORE UPDATE OF ai_context_allowed ON chat_turns
WHEN OLD.ai_context_allowed=0 AND NEW.ai_context_allowed!=0
BEGIN SELECT RAISE(ABORT,'private_chat_context'); END;
CREATE TABLE usage_review_requests (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 statement TEXT NOT NULL CHECK(length(statement) BETWEEN 1 AND 950),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','answered')),
 public_response TEXT CHECK(length(public_response) BETWEEN 1 AND 2000),
 answered_by TEXT CHECK(length(answered_by) BETWEEN 1 AND 100),
 answered_at TEXT,
 CHECK((state='open' AND public_response IS NULL AND answered_by IS NULL AND answered_at IS NULL) OR
       (state='answered' AND public_response IS NOT NULL AND answered_by IS NOT NULL AND answered_at IS NOT NULL))
);
CREATE UNIQUE INDEX usage_review_one_open ON usage_review_requests(user_id) WHERE state='open';
CREATE INDEX usage_review_owner_time ON usage_review_requests(user_id,created_at,id);
CREATE TRIGGER usage_review_insert BEFORE INSERT ON usage_review_requests BEGIN
 SELECT RAISE(ABORT,'usage_review_initial') WHERE NEW.state!='open' OR NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND t.status='completed' AND t.ai_context_allowed=0);
END;
CREATE TRIGGER usage_review_update BEFORE UPDATE ON usage_review_requests BEGIN
 SELECT RAISE(ABORT,'usage_review_immutable') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.statement IS NOT OLD.statement OR NEW.created_at IS NOT OLD.created_at OR OLD.state!='open' OR NEW.state!='answered';
END;
CREATE TRIGGER usage_review_delete BEFORE DELETE ON usage_review_requests
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'usage_review_immutable'); END;

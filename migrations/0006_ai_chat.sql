ALTER TABLE chat_turns ADD COLUMN mode TEXT NOT NULL DEFAULT 'guided' CHECK(mode IN ('guided','ai'));
ALTER TABLE chat_turns ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','uncertain'));
ALTER TABLE chat_turns ADD COLUMN input_tokens INTEGER;
ALTER TABLE chat_turns ADD COLUMN output_tokens INTEGER;
CREATE INDEX chat_turns_pending ON chat_turns(user_id, status, created_at);

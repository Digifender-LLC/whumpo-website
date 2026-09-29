CREATE TABLE workspace_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  step TEXT NOT NULL DEFAULT 'idea' CHECK(step IN ('idea','name','ready')),
  idea TEXT NOT NULL DEFAULT ''
);
CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, revision)
);
CREATE INDEX chat_turns_user_revision ON chat_turns(user_id, revision DESC);

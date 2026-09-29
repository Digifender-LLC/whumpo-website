CREATE TABLE invitations (
  code_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id)
);

-- Bound test data even when multiple requests race.
CREATE TRIGGER project_quota BEFORE INSERT ON projects
WHEN (SELECT COUNT(*) FROM projects WHERE owner_user_id = NEW.owner_user_id) >= 20
BEGIN SELECT RAISE(ABORT, 'project_quota'); END;

CREATE TRIGGER user_quota BEFORE INSERT ON users
WHEN (SELECT COUNT(*) FROM users) >= 50
BEGIN SELECT RAISE(ABORT, 'user_quota'); END;

CREATE TRIGGER session_retention AFTER INSERT ON sessions
BEGIN
  DELETE FROM sessions WHERE user_id = NEW.user_id AND token_hash NOT IN (
    SELECT token_hash FROM sessions WHERE user_id = NEW.user_id ORDER BY created_at DESC LIMIT 10
  );
END;

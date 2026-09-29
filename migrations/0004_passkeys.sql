CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TRIGGER passkey_quota BEFORE INSERT ON passkeys
WHEN (SELECT COUNT(*) FROM passkeys WHERE user_id = NEW.user_id) >= 10
BEGIN SELECT RAISE(ABORT, 'passkey_quota'); END;
CREATE TABLE auth_challenges (
  token_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('signup','login','add')),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  invite_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_challenges_expiry ON auth_challenges(expires_at);
CREATE TRIGGER challenge_quota BEFORE INSERT ON auth_challenges
WHEN (SELECT COUNT(*) FROM auth_challenges) >= 5000
BEGIN SELECT RAISE(ABORT, 'challenge_quota'); END;
CREATE TABLE recovery_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

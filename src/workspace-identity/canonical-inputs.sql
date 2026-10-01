-- Target canonical identity inputs for the single reviewed test reset, not a migration.
-- No password fields. All other platform tables are admitted with the coordinated cutover.
CREATE TABLE users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL
) STRICT;
CREATE TRIGGER user_quota BEFORE INSERT ON users
WHEN (SELECT count(*) FROM users)>=50
BEGIN SELECT RAISE(ABORT,'user_quota'); END;

CREATE TABLE invitations (
 code_hash TEXT PRIMARY KEY,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 used_at INTEGER CHECK(used_at IS NULL OR used_at>=0),
 CHECK(used_by IS NULL OR used_at IS NOT NULL)
) STRICT;
CREATE TRIGGER invitation_spent_immutable BEFORE UPDATE ON invitations
WHEN NEW.code_hash!=OLD.code_hash OR NEW.created_at!=OLD.created_at
 OR (OLD.used_at IS NOT NULL AND (NEW.used_at IS NOT OLD.used_at OR (NEW.used_by IS NOT NULL AND NEW.used_by IS NOT OLD.used_by)))
BEGIN SELECT RAISE(ABORT,'invitation_spent_immutable'); END;

CREATE TABLE customer_eligibility (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 declaration_version TEXT NOT NULL,
 country_scope TEXT NOT NULL CHECK(country_scope='US'),
 signup_method TEXT NOT NULL CHECK(signup_method='passkey'),
 accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TRIGGER customer_eligibility_immutable BEFORE UPDATE ON customer_eligibility
BEGIN SELECT RAISE(ABORT,'customer_eligibility_immutable'); END;

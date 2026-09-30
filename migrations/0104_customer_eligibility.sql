-- Records only an explicit US-based self-declaration, not verified residence or AUP consent.
CREATE TABLE customer_eligibility (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 declaration_version TEXT NOT NULL,
 country_scope TEXT NOT NULL CHECK(country_scope='US'),
 signup_method TEXT NOT NULL CHECK(signup_method IN ('password','passkey')),
 accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER customer_eligibility_immutable BEFORE UPDATE ON customer_eligibility
 BEGIN SELECT RAISE(ABORT,'customer_eligibility_immutable'); END;

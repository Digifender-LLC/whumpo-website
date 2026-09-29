-- Visitor credentials are separate from platform accounts. No public routes yet.
CREATE TABLE app_invitations (
 code_hash TEXT PRIMARY KEY CHECK(length(code_hash)=64),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 program_revision INTEGER NOT NULL CHECK(program_revision>=0),
 used_by TEXT REFERENCES app_visitors(id),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);
CREATE INDEX app_invitation_project ON app_invitations(project_id);
CREATE TRIGGER app_invitation_admit BEFORE INSERT ON app_invitations BEGIN
 SELECT RAISE(ABORT,'app_invitation_authority') WHERE NEW.used_by IS NOT NULL OR NEW.revoked<>0 OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.enabled=1 AND a.revision=NEW.program_revision);
 SELECT RAISE(ABORT,'app_invitation_capacity') WHERE (SELECT count(*) FROM app_invitations WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_invitations)>=1000;
END;
CREATE TRIGGER app_invitation_identity BEFORE UPDATE ON app_invitations WHEN NEW.code_hash<>OLD.code_hash OR NEW.project_id<>OLD.project_id OR NEW.program_revision<>OLD.program_revision OR NEW.expires_at<>OLD.expires_at OR OLD.revoked=1 AND NEW.revoked<>1 OR OLD.used_by IS NOT NULL AND NEW.used_by IS NOT OLD.used_by OR NEW.used_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=NEW.used_by AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'app_invitation_identity'); END;

CREATE TABLE app_passkeys (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 1400),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 public_key TEXT NOT NULL CHECK(length(public_key) BETWEEN 1 AND 3000),
 counter INTEGER NOT NULL CHECK(counter>=0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
CREATE INDEX app_passkeys_visitor ON app_passkeys(visitor_id);
CREATE TRIGGER app_passkey_admit BEFORE INSERT ON app_passkeys BEGIN
 SELECT RAISE(ABORT,'app_passkey_authority') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE v.id=NEW.visitor_id AND v.revoked=0 AND a.enabled=1);
 SELECT RAISE(ABORT,'app_passkey_capacity') WHERE (SELECT count(*) FROM app_passkeys WHERE visitor_id=NEW.visitor_id)>=5;
END;
CREATE TRIGGER app_passkey_identity BEFORE UPDATE ON app_passkeys WHEN NEW.id<>OLD.id OR NEW.visitor_id<>OLD.visitor_id OR NEW.public_key<>OLD.public_key OR NEW.counter<OLD.counter OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'app_passkey_identity'); END;

CREATE TABLE app_auth_challenges (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 program_revision INTEGER NOT NULL CHECK(program_revision>=0),
 challenge TEXT NOT NULL CHECK(length(challenge) BETWEEN 16 AND 128),
 kind TEXT NOT NULL CHECK(kind IN ('signup','login','add')),
 visitor_id TEXT NOT NULL,
 invite_hash TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))
);
CREATE INDEX app_challenge_project ON app_auth_challenges(project_id);
CREATE TRIGGER app_challenge_admit BEFORE INSERT ON app_auth_challenges BEGIN
 SELECT RAISE(ABORT,'app_challenge_authority') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.enabled=1 AND a.revision=NEW.program_revision);
 SELECT RAISE(ABORT,'app_challenge_capacity') WHERE (SELECT count(*) FROM app_auth_challenges WHERE project_id=NEW.project_id)>=50 OR (SELECT count(*) FROM app_auth_challenges)>=1000;
END;
CREATE TRIGGER app_challenge_immutable BEFORE UPDATE ON app_auth_challenges BEGIN SELECT RAISE(ABORT,'app_challenge_immutable'); END;

CREATE TABLE app_recovery_codes (
 visitor_id TEXT PRIMARY KEY REFERENCES app_visitors(id),
 code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash)=64)
);
CREATE TRIGGER app_recovery_identity BEFORE UPDATE ON app_recovery_codes WHEN NEW.visitor_id<>OLD.visitor_id
 BEGIN SELECT RAISE(ABORT,'app_recovery_identity'); END;
CREATE TRIGGER app_visitor_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN
 DELETE FROM app_sessions WHERE visitor_id=NEW.id;
 DELETE FROM app_passkeys WHERE visitor_id=NEW.id;
 DELETE FROM app_recovery_codes WHERE visitor_id=NEW.id;
 DELETE FROM app_auth_challenges WHERE visitor_id=NEW.id;
END;

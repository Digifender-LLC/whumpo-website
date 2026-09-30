-- Trusted scanner integration only; no customer/model HTTP endpoint issues tickets.
CREATE TABLE photo_scan_tickets (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('profile','project')),
 subject_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 authority_hash TEXT NOT NULL CHECK(length(authority_hash)=64),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','completed','stale')),
 result_hash TEXT,
 outcome TEXT CHECK(outcome IN ('approved','blocked','held')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 completed_at TEXT,
 UNIQUE(kind,subject_id,digest,policy_version),
 CHECK((state='reserved' AND result_hash IS NULL AND outcome IS NULL AND completed_at IS NULL) OR
 (state IN ('completed','stale') AND length(result_hash)=64 AND result_hash IS NOT NULL AND outcome IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TRIGGER photo_scan_ticket_owner BEFORE INSERT ON photo_scan_tickets WHEN
 NEW.state!='reserved' OR julianday(NEW.expires_at)<=julianday('now') OR julianday(NEW.expires_at)>julianday('now','+1 hour') OR julianday(NEW.expires_at) IS NULL OR NOT (
 (NEW.kind='profile' AND NEW.subject_id=NEW.user_id AND EXISTS(SELECT 1 FROM profile_photo_safety s JOIN user_profiles p ON p.user_id=s.user_id AND p.photo_digest=s.digest WHERE s.user_id=NEW.user_id AND s.digest=NEW.digest AND s.policy_version=NEW.policy_version AND s.state='pending')) OR
 (NEW.kind='project' AND EXISTS(SELECT 1 FROM project_photo_safety s JOIN project_files f ON f.id=s.file_id AND f.digest=s.digest JOIN projects p ON p.id=f.project_id AND p.owner_user_id=s.user_id WHERE s.file_id=NEW.subject_id AND s.user_id=NEW.user_id AND s.digest=NEW.digest AND s.policy_version=NEW.policy_version AND s.state='pending'))
) BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_owner'); END;
CREATE TRIGGER photo_scan_ticket_quota BEFORE INSERT ON photo_scan_tickets WHEN
 (SELECT count(*) FROM photo_scan_tickets)>=5000 OR
 (SELECT count(*) FROM photo_scan_tickets WHERE user_id=NEW.user_id)>=100
 BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_quota'); END;
CREATE TRIGGER photo_scan_ticket_immutable BEFORE UPDATE ON photo_scan_tickets WHEN
 NEW.id!=OLD.id OR NEW.kind!=OLD.kind OR NEW.subject_id!=OLD.subject_id OR NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.authority_hash!=OLD.authority_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR OLD.state!='reserved' OR NEW.state NOT IN ('completed','stale')
 BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_immutable'); END;

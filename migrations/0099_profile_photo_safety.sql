ALTER TABLE user_profiles ADD COLUMN photo_digest TEXT CHECK(photo_digest IS NULL OR length(photo_digest)=64);
CREATE TABLE profile_photo_safety (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 photo_revision INTEGER NOT NULL CHECK(photo_revision>=0),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','blocked')),
 csam_check TEXT NOT NULL DEFAULT 'unknown' CHECK(csam_check IN ('unknown','clear','matched')),
 sexual_check TEXT NOT NULL DEFAULT 'unknown' CHECK(sexual_check IN ('unknown','clear','matched')),
 scanner_reference TEXT,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state!='approved' OR (csam_check='clear' AND sexual_check='clear' AND length(scanner_reference) BETWEEN 1 AND 200 AND scanner_reference IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE TRIGGER profile_photo_safety_owner BEFORE INSERT ON profile_photo_safety WHEN
 NEW.state!='pending' OR NEW.csam_check!='unknown' OR NEW.sexual_check!='unknown' OR
 NEW.scanner_reference IS NOT NULL OR NEW.expires_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM user_profiles WHERE user_id=NEW.user_id AND photo IS NOT NULL AND photo_digest=NEW.digest AND revision=NEW.photo_revision
) BEGIN SELECT RAISE(ABORT,'profile_photo_safety_owner'); END;
CREATE TRIGGER profile_photo_safety_immutable BEFORE UPDATE ON profile_photo_safety WHEN
 NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.photo_revision!=OLD.photo_revision OR NEW.policy_version!=OLD.policy_version OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.state='pending' AND NEW.state IN ('approved','blocked')) OR (OLD.state='approved' AND NEW.state='blocked'))
 BEGIN SELECT RAISE(ABORT,'profile_photo_safety_immutable'); END;
CREATE TRIGGER profile_photo_safety_invalidate AFTER UPDATE ON user_profiles WHEN
 NEW.photo IS NOT OLD.photo OR NEW.photo_digest IS NOT OLD.photo_digest
 BEGIN DELETE FROM profile_photo_safety WHERE user_id=NEW.user_id; END;

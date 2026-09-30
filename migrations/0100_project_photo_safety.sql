CREATE TABLE project_photo_safety (
 file_id TEXT PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','blocked')),
 csam_check TEXT NOT NULL DEFAULT 'unknown' CHECK(csam_check IN ('unknown','clear','matched')),
 sexual_check TEXT NOT NULL DEFAULT 'unknown' CHECK(sexual_check IN ('unknown','clear','matched')),
 scanner_reference TEXT,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state!='approved' OR (csam_check='clear' AND sexual_check='clear' AND scanner_reference IS NOT NULL AND length(scanner_reference) BETWEEN 1 AND 200 AND expires_at IS NOT NULL AND julianday(expires_at) IS NOT NULL))
);
CREATE TRIGGER project_photo_safety_owner BEFORE INSERT ON project_photo_safety WHEN
 NEW.state!='pending' OR NEW.csam_check!='unknown' OR NEW.sexual_check!='unknown' OR NEW.scanner_reference IS NOT NULL OR NEW.expires_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=NEW.file_id AND f.digest=NEW.digest AND p.owner_user_id=NEW.user_id AND f.status='ready'
) BEGIN SELECT RAISE(ABORT,'project_photo_safety_owner'); END;
CREATE TRIGGER project_photo_safety_immutable BEFORE UPDATE ON project_photo_safety WHEN
 NEW.file_id!=OLD.file_id OR NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.state='pending' AND NEW.state IN ('approved','blocked')) OR (OLD.state='approved' AND NEW.state='blocked'))
 BEGIN SELECT RAISE(ABORT,'project_photo_safety_immutable'); END;
CREATE TRIGGER project_photo_safety_ready AFTER UPDATE OF status ON project_files WHEN NEW.status='ready' AND OLD.status!='ready'
 BEGIN INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version) SELECT NEW.id,owner_user_id,NEW.digest,'2026-09-30' FROM projects WHERE id=NEW.project_id; END;
CREATE TRIGGER project_photo_safety_insert AFTER INSERT ON project_files WHEN NEW.status='ready'
 BEGIN INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version) SELECT NEW.id,owner_user_id,NEW.digest,'2026-09-30' FROM projects WHERE id=NEW.project_id; END;
-- Existing stored media is quarantined, never grandfathered as clear.
INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version)
 SELECT f.id,p.owner_user_id,f.digest,'2026-09-30' FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.status='ready';
CREATE VIEW approved_project_photos AS
 SELECT f.id,f.project_id,f.digest FROM project_files f JOIN projects p ON p.id=f.project_id
 JOIN project_photo_safety s ON s.file_id=f.id AND s.user_id=p.owner_user_id AND s.digest=f.digest
 WHERE f.status='ready' AND s.policy_version='2026-09-30' AND s.state='approved'
 AND s.csam_check='clear' AND s.sexual_check='clear' AND length(s.scanner_reference)>0
 AND julianday(s.expires_at)>julianday('now');
CREATE TRIGGER version_photo_safety BEFORE INSERT ON version_photos WHEN NOT EXISTS(
 SELECT 1 FROM approved_project_photos WHERE id=NEW.file_id
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;
CREATE TRIGGER publication_photo_safety_insert BEFORE INSERT ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM version_photos vp WHERE vp.version_id=NEW.version_id AND NOT EXISTS(SELECT 1 FROM approved_project_photos WHERE id=vp.file_id)
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;
CREATE TRIGGER publication_photo_safety_update BEFORE UPDATE OF version_id ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM version_photos vp WHERE vp.version_id=NEW.version_id AND NOT EXISTS(SELECT 1 FROM approved_project_photos WHERE id=vp.file_id)
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;

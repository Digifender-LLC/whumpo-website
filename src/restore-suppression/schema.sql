-- WH-019 restore reconciliation (current schema input; schema batch 7, cutover C1).
-- WH-019 restore suppression ledger (docs/account-closure.md#wh-019-restore-reconciliation--october-31-2026-utc).
-- One content-free row per erased or revoked subject: an opaque identifier, what happened to it and, for staff grants,
-- the access revision that ended the grant. No names, values, filenames, object keys, ciphertext or tokens. Rows are
-- written by the triggers below inside the same transaction as the erasure/revocation (every path, including cascades),
-- are never updated except to raise a staff revision, are never deleted and have no foreign key, so they survive the
-- account cascade. Guards consult the ledger inside every later commit, so a logical restore (re-inserting an older row,
-- un-revoking a visitor or token, replaying an older staff grant) aborts with `restore_suppressed`; the operator replay
-- (src/restore-suppression.ts) applies the current ledger to an isolated whole-database candidate before admission.
CREATE TABLE restore_suppressions (
 kind TEXT NOT NULL CHECK(kind IN ('account','project','visitor','staff','record','file','github_token','cloudflare_token')),
 subject_id TEXT NOT NULL CHECK(length(subject_id) BETWEEN 1 AND 200),
 effect TEXT NOT NULL CHECK(effect IN ('deleted','revoked')),
 revision INTEGER CHECK((kind='staff')=(revision IS NOT NULL) AND (revision IS NULL OR revision>=1)),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 PRIMARY KEY(kind,subject_id,effect)
) STRICT;
CREATE TRIGGER restore_suppressions_immutable BEFORE UPDATE ON restore_suppressions
WHEN NEW.kind IS NOT OLD.kind OR NEW.subject_id IS NOT OLD.subject_id OR NEW.effect IS NOT OLD.effect OR NEW.recorded_at IS NOT OLD.recorded_at
 OR OLD.kind!='staff' OR NEW.revision<=OLD.revision
BEGIN SELECT RAISE(ABORT,'restore_suppression_immutable'); END;
CREATE TRIGGER restore_suppressions_retained BEFORE DELETE ON restore_suppressions
BEGIN SELECT RAISE(ABORT,'restore_suppression_retained'); END;

-- Population: every erasure or revocation path, including cascades from a project, visitor or account deletion.
CREATE TRIGGER restore_suppress_account AFTER DELETE ON users
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('account',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_project AFTER DELETE ON projects
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('project',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_visitor_deleted AFTER DELETE ON app_visitors
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('visitor',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_visitor_revoked AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 AND OLD.revoked=0
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('visitor',NEW.id,'revoked',unixepoch()); END;
CREATE TRIGGER restore_suppress_staff_revoked AFTER UPDATE OF state ON module_access_roles WHEN OLD.state='granted' AND NEW.state='revoked'
BEGIN
 INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) VALUES('staff',NEW.instance_id||'/'||NEW.visitor_id||'/'||NEW.role,'revoked',NEW.access_revision,unixepoch());
 UPDATE restore_suppressions SET revision=NEW.access_revision WHERE kind='staff' AND subject_id=NEW.instance_id||'/'||NEW.visitor_id||'/'||NEW.role AND effect='revoked' AND revision<NEW.access_revision;
END;
CREATE TRIGGER restore_suppress_staff_deleted AFTER DELETE ON module_access_roles WHEN OLD.state='granted'
BEGIN
 INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) VALUES('staff',OLD.instance_id||'/'||OLD.visitor_id||'/'||OLD.role,'deleted',OLD.access_revision+1,unixepoch());
 UPDATE restore_suppressions SET revision=OLD.access_revision+1 WHERE kind='staff' AND subject_id=OLD.instance_id||'/'||OLD.visitor_id||'/'||OLD.role AND effect='deleted' AND revision<OLD.access_revision+1;
END;
CREATE TRIGGER restore_suppress_record AFTER DELETE ON module_records
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('record',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_file AFTER DELETE ON project_files
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('file',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_github_revoked AFTER UPDATE OF state ON github_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('github_token',NEW.id,'revoked',unixepoch()); END;
CREATE TRIGGER restore_suppress_github_deleted AFTER DELETE ON github_token_vault
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('github_token',OLD.id,'deleted',unixepoch()); END;
CREATE TRIGGER restore_suppress_cloudflare_revoked AFTER UPDATE OF state ON cloudflare_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('cloudflare_token',NEW.id,'revoked',unixepoch()); END;
CREATE TRIGGER restore_suppress_cloudflare_deleted AFTER DELETE ON cloudflare_token_vault
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('cloudflare_token',OLD.id,'deleted',unixepoch()); END;

-- Consultation inside later commits: an erased or revoked subject cannot come back through a logical restore.
-- Opaque identifiers are random and never reused, so a legitimate new row never matches.
CREATE TRIGGER restore_guard_account BEFORE INSERT ON users WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='account' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_project BEFORE INSERT ON projects WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='project' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_visitor BEFORE INSERT ON app_visitors WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='visitor' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_visitor_revoked BEFORE UPDATE OF revoked ON app_visitors WHEN OLD.revoked=1 AND NEW.revoked=0
 AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='visitor' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
-- A later owner review may grant again: it carries a newer access revision than the revocation. An older grant may not.
CREATE TRIGGER restore_guard_staff_insert BEFORE INSERT ON module_access_roles WHEN NEW.state='granted'
 AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='staff' AND subject_id=NEW.instance_id||'/'||NEW.visitor_id||'/'||NEW.role AND revision>=NEW.access_revision)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_staff_update BEFORE UPDATE OF state ON module_access_roles WHEN NEW.state='granted' AND OLD.state='revoked'
 AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='staff' AND subject_id=NEW.instance_id||'/'||NEW.visitor_id||'/'||NEW.role AND revision>=NEW.access_revision)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_record BEFORE INSERT ON module_records WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='record' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_file BEFORE INSERT ON project_files WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='file' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
-- A specification restore or apply cannot point a saved version at an erased photo.
CREATE TRIGGER restore_guard_version_photo BEFORE INSERT ON version_photos WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='file' AND subject_id=NEW.file_id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_github_token BEFORE INSERT ON github_token_vault WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='github_token' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_github_revoked BEFORE UPDATE OF state ON github_token_vault WHEN OLD.state='revoking' AND NEW.state!='revoking'
 AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='github_token' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_cloudflare_token BEFORE INSERT ON cloudflare_token_vault WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='cloudflare_token' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_cloudflare_revoked BEFORE UPDATE OF state ON cloudflare_token_vault WHEN OLD.state='revoking' AND NEW.state!='revoking'
 AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='cloudflare_token' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
-- Recovery points: a document-restore review or confirmation never applies a point holding an erased or revoked
-- visitor's document. Revocation already clears those copies in place; this refuses a restored older copy that was not.
CREATE TRIGGER restore_guard_app_restore_admit BEFORE INSERT ON app_restore_reviews
WHEN EXISTS(SELECT 1 FROM app_recovery_documents d JOIN restore_suppressions s ON s.kind='visitor' AND s.subject_id=d.visitor_id WHERE d.point_id=NEW.point_id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_app_restore_confirm BEFORE UPDATE ON app_restore_reviews WHEN NEW.status='applied'
 AND EXISTS(SELECT 1 FROM app_recovery_documents d JOIN restore_suppressions s ON s.kind='visitor' AND s.subject_id=d.visitor_id WHERE d.point_id=NEW.point_id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;

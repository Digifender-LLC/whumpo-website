-- WH-018 platform account export and resumable account closure (current schema input).
-- Reviews are short-lived, owner-bound exact presentations: a content-free binding digest over the scope an owner saw.
-- No credential, Chat text, filename, object key or provider identifier is stored here.
CREATE TABLE account_lifecycle_reviews (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('export','closure')),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json) AND length(CAST(binding_json AS BLOB))<=16384),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+600)
) STRICT;
CREATE INDEX account_lifecycle_reviews_owner ON account_lifecycle_reviews(user_id,kind,expires_at);
CREATE TRIGGER account_lifecycle_reviews_immutable BEFORE UPDATE ON account_lifecycle_reviews
BEGIN SELECT RAISE(ABORT,'account_lifecycle_review_immutable'); END;
CREATE TRIGGER account_lifecycle_reviews_capacity BEFORE INSERT ON account_lifecycle_reviews
WHEN (SELECT count(*) FROM account_lifecycle_reviews WHERE user_id=NEW.user_id)>=20
BEGIN SELECT RAISE(ABORT,'account_lifecycle_review_capacity'); END;

-- One closure per account id. Deliberately WITHOUT a foreign key to users: the closure and its step journal are the
-- final deletion receipt and must survive the account cascade. Counts only; never names, emails or content.
-- States: closing (steps running), waiting (unresolved operation or pending provider revocation),
-- blocked (preservation hold or retained record that needs an operator), complete (primary account rows deleted).
CREATE TABLE account_closures (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL UNIQUE CHECK(length(account_id) BETWEEN 1 AND 128),
 policy_version INTEGER NOT NULL CHECK(policy_version=1),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 obligations_json TEXT NOT NULL CHECK(json_valid(obligations_json) AND length(CAST(obligations_json AS BLOB))<=4096),
 state TEXT NOT NULL CHECK(state IN ('closing','waiting','blocked','complete')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
 completed_at INTEGER CHECK(completed_at IS NULL OR completed_at>=created_at),
 CHECK((state='complete')=(completed_at IS NOT NULL))
) STRICT;
CREATE TRIGGER account_closures_update BEFORE UPDATE ON account_closures
WHEN NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.policy_version IS NOT OLD.policy_version
 OR NEW.review_digest IS NOT OLD.review_digest OR NEW.obligations_json IS NOT OLD.obligations_json OR NEW.created_at IS NOT OLD.created_at
 OR NEW.revision!=OLD.revision+1 OR OLD.state='complete'
BEGIN SELECT RAISE(ABORT,'account_closure_immutable'); END;
CREATE TRIGGER account_closures_retained BEFORE DELETE ON account_closures
BEGIN SELECT RAISE(ABORT,'account_closure_retained'); END;

-- Ordered, idempotent closure journal. Each step is re-run on resume until it reports done; detail is content-free counts.
CREATE TABLE account_closure_steps (
 closure_id TEXT NOT NULL REFERENCES account_closures(id),
 step TEXT NOT NULL CHECK(step IN ('freeze','withdraw','credentials','holds','operations','purge')),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 6),
 state TEXT NOT NULL CHECK(state IN ('pending','done','waiting','blocked')),
 detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND json_type(detail_json)='object' AND length(CAST(detail_json AS BLOB))<=2048),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 PRIMARY KEY(closure_id,step),
 UNIQUE(closure_id,position)
) STRICT;
CREATE TRIGGER account_closure_steps_update BEFORE UPDATE ON account_closure_steps
WHEN NEW.closure_id IS NOT OLD.closure_id OR NEW.step IS NOT OLD.step OR NEW.position IS NOT OLD.position OR OLD.state='done'
BEGIN SELECT RAISE(ABORT,'account_closure_immutable'); END;
CREATE TRIGGER account_closure_steps_retained BEFORE DELETE ON account_closure_steps
BEGIN SELECT RAISE(ABORT,'account_closure_retained'); END;

-- WH-019 restore suppression ledger (docs/account-closure.md#wh-019-restore-safe-erasure-and-revocation-suppression--october-4-2026-utc).
-- One content-free row per erased or revoked subject: an opaque identifier, what happened to it and, for staff grants,
-- the access revision that ended the grant. No names, values, filenames, object keys, ciphertext or tokens. Rows are
-- written by the triggers below inside the same transaction as the erasure/revocation (every path, including cascades),
-- are never updated except to raise a staff revision, are never deleted and have no foreign key, so they survive the
-- account cascade. Guards consult the ledger inside every later commit, so a logical restore (re-inserting an older row,
-- un-revoking a visitor or token, replaying an older staff grant) aborts with `restore_suppressed`; the operator replay
-- (src/restore-suppression.ts) applies the current ledger to an isolated whole-database candidate before admission.
CREATE TABLE restore_suppressions (
 kind TEXT NOT NULL CHECK(kind IN ('account','project','visitor','staff','record','file','github_token','cloudflare_token','report_contact','abuse_report')),
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
-- WH-016: an operator erasure of an abuse report's optional reporter email (src/safety-cases.ts). The subject is the
-- report identifier; the address itself is never recorded.
CREATE TRIGGER restore_suppress_report_contact AFTER UPDATE OF reporter_email ON abuse_reports WHEN OLD.reporter_email IS NOT NULL AND NEW.reporter_email IS NULL
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('report_contact',OLD.id,'deleted',unixepoch()); END;
-- WH-016 abuse-report retention deletion (src/abuse-reports.ts cleanup), keyed by the report identifier.
CREATE TRIGGER restore_suppress_abuse_report AFTER DELETE ON abuse_reports
BEGIN INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('abuse_report',OLD.id,'deleted',unixepoch()); END;

-- Consultation inside later commits: an erased or revoked subject cannot come back through a logical restore.
-- Opaque identifiers are random and never reused, so a legitimate new row never matches.
CREATE TRIGGER restore_guard_account BEFORE INSERT ON users WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='account' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_abuse_report BEFORE INSERT ON abuse_reports WHEN EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='abuse_report' AND subject_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'restore_suppressed'); END;
CREATE TRIGGER restore_guard_report_contact BEFORE INSERT ON abuse_reports WHEN NEW.reporter_email IS NOT NULL AND EXISTS(SELECT 1 FROM restore_suppressions WHERE kind='report_contact' AND subject_id=NEW.id)
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

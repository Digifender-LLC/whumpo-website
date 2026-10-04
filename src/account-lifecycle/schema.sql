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

-- Always-empty assertion: ordinary workspace batches insert a row only when the account is closing, which aborts the
-- whole batch atomically with the domain statements (stop new work, including delayed OAuth callbacks).
CREATE TABLE account_closure_admission_checks (denied INTEGER NOT NULL CHECK(denied=1)) STRICT;
CREATE TRIGGER account_closure_admission_denied BEFORE INSERT ON account_closure_admission_checks
BEGIN SELECT RAISE(ABORT,'account_closing'); END;

-- WH-018 platform account export and resumable account closure (current schema input; created by schema batch 7, C1).
-- The closure record itself is `account_closures` in schema/platform.sql (schema batch 2). These tables add the exact review the
-- owner confirms, the per-account export allowance and the ordered cleanup journal.

-- Reviews are short-lived, owner-bound exact presentations: a content-free binding over the scope an owner saw.
-- `scope` is 'account' (the whole account) or 'project' (one project's portable delivery, WH-187, which reuses this review, proof and
-- allowance and so adds no schema). No credential, Chat text, filename, object key or provider identifier is stored here.
CREATE TABLE account_lifecycle_reviews (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('export','closure')),
 scope TEXT NOT NULL DEFAULT 'account' CHECK(scope IN ('account','project')),
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 binding_json TEXT NOT NULL CHECK(json_valid(binding_json) AND length(CAST(binding_json AS BLOB))<=16384),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+600),
 CHECK((scope='project')=(project_id IS NOT NULL)),
 CHECK(kind='export' OR scope='account')
) STRICT;
CREATE INDEX account_lifecycle_reviews_owner ON account_lifecycle_reviews(user_id,kind,expires_at);
CREATE INDEX account_lifecycle_reviews_project ON account_lifecycle_reviews(project_id) WHERE project_id IS NOT NULL;
-- A review is never edited; the download consumes it by deleting the row.
CREATE TRIGGER account_lifecycle_reviews_immutable BEFORE UPDATE ON account_lifecycle_reviews
BEGIN SELECT RAISE(ABORT,'account_lifecycle_review_immutable'); END;
CREATE TRIGGER account_lifecycle_reviews_capacity BEFORE INSERT ON account_lifecycle_reviews
WHEN (SELECT count(*) FROM account_lifecycle_reviews WHERE user_id=NEW.user_id)>=20
BEGIN SELECT RAISE(ABORT,'account_lifecycle_review_capacity'); END;

-- Per-account monthly export allowance: each download consumes its exact review (single use) and one of 10 monthly downloads, and each
-- exported photo read draws on this account's 5,000 monthly reads before the platform-wide storage ceiling, so repeated exports by one
-- account cannot exhaust shared capacity. Counters only; cascades with the account.
CREATE TABLE account_export_usage (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 period TEXT NOT NULL CHECK(length(period)=7 AND period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
 downloads INTEGER NOT NULL DEFAULT 0 CHECK(downloads BETWEEN 0 AND 10),
 photo_reads INTEGER NOT NULL DEFAULT 0 CHECK(photo_reads BETWEEN 0 AND 5000),
 PRIMARY KEY(user_id,period)
) STRICT;

-- Ordered, idempotent closure journal. Each step is re-run on resume until it reports done; detail is content-free counts.
-- Deliberately keyed to account_closures (not users): the journal is part of the final deletion receipt and survives the account cascade.
-- Step state: pending, done, waiting (unresolved operation or pending provider revocation) or blocked (preservation hold or a retained
-- record that needs an operator). The closure row only moves through its own forward states; a waiting or blocked step leaves it quiescing.
CREATE TABLE account_closure_steps (
 closure_id TEXT NOT NULL REFERENCES account_closures(closure_id),
 step TEXT NOT NULL CHECK(step IN ('freeze','withdraw','credentials','holds','operations','purge')),
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 6),
 state TEXT NOT NULL CHECK(state IN ('pending','done','waiting','blocked')),
 detail_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(detail_json) AND json_type(detail_json)='object' AND length(CAST(detail_json AS BLOB))<=2048),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 -- Who ran the latest journal write: the owner's session or the hourly maintenance continuation (NULL until first run).
 last_origin TEXT CHECK(last_origin IS NULL OR last_origin IN ('owner','maintenance')),
 PRIMARY KEY(closure_id,step),
 UNIQUE(closure_id,position)
) STRICT;
CREATE TRIGGER account_closure_steps_update BEFORE UPDATE ON account_closure_steps
WHEN NEW.closure_id IS NOT OLD.closure_id OR NEW.step IS NOT OLD.step OR NEW.position IS NOT OLD.position OR OLD.state='done'
BEGIN SELECT RAISE(ABORT,'account_closure_step_immutable'); END;
CREATE TRIGGER account_closure_steps_retained BEFORE DELETE ON account_closure_steps
BEGIN SELECT RAISE(ABORT,'account_closure_step_retained'); END;

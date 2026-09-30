-- Internal reviews only. No notice, restriction, or inference admission is enabled.
CREATE TABLE fair_use_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100),
 plan_id TEXT NOT NULL CHECK(plan_id IN ('starter','personal','business','business-pro')),
 category TEXT NOT NULL CHECK(category IN ('unrelated_chat','project_churn','legitimate_capacity')),
 opened_by TEXT NOT NULL CHECK(length(opened_by) BETWEEN 1 AND 100),
 context TEXT NOT NULL CHECK(length(context) BETWEEN 1 AND 2000),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
 outcome TEXT CHECK(outcome IN ('legitimate_use','insufficient_evidence','confirmed_pattern')),
 resolution TEXT CHECK(length(resolution) BETWEEN 1 AND 2000),
 resolved_by TEXT CHECK(length(resolved_by) BETWEEN 1 AND 100),
 resolved_at TEXT,
 CHECK((state='open' AND outcome IS NULL AND resolution IS NULL AND resolved_by IS NULL AND resolved_at IS NULL AND revision=0) OR
       (state='resolved' AND outcome IS NOT NULL AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND revision=1))
);
CREATE INDEX fair_use_reviews_owner ON fair_use_reviews(user_id,created_at,id);
CREATE TRIGGER fair_use_review_insert BEFORE INSERT ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'review_must_start_open') WHERE NEW.state!='open' OR NEW.revision!=0;
END;
CREATE TRIGGER fair_use_review_update BEFORE UPDATE ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'immutable_review') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.policy_version IS NOT OLD.policy_version OR NEW.plan_id IS NOT OLD.plan_id OR NEW.category IS NOT OLD.category OR NEW.opened_by IS NOT OLD.opened_by OR NEW.context IS NOT OLD.context OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'review_already_resolved') WHERE OLD.state!='open' OR NEW.state!='resolved' OR NEW.revision!=OLD.revision+1;
END;

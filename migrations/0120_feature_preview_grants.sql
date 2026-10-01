-- Explicit operator-created private-test inclusion; never a subscription or an action approval.
CREATE TABLE feature_preview_grants (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 contract_version INTEGER NOT NULL CHECK(contract_version=1),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 feature_id TEXT NOT NULL CHECK(length(feature_id) BETWEEN 1 AND 80),
 operation TEXT NOT NULL CHECK(operation IN ('connect','read','prepare','confirm','dispatch')),
 purpose TEXT NOT NULL CHECK(purpose='private-test-acceptance'),
 review_reference TEXT NOT NULL CHECK(length(review_reference) BETWEEN 1 AND 200),
 starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer'),
 ends_at INTEGER NOT NULL CHECK(typeof(ends_at)='integer' AND ends_at>starts_at AND ends_at-starts_at<=604800),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer'),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>=created_at))
);
CREATE INDEX feature_preview_scope ON feature_preview_grants(user_id,project_id,feature_id,operation,ends_at);
CREATE TRIGGER feature_preview_admit BEFORE INSERT ON feature_preview_grants BEGIN
 SELECT RAISE(ABORT,'feature_preview_owner') WHERE NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'feature_preview_initial') WHERE NEW.revoked_at IS NOT NULL;
 SELECT RAISE(ABORT,'feature_preview_capacity') WHERE (SELECT count(*) FROM feature_preview_grants WHERE user_id=NEW.user_id)>=1000 OR (SELECT count(*) FROM feature_preview_grants)>=20000;
END;
CREATE TRIGGER feature_preview_immutable BEFORE UPDATE ON feature_preview_grants
WHEN NEW.id IS NOT OLD.id OR NEW.contract_version IS NOT OLD.contract_version OR NEW.user_id IS NOT OLD.user_id
 OR NEW.project_id IS NOT OLD.project_id OR NEW.feature_id IS NOT OLD.feature_id OR NEW.operation IS NOT OLD.operation
 OR NEW.purpose IS NOT OLD.purpose OR NEW.review_reference IS NOT OLD.review_reference
 OR NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.created_at IS NOT OLD.created_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT,'feature_preview_immutable'); END;
-- Retain terminal identities so a retry cannot recreate a revoked or expired grant.
CREATE TRIGGER feature_preview_retained BEFORE DELETE ON feature_preview_grants
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 AND (OLD.project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'feature_preview_retained'); END;

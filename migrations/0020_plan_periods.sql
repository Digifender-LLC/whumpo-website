CREATE TABLE plan_grants (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 plan_id TEXT NOT NULL CHECK(plan_id IN ('launch','studio')),
 reference TEXT NOT NULL UNIQUE CHECK(length(reference) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL
);
CREATE INDEX plan_grants_period ON plan_grants(user_id,period);
CREATE TRIGGER plan_grant_immutable BEFORE UPDATE ON plan_grants BEGIN SELECT RAISE(ABORT,'plan_grant_immutable'); END;
CREATE TRIGGER plan_grant_delete_guard BEFORE DELETE ON plan_grants
WHEN EXISTS(SELECT 1 FROM billing_accounts WHERE user_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'plan_grant_immutable'); END;
CREATE TRIGGER plan_granted AFTER INSERT ON plan_grants BEGIN
 INSERT INTO billing_ledger(id,user_id,period,event,quota_delta,credits_delta,created_at)
 VALUES('plan:'||NEW.id,NEW.user_id,NEW.period,'plan_entitlement',MAX(0,(CASE NEW.plan_id WHEN 'studio' THEN 800 ELSE 250 END)-COALESCE((SELECT allowance FROM usage_periods WHERE user_id=NEW.user_id AND period=NEW.period),(CASE NEW.plan_id WHEN 'studio' THEN 800 ELSE 250 END))),0,NEW.created_at);
 UPDATE usage_periods SET allowance=MAX(allowance,CASE NEW.plan_id WHEN 'studio' THEN 800 ELSE 250 END) WHERE user_id=NEW.user_id AND period=NEW.period;
END;
-- Publication authorization reads current-period receipts, never a stale plan cache.
DROP TRIGGER publication_confirm_guard;
CREATE TRIGGER publication_confirm_guard BEFORE UPDATE ON publication_actions
BEGIN
 SELECT RAISE(ABORT,'publication_expired') WHERE NEW.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'publication_version') WHERE NEW.kind!='unpublish' AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'published_site_quota') WHERE NEW.kind!='unpublish'
 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL)
 AND (SELECT COUNT(*) FROM publications s JOIN projects p ON p.id=s.project_id WHERE p.owner_user_id=NEW.user_id AND s.version_id IS NOT NULL AND s.project_id!=NEW.project_id)>=COALESCE((SELECT MAX(CASE plan_id WHEN 'studio' THEN 10 ELSE 3 END) FROM plan_grants WHERE user_id=NEW.user_id AND period=strftime('%Y-%m','now')),1);
END;

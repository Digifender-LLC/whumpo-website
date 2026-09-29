-- Immutable catalogue version for test entitlements. Storage/domain figures are separate launch targets.
CREATE TABLE plan_catalog (
 id TEXT PRIMARY KEY,
 tier INTEGER NOT NULL,
 monthly_units INTEGER NOT NULL CHECK(monthly_units>0),
 published_sites INTEGER NOT NULL CHECK(published_sites>0)
);
INSERT INTO plan_catalog VALUES
 ('explore',0,50,1),('starter',1,250,1),('personal',2,800,5),
 ('business',3,1600,10),('business-pro',4,3200,25),
 ('launch',1,250,3),('studio',2,800,10);
CREATE TRIGGER plan_catalog_immutable BEFORE UPDATE ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;
CREATE TRIGGER plan_catalog_delete_guard BEFORE DELETE ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;
-- Rebuild only the receipt table; retain every receipt and the historical billing ledger.
DROP TRIGGER publication_confirm_guard;
DROP TRIGGER plan_grant_immutable;
DROP TRIGGER plan_grant_delete_guard;
DROP TRIGGER plan_granted;
CREATE TABLE plan_grants_next (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
 period TEXT NOT NULL CHECK(period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]' AND substr(period,6,2) BETWEEN '01' AND '12'),
 plan_id TEXT NOT NULL REFERENCES plan_catalog(id) CHECK(plan_id!='explore'),
 reference TEXT NOT NULL UNIQUE CHECK(length(reference) BETWEEN 1 AND 200),
 created_at TEXT NOT NULL
);
INSERT INTO plan_grants_next SELECT * FROM plan_grants;
DROP TABLE plan_grants;
ALTER TABLE plan_grants_next RENAME TO plan_grants;
CREATE INDEX plan_grants_period ON plan_grants(user_id,period);
CREATE TRIGGER plan_grant_immutable BEFORE UPDATE ON plan_grants BEGIN SELECT RAISE(ABORT,'plan_grant_immutable'); END;
CREATE TRIGGER plan_grant_delete_guard BEFORE DELETE ON plan_grants
WHEN EXISTS(SELECT 1 FROM billing_accounts WHERE user_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'plan_grant_immutable'); END;
CREATE TRIGGER plan_granted AFTER INSERT ON plan_grants BEGIN
 INSERT INTO billing_ledger(id,user_id,period,event,quota_delta,credits_delta,created_at)
 VALUES('plan:'||NEW.id,NEW.user_id,NEW.period,'plan_entitlement',MAX(0,(SELECT monthly_units FROM plan_catalog WHERE id=NEW.plan_id)-COALESCE((SELECT allowance FROM usage_periods WHERE user_id=NEW.user_id AND period=NEW.period),(SELECT monthly_units FROM plan_catalog WHERE id=NEW.plan_id))),0,NEW.created_at);
 UPDATE usage_periods SET allowance=MAX(allowance,(SELECT monthly_units FROM plan_catalog WHERE id=NEW.plan_id)) WHERE user_id=NEW.user_id AND period=NEW.period;
END;
-- Publication authorization reads current-period receipts, never a stale plan cache.
CREATE TRIGGER publication_confirm_guard BEFORE UPDATE ON publication_actions
BEGIN
 SELECT RAISE(ABORT,'publication_expired') WHERE NEW.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'publication_version') WHERE NEW.kind!='unpublish' AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'published_site_quota') WHERE NEW.kind!='unpublish'
 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL)
 AND (SELECT COUNT(*) FROM publications s JOIN projects p ON p.id=s.project_id WHERE p.owner_user_id=NEW.user_id AND s.version_id IS NOT NULL AND s.project_id!=NEW.project_id)>=COALESCE((SELECT MAX(c.published_sites) FROM plan_grants g JOIN plan_catalog c ON c.id=g.plan_id WHERE user_id=NEW.user_id AND period=strftime('%Y-%m','now')),1);
END;

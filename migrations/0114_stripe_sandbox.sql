CREATE TABLE stripe_customers (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 customer_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 lease TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER stripe_customer_identity BEFORE UPDATE ON stripe_customers
WHEN NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS NOT OLD.customer_id)
BEGIN SELECT RAISE(ABORT,'stripe_customer_identity'); END;
CREATE TABLE stripe_subscription_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plan_catalog(id),
 interval TEXT NOT NULL CHECK(interval IN ('month','year')),
 price_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','expired')),
 session_id TEXT UNIQUE,
 subscription_id TEXT UNIQUE
);
CREATE UNIQUE INDEX stripe_pending_order ON stripe_subscription_orders(user_id) WHERE state='pending';
CREATE TRIGGER stripe_order_identity BEFORE UPDATE ON stripe_subscription_orders
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.plan_id!=OLD.plan_id OR NEW.interval!=OLD.interval OR NEW.price_id!=OLD.price_id OR NEW.amount_cents!=OLD.amount_cents OR NEW.created_at!=OLD.created_at
 OR (OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id)
 OR (OLD.subscription_id IS NOT NULL AND NEW.subscription_id IS NOT OLD.subscription_id)
 OR (OLD.state!='pending' AND NEW.state!=OLD.state)
BEGIN SELECT RAISE(ABORT,'stripe_order_identity'); END;
CREATE TABLE stripe_subscriptions (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES stripe_subscription_orders(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 cancel_at_period_end INTEGER NOT NULL CHECK(cancel_at_period_end IN (0,1)),
 period_end INTEGER NOT NULL,
 latest_invoice_id TEXT,
 payment_status TEXT,
 updated_at INTEGER NOT NULL
);
CREATE TABLE stripe_paid_invoices (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES stripe_subscriptions(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plan_catalog(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 interval TEXT NOT NULL CHECK(interval IN ('month','year')),
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 hosted_url TEXT,
 created_at INTEGER NOT NULL
);
CREATE INDEX stripe_invoice_coverage ON stripe_paid_invoices(user_id,starts_at,ends_at);
CREATE TRIGGER stripe_invoice_immutable BEFORE UPDATE ON stripe_paid_invoices BEGIN SELECT RAISE(ABORT,'stripe_invoice_immutable'); END;
CREATE TRIGGER stripe_invoice_delete_guard BEFORE DELETE ON stripe_paid_invoices
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'stripe_invoice_immutable'); END;
-- Exact paid service intervals coexist with legacy calendar-month receipts.
CREATE VIEW plan_entitlements AS
 SELECT user_id,plan_id,unixepoch(period||'-01') starts_at,unixepoch(period||'-01','+1 month') ends_at FROM plan_grants
 UNION ALL SELECT user_id,plan_id,starts_at,ends_at FROM stripe_paid_invoices;
DROP TRIGGER publication_confirm_guard;
CREATE TRIGGER publication_confirm_guard BEFORE UPDATE ON publication_actions
BEGIN
 SELECT RAISE(ABORT,'publication_expired') WHERE NEW.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'publication_version') WHERE NEW.kind!='unpublish' AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'published_site_quota') WHERE NEW.kind!='unpublish'
 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL)
 AND (SELECT COUNT(*) FROM publications s JOIN projects p ON p.id=s.project_id WHERE p.owner_user_id=NEW.user_id AND s.version_id IS NOT NULL AND s.project_id!=NEW.project_id)>=COALESCE((SELECT MAX(c.published_sites) FROM plan_entitlements g JOIN plan_catalog c ON c.id=g.plan_id WHERE user_id=NEW.user_id AND starts_at<=unixepoch() AND ends_at>unixepoch()),1);
END;

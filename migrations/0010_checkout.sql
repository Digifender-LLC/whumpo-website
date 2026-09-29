-- Test checkout only. Amounts and units are immutable server-owned order data.
CREATE TABLE checkout_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 product TEXT NOT NULL CHECK(product = 'credits-100'),
 amount_cents INTEGER NOT NULL CHECK(amount_cents = 500),
 units INTEGER NOT NULL CHECK(units = 100),
 currency TEXT NOT NULL CHECK(currency = 'usd'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled')),
 session_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 fulfilled_at INTEGER
);
CREATE INDEX checkout_owner ON checkout_orders(user_id, created_at);
CREATE TRIGGER checkout_quota BEFORE INSERT ON checkout_orders
WHEN NOT EXISTS(SELECT 1 FROM checkout_orders WHERE id = NEW.id)
BEGIN
 SELECT RAISE(ABORT, 'checkout_quota') WHERE (SELECT COUNT(*) FROM checkout_orders WHERE user_id = NEW.user_id) >= 100;
 SELECT RAISE(ABORT, 'checkout_daily_quota') WHERE (SELECT COUNT(*) FROM checkout_orders WHERE user_id = NEW.user_id AND created_at > NEW.created_at - 86400) >= 5;
END;
CREATE TRIGGER checkout_identity BEFORE UPDATE ON checkout_orders
BEGIN
 SELECT RAISE(ABORT, 'checkout_immutable') WHERE NEW.id != OLD.id OR NEW.user_id != OLD.user_id OR NEW.product != OLD.product OR NEW.amount_cents != OLD.amount_cents OR NEW.units != OLD.units OR NEW.currency != OLD.currency OR NEW.created_at != OLD.created_at OR (OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id) OR (OLD.status = 'fulfilled' AND (NEW.status != OLD.status OR NEW.fulfilled_at IS NOT OLD.fulfilled_at));
END;

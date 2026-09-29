CREATE TABLE billing_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'explore' CHECK(plan_id IN ('explore','launch','studio')),
  overage_enabled INTEGER NOT NULL DEFAULT 0 CHECK(overage_enabled IN (0,1)),
  credits_available INTEGER NOT NULL DEFAULT 0 CHECK(credits_available >= 0),
  credits_reserved INTEGER NOT NULL DEFAULT 0 CHECK(credits_reserved >= 0),
  CHECK(credits_available + credits_reserved <= 1000000)
);
CREATE TABLE usage_periods (
  user_id TEXT NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  allowance INTEGER NOT NULL CHECK(allowance BETWEEN 0 AND 1000000),
  spent INTEGER NOT NULL DEFAULT 0 CHECK(spent >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0),
  PRIMARY KEY(user_id, period),
  CHECK(spent + reserved <= allowance)
);
CREATE TABLE usage_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  quoted_units INTEGER NOT NULL CHECK(quoted_units BETWEEN 1 AND 10000),
  quota_reserved INTEGER NOT NULL CHECK(quota_reserved >= 0),
  credits_reserved INTEGER NOT NULL CHECK(credits_reserved >= 0),
  status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','dispatched','uncertain','settled','released')),
  actual_units INTEGER,
  quota_charged INTEGER NOT NULL DEFAULT 0 CHECK(quota_charged >= 0),
  credits_charged INTEGER NOT NULL DEFAULT 0 CHECK(credits_charged >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id, period) REFERENCES usage_periods(user_id, period) ON DELETE CASCADE,
  CHECK(quota_reserved + credits_reserved = quoted_units),
  CHECK(actual_units IS NULL OR (actual_units BETWEEN 0 AND quoted_units AND quota_charged + credits_charged = actual_units)),
  CHECK((status IN ('settled','released')) = (actual_units IS NOT NULL)),
  CHECK(status != 'released' OR actual_units = 0)
);
CREATE INDEX usage_operations_owner ON usage_operations(user_id, created_at DESC);
CREATE INDEX usage_operations_expiry ON usage_operations(user_id, status, expires_at);
CREATE TABLE billing_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
  operation_id TEXT,
  period TEXT,
  event TEXT NOT NULL,
  quota_delta INTEGER NOT NULL,
  credits_delta INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX billing_ledger_owner ON billing_ledger(user_id, created_at DESC);
CREATE TRIGGER billing_ledger_immutable BEFORE UPDATE ON billing_ledger
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;
CREATE TRIGGER billing_ledger_delete_guard BEFORE DELETE ON billing_ledger
WHEN EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'ledger_immutable'); END;
CREATE TABLE credit_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES billing_accounts(user_id) ON DELETE CASCADE,
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 100000),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TRIGGER credit_grants_immutable BEFORE UPDATE ON credit_grants
BEGIN SELECT RAISE(ABORT, 'grant_immutable'); END;
CREATE TRIGGER credit_grants_delete_guard BEFORE DELETE ON credit_grants
WHEN EXISTS (SELECT 1 FROM billing_accounts WHERE user_id = OLD.user_id)
BEGIN SELECT RAISE(ABORT, 'grant_immutable'); END;
CREATE TRIGGER credit_granted AFTER INSERT ON credit_grants
BEGIN
  UPDATE billing_accounts SET credits_available = credits_available + NEW.units WHERE user_id = NEW.user_id;
  INSERT INTO billing_ledger (id,user_id,event,quota_delta,credits_delta,created_at)
    VALUES ('grant:' || NEW.id,NEW.user_id,'credit_grant',0,NEW.units,NEW.created_at);
END;
CREATE TRIGGER period_granted AFTER INSERT ON usage_periods
BEGIN
  INSERT INTO billing_ledger (id,user_id,period,event,quota_delta,credits_delta,created_at)
    VALUES ('period:' || NEW.user_id || ':' || NEW.period,NEW.user_id,NEW.period,'monthly_allowance',NEW.allowance,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER operation_limit BEFORE INSERT ON usage_operations
WHEN (SELECT COUNT(*) FROM usage_operations WHERE user_id = NEW.user_id AND period = NEW.period) >= 5000
BEGIN SELECT RAISE(ABORT, 'operation_limit'); END;
CREATE TRIGGER operation_reserved AFTER INSERT ON usage_operations
BEGIN
  UPDATE usage_periods SET reserved = reserved + NEW.quota_reserved WHERE user_id = NEW.user_id AND period = NEW.period;
  UPDATE billing_accounts SET credits_available = credits_available - NEW.credits_reserved, credits_reserved = credits_reserved + NEW.credits_reserved WHERE user_id = NEW.user_id;
  INSERT INTO billing_ledger (id,user_id,operation_id,period,event,quota_delta,credits_delta,created_at)
    VALUES (NEW.id || ':reserve',NEW.user_id,NEW.id,NEW.period,'reserved',-NEW.quota_reserved,-NEW.credits_reserved,NEW.created_at);
END;
CREATE TRIGGER operation_identity_immutable BEFORE UPDATE ON usage_operations
WHEN NEW.id != OLD.id OR NEW.user_id != OLD.user_id OR NEW.period != OLD.period OR NEW.request_hash != OLD.request_hash OR NEW.quoted_units != OLD.quoted_units OR NEW.quota_reserved != OLD.quota_reserved OR NEW.credits_reserved != OLD.credits_reserved
BEGIN SELECT RAISE(ABORT, 'operation_identity_immutable'); END;
CREATE TRIGGER operation_transition BEFORE UPDATE ON usage_operations
WHEN NOT (
  (OLD.status = 'reserved' AND NEW.status IN ('dispatched','released')) OR
  (OLD.status = 'dispatched' AND NEW.status IN ('settled','released','uncertain')) OR
  (OLD.status = 'uncertain' AND NEW.status IN ('settled','released'))
)
BEGIN SELECT RAISE(ABORT, 'invalid_operation_transition'); END;
CREATE TRIGGER operation_finished AFTER UPDATE OF status ON usage_operations
WHEN NEW.status IN ('settled','released')
BEGIN
  UPDATE usage_periods SET reserved = reserved - OLD.quota_reserved, spent = spent + NEW.quota_charged WHERE user_id = NEW.user_id AND period = NEW.period;
  UPDATE billing_accounts SET credits_available = credits_available + OLD.credits_reserved - NEW.credits_charged, credits_reserved = credits_reserved - OLD.credits_reserved WHERE user_id = NEW.user_id;
  INSERT INTO billing_ledger (id,user_id,operation_id,period,event,quota_delta,credits_delta,created_at)
    VALUES (NEW.id || ':finish',NEW.user_id,NEW.id,NEW.period,NEW.status,OLD.quota_reserved-NEW.quota_charged,OLD.credits_reserved-NEW.credits_charged,NEW.updated_at);
END;

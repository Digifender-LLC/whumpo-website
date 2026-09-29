-- Preserve spent units, holds, credits and historical periods. The ledger records
-- the increased current/future ceiling, including periods created by an old Worker.
CREATE TRIGGER IF NOT EXISTS explore_allowance_floor AFTER INSERT ON usage_periods
WHEN NEW.allowance = 25 AND NEW.period >= strftime('%Y-%m','now')
BEGIN
  INSERT INTO billing_ledger(id,user_id,period,event,quota_delta,credits_delta,created_at)
    VALUES('explore50:'||NEW.user_id||':'||NEW.period,NEW.user_id,NEW.period,'allowance_increase',25,0,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
  UPDATE usage_periods SET allowance=50 WHERE user_id=NEW.user_id AND period=NEW.period;
END;
INSERT INTO billing_ledger(id,user_id,period,event,quota_delta,credits_delta,created_at)
  SELECT 'explore50:'||user_id||':'||period,user_id,period,'allowance_increase',25,0,strftime('%Y-%m-%dT%H:%M:%fZ','now')
  FROM usage_periods WHERE allowance=25 AND period>=strftime('%Y-%m','now');
UPDATE usage_periods SET allowance=50 WHERE allowance=25 AND period>=strftime('%Y-%m','now');

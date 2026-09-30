-- Explicit owner action for already-revoked visitors; no visitor payload is retained.
CREATE TABLE app_owner_erasures (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 visitor_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))
);
CREATE INDEX app_owner_erasures_expiry ON app_owner_erasures(expires_at);
CREATE TRIGGER app_owner_erasure_admit BEFORE INSERT ON app_owner_erasures BEGIN
 SELECT RAISE(ABORT,'visitor_erasure_authority') WHERE NOT EXISTS(
  SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id
  JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id
  WHERE v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=1 AND a.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'visitor_erasure_capacity') WHERE (SELECT count(*) FROM app_owner_erasures)>=1000;
END;
CREATE TRIGGER app_owner_erasure_apply AFTER INSERT ON app_owner_erasures BEGIN
 DELETE FROM app_visitors WHERE id=NEW.visitor_id AND project_id=NEW.project_id AND revoked=1;
END;
CREATE TRIGGER app_owner_erasure_immutable BEFORE UPDATE ON app_owner_erasures
 BEGIN SELECT RAISE(ABORT,'visitor_erasure_immutable'); END;
CREATE TRIGGER app_owner_erasure_retention BEFORE DELETE ON app_owner_erasures
 WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 BEGIN SELECT RAISE(ABORT,'visitor_erasure_retention'); END;

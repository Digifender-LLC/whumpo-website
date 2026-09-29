CREATE TABLE usage_waivers (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL UNIQUE REFERENCES usage_operations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 period TEXT NOT NULL,
 quoted_units INTEGER NOT NULL,
 quota_reserved INTEGER NOT NULL,
 credits_reserved INTEGER NOT NULL,
 operation_updated_at TEXT NOT NULL,
 chat_revision INTEGER NOT NULL,
 reviewed_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 operator TEXT NOT NULL,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TRIGGER usage_waiver_guard BEFORE INSERT ON usage_waivers
BEGIN
 SELECT RAISE(ABORT,'usage_waiver_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM usage_operations o JOIN chat_turns t ON t.id=o.id AND t.user_id=o.user_id
 WHERE o.id=NEW.operation_id AND o.user_id=NEW.user_id AND o.status='uncertain' AND o.actual_units IS NULL
 AND o.updated_at=NEW.operation_updated_at AND o.updated_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes')
 AND o.request_hash=NEW.request_hash AND o.period=NEW.period AND o.quoted_units=NEW.quoted_units
 AND o.quota_reserved=NEW.quota_reserved AND o.credits_reserved=NEW.credits_reserved
 AND t.revision=NEW.chat_revision AND t.mode='ai' AND t.status='uncertain' AND t.input_tokens IS NULL AND t.output_tokens IS NULL);
END;
CREATE TRIGGER usage_waiver_apply AFTER INSERT ON usage_waivers
BEGIN
 UPDATE usage_operations SET status='released',actual_units=0,quota_charged=0,credits_charged=0,updated_at=NEW.created_at WHERE id=NEW.operation_id AND user_id=NEW.user_id;
 UPDATE chat_turns SET status='failed',assistant_text='An operator waived this unresolved AI request. No build units or credits were charged; the provider usage is still unknown. This message will not be retried. Saved work and reviews are preserved. Check /versions, /dns, /hosting and /backups before making another request.' WHERE id=NEW.operation_id AND user_id=NEW.user_id;
 INSERT INTO activity_events(id,user_id,action,summary,created_at) VALUES('usage-waiver:'||NEW.id,NEW.user_id,'usage.waived','Waived an unresolved AI usage hold; provider usage remains unknown',NEW.created_at);
END;
CREATE TRIGGER usage_waiver_immutable BEFORE UPDATE ON usage_waivers
BEGIN SELECT RAISE(ABORT,'usage_waiver_immutable'); END;
CREATE TRIGGER usage_waiver_delete_guard BEFORE DELETE ON usage_waivers
WHEN EXISTS(SELECT 1 FROM usage_operations WHERE id=OLD.operation_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'usage_waiver_immutable'); END;
-- A late model result must not commit draft statements after its turn closed.
-- The result update shares the same transaction as all proposed draft statements.
CREATE TRIGGER chat_result_open BEFORE UPDATE OF input_tokens,output_tokens ON chat_turns
WHEN OLD.mode='ai' AND (OLD.status!='pending' OR NOT EXISTS(SELECT 1 FROM usage_operations o WHERE o.id=OLD.id AND o.user_id=OLD.user_id AND o.status IN ('dispatched','uncertain')))
BEGIN SELECT RAISE(ABORT,'chat_result_closed'); END;

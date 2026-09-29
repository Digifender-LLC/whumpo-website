-- One bounded read-follow-up per chat turn. This receipt is private evidence,
-- not authority to replay a model call after a timeout.
CREATE TABLE agent_inspections (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 result_text TEXT NOT NULL CHECK(length(CAST(result_text AS BLOB))<=8000),
 input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),
 output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER agent_inspection_admit BEFORE INSERT ON agent_inspections BEGIN
 SELECT RAISE(ABORT,'agent_inspection_closed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN usage_operations o ON o.id=t.id JOIN inference_calls i ON i.id=t.id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
   AND o.user_id=NEW.user_id AND o.status='dispatched' AND i.user_id=NEW.user_id AND i.status='dispatched');
END;
CREATE TRIGGER agent_inspection_immutable BEFORE UPDATE ON agent_inspections BEGIN SELECT RAISE(ABORT,'agent_inspection_immutable'); END;

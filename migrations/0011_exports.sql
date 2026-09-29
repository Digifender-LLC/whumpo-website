CREATE TABLE chat_exports (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE
);
CREATE TRIGGER chat_export_owner BEFORE INSERT ON chat_exports
BEGIN
 SELECT RAISE(ABORT, 'export_owner') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN site_versions v ON v.id=NEW.version_id
  JOIN projects p ON p.id=v.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id
 );
END;
CREATE TRIGGER chat_export_immutable BEFORE UPDATE ON chat_exports
BEGIN SELECT RAISE(ABORT, 'export_immutable'); END;

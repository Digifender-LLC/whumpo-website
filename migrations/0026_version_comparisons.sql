CREATE TABLE chat_comparisons (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 baseline_id TEXT REFERENCES site_versions(id) ON DELETE CASCADE
);
CREATE TRIGGER chat_comparison_owner BEFORE INSERT ON chat_comparisons
BEGIN
 SELECT RAISE(ABORT,'comparison_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN site_versions v ON v.id=NEW.version_id JOIN projects p ON p.id=v.project_id WHERE t.id=NEW.turn_id AND t.user_id=p.owner_user_id AND (NEW.baseline_id IS NULL OR EXISTS(SELECT 1 FROM site_versions b WHERE b.id=NEW.baseline_id AND b.project_id=v.project_id)));
END;
CREATE TRIGGER chat_comparison_immutable BEFORE UPDATE ON chat_comparisons
BEGIN SELECT RAISE(ABORT,'comparison_immutable'); END;

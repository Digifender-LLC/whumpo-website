ALTER TABLE projects ADD COLUMN details_revision INTEGER NOT NULL DEFAULT 0;
CREATE TRIGGER project_details_revision AFTER UPDATE OF name,purpose ON projects
WHEN NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose
BEGIN
 UPDATE projects SET details_revision=OLD.details_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.owner_user_id,NEW.id,'project.details.updated','Updated project details',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

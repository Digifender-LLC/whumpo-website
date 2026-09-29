DROP TRIGGER project_details_revision;
CREATE TRIGGER project_details_revision AFTER UPDATE OF name,purpose,audience,style_notes,preferred_theme ON projects
WHEN NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose OR NEW.audience<>OLD.audience OR NEW.style_notes<>OLD.style_notes OR NEW.preferred_theme<>OLD.preferred_theme
BEGIN
 UPDATE projects SET details_revision=OLD.details_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.owner_user_id,NEW.id,'project.details.updated','Updated project details',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

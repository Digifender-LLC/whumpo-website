-- Persist write intent even when a structured replacement happens to contain one plain paragraph.
ALTER TABLE cms_draft_requests ADD COLUMN content_format TEXT NOT NULL DEFAULT 'plain' CHECK(content_format IN ('plain','structured'));
ALTER TABLE cms_edit_requests ADD COLUMN content_format TEXT NOT NULL DEFAULT 'plain' CHECK(content_format IN ('plain','structured'));
CREATE TRIGGER cms_draft_format_immutable BEFORE UPDATE OF content_format ON cms_draft_requests WHEN NEW.content_format<>OLD.content_format
 BEGIN SELECT RAISE(ABORT,'cms_draft_format_immutable'); END;
CREATE TRIGGER cms_edit_format_immutable BEFORE UPDATE OF content_format ON cms_edit_requests WHEN NEW.content_format<>OLD.content_format
 BEGIN SELECT RAISE(ABORT,'cms_edit_format_immutable'); END;

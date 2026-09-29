-- Contact forms are a reviewed runtime capability pinned to one publication revision.
CREATE TABLE contact_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 publication_revision INTEGER NOT NULL DEFAULT -1
);
CREATE TABLE contact_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 expected_revision INTEGER NOT NULL,
 publication_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
);
CREATE INDEX contact_reviews_owner ON contact_reviews(user_id,project_id);
CREATE TRIGGER contact_review_identity BEFORE UPDATE ON contact_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.enabled!=OLD.enabled OR NEW.expected_revision!=OLD.expected_revision OR NEW.publication_revision!=OLD.publication_revision OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'contact_review_changed'); END;
CREATE TRIGGER contact_review_confirm BEFORE UPDATE ON contact_reviews
BEGIN
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM contact_settings c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND c.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL AND revision=NEW.publication_revision);
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id);
END;
CREATE TRIGGER contact_review_apply AFTER UPDATE ON contact_reviews
BEGIN
 UPDATE contact_settings SET revision=revision+1,enabled=NEW.enabled,publication_revision=NEW.publication_revision WHERE project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('contact:'||NEW.id,NEW.user_id,NEW.project_id,'contact.settings',CASE WHEN NEW.enabled=1 THEN 'Enabled contact form for reviewed publication' ELSE 'Disabled contact form' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- Minimal receipts survive owner deletion to prevent retry resurrection and quota recycling.
CREATE TABLE contact_receipts (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX contact_receipts_project ON contact_receipts(project_id,created_at);
CREATE INDEX contact_receipts_expiry ON contact_receipts(expires_at);
CREATE TRIGGER contact_receipt_immutable BEFORE UPDATE ON contact_receipts
BEGIN SELECT RAISE(ABORT,'contact_receipt_immutable'); END;
CREATE TABLE contact_submissions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 settings_revision INTEGER NOT NULL,
 request_hash TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE INDEX contact_submissions_project ON contact_submissions(project_id,created_at DESC,id);
CREATE INDEX contact_submissions_expiry ON contact_submissions(expires_at);
CREATE TRIGGER contact_submission_guard BEFORE INSERT ON contact_submissions
WHEN NOT EXISTS(SELECT 1 FROM contact_submissions WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'contact_received') WHERE EXISTS(SELECT 1 FROM contact_receipts WHERE id=NEW.id);
 SELECT RAISE(ABORT,'contact_unavailable') WHERE NOT EXISTS(SELECT 1 FROM contact_settings c JOIN publications s ON s.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.revision=NEW.settings_revision AND c.enabled=1 AND s.version_id IS NOT NULL AND s.revision=c.publication_revision);
 SELECT RAISE(ABORT,'contact_capacity') WHERE (SELECT COUNT(*) FROM contact_receipts WHERE project_id=NEW.project_id)>=100 OR (SELECT COUNT(*) FROM contact_receipts)>=1000;
 SELECT RAISE(ABORT,'contact_rate') WHERE (SELECT COUNT(*) FROM contact_receipts WHERE project_id=NEW.project_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=20;
END;
CREATE TRIGGER contact_submission_immutable BEFORE UPDATE ON contact_submissions
BEGIN SELECT RAISE(ABORT,'contact_submission_immutable'); END;
CREATE TRIGGER contact_submission_receipt AFTER INSERT ON contact_submissions
BEGIN
 INSERT INTO contact_receipts(id,project_id,request_hash,created_at,expires_at) VALUES(NEW.id,NEW.project_id,NEW.request_hash,NEW.created_at,NEW.expires_at);
END;

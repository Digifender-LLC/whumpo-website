CREATE TABLE backend_form_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 revision INTEGER NOT NULL DEFAULT 0,
 review_id TEXT
);
CREATE TABLE backend_form_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 config_json TEXT CHECK(config_json IS NULL OR length(CAST(config_json AS BLOB))<=4096),
 site_revision INTEGER NOT NULL,
 backend_publication_id TEXT REFERENCES backend_publication_reviews(id),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((enabled=1 AND config_json IS NOT NULL AND backend_publication_id IS NOT NULL) OR (enabled=0 AND config_json IS NULL AND backend_publication_id IS NULL))
);
CREATE INDEX backend_form_reviews_project ON backend_form_reviews(project_id);
CREATE TRIGGER backend_form_admit BEFORE INSERT ON backend_form_reviews BEGIN
 SELECT RAISE(ABORT,'backend_form_owner') WHERE NOT EXISTS(SELECT 1 FROM projects p JOIN backend_form_settings s ON s.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision);
 SELECT RAISE(ABORT,'backend_form_targets') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications s JOIN backend_publications b ON b.project_id=s.project_id JOIN backend_publication_reviews r ON r.id=b.review_id WHERE s.project_id=NEW.project_id AND s.version_id IS NOT NULL AND s.revision=NEW.site_revision AND b.review_id=NEW.backend_publication_id AND r.user_id=NEW.user_id AND r.status='applied');
 SELECT RAISE(ABORT,'backend_form_capacity') WHERE (SELECT count(*) FROM backend_form_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM backend_form_reviews)>=1000;
 SELECT RAISE(ABORT,'backend_form_initial') WHERE NEW.status<>'pending';
END;
CREATE TRIGGER backend_form_immutable BEFORE UPDATE ON backend_form_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.enabled<>OLD.enabled OR NEW.config_json IS NOT OLD.config_json OR NEW.site_revision<>OLD.site_revision OR NEW.backend_publication_id IS NOT OLD.backend_publication_id OR NEW.base_revision<>OLD.base_revision OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'backend_form_immutable'); END;
CREATE TRIGGER backend_form_apply BEFORE UPDATE OF status ON backend_form_reviews BEGIN
 SELECT RAISE(ABORT,'backend_form_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM backend_form_settings s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision);
 SELECT RAISE(ABORT,'backend_form_targets') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications s JOIN backend_publications b ON b.project_id=s.project_id JOIN backend_publication_reviews r ON r.id=b.review_id WHERE s.project_id=NEW.project_id AND s.version_id IS NOT NULL AND s.revision=NEW.site_revision AND b.review_id=NEW.backend_publication_id AND r.user_id=NEW.user_id AND r.status='applied');
 UPDATE backend_form_settings SET review_id=NEW.id,revision=revision+1 WHERE project_id=NEW.project_id;
END;
CREATE VIEW backend_live_forms AS
 SELECT r.id,r.project_id,r.config_json,r.backend_publication_id,r.site_revision
 FROM backend_form_settings f JOIN backend_form_reviews r ON r.id=f.review_id JOIN projects p ON p.id=f.project_id AND p.owner_user_id=r.user_id JOIN publications s ON s.project_id=f.project_id JOIN backend_publications b ON b.project_id=f.project_id
 WHERE r.status='applied' AND r.enabled=1 AND s.version_id IS NOT NULL AND s.revision=r.site_revision AND b.review_id=r.backend_publication_id AND b.version_id IS NOT NULL;
ALTER TABLE site_health_checks ADD COLUMN form_review_id TEXT;
CREATE TRIGGER health_form_snapshot BEFORE INSERT ON site_health_checks WHEN NEW.form_review_id IS NOT (SELECT id FROM backend_live_forms WHERE project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'health_publication_changed'); END;
CREATE TRIGGER health_form_immutable BEFORE UPDATE ON site_health_checks WHEN NEW.form_review_id IS NOT OLD.form_review_id
 BEGIN SELECT RAISE(ABORT,'health_form_immutable'); END;

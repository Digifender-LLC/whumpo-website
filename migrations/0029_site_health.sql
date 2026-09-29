CREATE TABLE site_health_checks (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL,
 publication_revision INTEGER NOT NULL,
 contact_revision INTEGER NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('manual','publish','scheduled')),
 state TEXT NOT NULL DEFAULT 'checking' CHECK(state IN ('checking','healthy','unhealthy','superseded')),
 detail TEXT NOT NULL DEFAULT 'Checking the published page and photo responses',
 started_at TEXT NOT NULL,
 finished_at TEXT
);
CREATE INDEX site_health_project ON site_health_checks(project_id,started_at DESC,id DESC);
CREATE TABLE site_health_budget(day TEXT PRIMARY KEY,checks INTEGER NOT NULL CHECK(checks BETWEEN 1 AND 500));
CREATE TRIGGER site_health_claim BEFORE INSERT ON site_health_checks
BEGIN
 SELECT RAISE(ABORT,'health_publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id LEFT JOIN contact_settings c ON c.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.version_id=NEW.version_id AND s.revision=NEW.publication_revision AND COALESCE(c.revision,-1)=NEW.contact_revision);
 SELECT RAISE(ABORT,'health_cooldown') WHERE EXISTS(SELECT 1 FROM site_health_checks h WHERE h.project_id=NEW.project_id AND h.publication_revision=NEW.publication_revision AND h.contact_revision=NEW.contact_revision AND h.started_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;
CREATE TRIGGER site_health_budget_claim AFTER INSERT ON site_health_checks
BEGIN
 INSERT INTO site_health_budget(day,checks) VALUES(substr(NEW.started_at,1,10),1) ON CONFLICT(day) DO UPDATE SET checks=checks+1;
END;

CREATE TABLE backend_publications (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 review_id TEXT,
 version_id TEXT REFERENCES backend_versions(id),
 CHECK((review_id IS NULL)=(version_id IS NULL))
);
CREATE TABLE backend_publication_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 operation TEXT NOT NULL CHECK(operation IN ('publish','unpublish')),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 run_id TEXT REFERENCES backend_runs(id),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((operation='publish' AND run_id IS NOT NULL) OR (operation='unpublish' AND run_id IS NULL))
);
CREATE INDEX backend_publication_reviews_project ON backend_publication_reviews(project_id);
CREATE TRIGGER backend_publication_review_admit BEFORE INSERT ON backend_publication_reviews BEGIN
 SELECT RAISE(ABORT,'backend_publication_owner') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN backend_versions v ON v.project_id=p.id JOIN backend_publications b ON b.project_id=p.id
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND v.id=NEW.version_id AND b.revision=NEW.base_revision
  AND (NEW.operation='publish' OR b.version_id=NEW.version_id)
 );
 SELECT RAISE(ABORT,'backend_publication_test') WHERE NEW.operation='publish' AND NOT EXISTS(
  SELECT 1 FROM backend_runs r WHERE r.id=NEW.run_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id
  AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1
 );
 SELECT RAISE(ABORT,'backend_publication_capacity') WHERE (SELECT count(*) FROM backend_publication_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM backend_publication_reviews)>=1000;
 SELECT RAISE(ABORT,'backend_publication_initial') WHERE NEW.status<>'pending';
END;
CREATE TRIGGER backend_publication_review_immutable BEFORE UPDATE ON backend_publication_reviews WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.operation<>OLD.operation OR NEW.version_id<>OLD.version_id OR NEW.run_id IS NOT OLD.run_id OR NEW.base_revision<>OLD.base_revision OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'backend_publication_immutable'); END;
CREATE TRIGGER backend_publication_apply BEFORE UPDATE OF status ON backend_publication_reviews BEGIN
 SELECT RAISE(ABORT,'backend_publication_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM backend_publications b JOIN projects p ON p.id=b.project_id WHERE b.project_id=NEW.project_id AND b.revision=NEW.base_revision AND p.owner_user_id=NEW.user_id);
 UPDATE backend_publications SET revision=revision+1,review_id=NEW.id,version_id=NEW.version_id WHERE project_id=NEW.project_id AND NEW.operation='publish';
 UPDATE backend_publications SET revision=revision+1,review_id=NULL,version_id=NULL WHERE project_id=NEW.project_id AND NEW.operation='unpublish';
END;
-- One counter per project, no visitor payloads or outputs retained. Every accepted
-- attempt counts, including execution errors and lost provider acknowledgments.
CREATE TABLE backend_public_usage (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 calls INTEGER NOT NULL CHECK(calls BETWEEN 1 AND 100),
 publication_id TEXT NOT NULL REFERENCES backend_publication_reviews(id)
);
CREATE INDEX backend_public_usage_day ON backend_public_usage(day);
CREATE TRIGGER backend_public_usage_insert BEFORE INSERT ON backend_public_usage BEGIN
 SELECT RAISE(ABORT,'backend_public_unavailable') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR NOT EXISTS(SELECT 1 FROM backend_publications b JOIN backend_publication_reviews r ON r.id=b.review_id AND r.status='applied' JOIN projects p ON p.id=b.project_id AND p.owner_user_id=r.user_id WHERE b.project_id=NEW.project_id AND b.review_id=NEW.publication_id AND b.version_id IS NOT NULL);
 SELECT RAISE(ABORT,'backend_public_quota') WHERE
 coalesce((SELECT calls FROM backend_public_usage WHERE project_id=NEW.project_id AND day=NEW.day),0)>=100 OR
 coalesce((SELECT sum(u.calls) FROM backend_public_usage u JOIN projects p ON p.id=u.project_id WHERE u.day=NEW.day AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id)),0)>=500 OR
 coalesce((SELECT sum(calls) FROM backend_public_usage WHERE day=NEW.day),0)>=1000;
END;
CREATE TRIGGER backend_public_usage_update BEFORE UPDATE ON backend_public_usage BEGIN
 SELECT RAISE(ABORT,'backend_public_counter') WHERE NEW.project_id<>OLD.project_id OR NEW.day<>strftime('%Y-%m-%d','now') OR NEW.calls<> (OLD.calls*(NEW.day=OLD.day)+1);
END;

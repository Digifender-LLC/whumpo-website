-- Shared implementation, private project data, explicit publication snapshots.
CREATE TABLE directories (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 draft_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(draft_json) AND json_type(draft_json)='array' AND json_array_length(draft_json)<=25 AND length(CAST(draft_json AS BLOB))<=24576),
 live_json TEXT CHECK(live_json IS NULL OR (json_valid(live_json) AND json_type(live_json)='array' AND json_array_length(live_json)<=25 AND length(CAST(live_json AS BLOB))<=24576)),
 publication_revision INTEGER NOT NULL DEFAULT -1,
 published_at TEXT
);
CREATE TABLE directory_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('edit','publish','unpublish')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='array' AND json_array_length(snapshot_json)<=25 AND length(CAST(snapshot_json AS BLOB))<=24576),
 digest TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 publication_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
);
CREATE INDEX directory_reviews_project ON directory_reviews(project_id);
CREATE TRIGGER directory_review_insert BEFORE INSERT ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'directory_capacity') WHERE (SELECT COUNT(*) FROM directory_reviews WHERE project_id=NEW.project_id)>=100;
END;
CREATE TRIGGER directory_review_identity BEFORE UPDATE ON directory_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.kind!=OLD.kind OR NEW.snapshot_json!=OLD.snapshot_json OR NEW.digest!=OLD.digest OR NEW.expected_revision!=OLD.expected_revision OR NEW.publication_revision!=OLD.publication_revision OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;
CREATE TRIGGER directory_review_confirm BEFORE UPDATE ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM directories d JOIN projects p ON p.id=d.project_id WHERE d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.kind='publish' AND (NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL AND revision=NEW.publication_revision) OR NEW.snapshot_json!=(SELECT draft_json FROM directories WHERE project_id=NEW.project_id));
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND user_text='/confirm-directory '||NEW.id);
END;
CREATE TRIGGER directory_capacity BEFORE UPDATE ON directories
BEGIN
 SELECT RAISE(ABORT,'directory_capacity') WHERE (SELECT COALESCE(SUM(json_array_length(draft_json)+COALESCE(json_array_length(live_json),0)),0) FROM directories WHERE project_id!=NEW.project_id)+json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>2000;
END;
CREATE TRIGGER directory_review_apply AFTER UPDATE ON directory_reviews
BEGIN
 UPDATE directories SET revision=revision+1,draft_json=CASE WHEN NEW.kind='edit' THEN NEW.snapshot_json ELSE draft_json END,live_json=CASE NEW.kind WHEN 'publish' THEN NEW.snapshot_json WHEN 'unpublish' THEN NULL ELSE live_json END,publication_revision=CASE WHEN NEW.kind='publish' THEN NEW.publication_revision ELSE publication_revision END,published_at=CASE WHEN NEW.kind='publish' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE published_at END WHERE project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('directory:'||NEW.id,NEW.user_id,NEW.project_id,'directory.'||NEW.kind,CASE NEW.kind WHEN 'edit' THEN 'Updated private directory draft' WHEN 'publish' THEN 'Published reviewed directory snapshot' ELSE 'Took directory offline' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- Private configuration changes. Publication and visitor state retain their own reviews.
ALTER TABLE projects ADD COLUMN site_draft_revision INTEGER NOT NULL DEFAULT 0 CHECK(site_draft_revision>=0);
CREATE TRIGGER specification_site_added AFTER INSERT ON site_versions BEGIN UPDATE projects SET site_draft_revision=site_draft_revision+1 WHERE id=NEW.project_id; END;

CREATE TABLE project_spec_proposals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('import','change','restore')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0), draft_revision INTEGER NOT NULL,
 base_version_id TEXT, target_version_id TEXT,
 base_digest TEXT, request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64), manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 policy_version TEXT NOT NULL, expires_at TEXT NOT NULL,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=32768),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND length(CAST(config_json AS BLOB))<=8192),
 html TEXT NOT NULL CHECK(length(CAST(html AS BLOB))<=32768), html_digest TEXT NOT NULL CHECK(length(html_digest)=64),
 diff_json TEXT NOT NULL CHECK(json_valid(diff_json) AND length(CAST(diff_json AS BLOB))<=65536),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND length(CAST(envelope_json AS BLOB))<=16384)
);
CREATE INDEX project_spec_proposals_project ON project_spec_proposals(project_id,expires_at);
CREATE INDEX project_spec_proposals_expiry ON project_spec_proposals(expires_at);
CREATE TABLE project_spec_versions (
 version_id TEXT PRIMARY KEY REFERENCES site_versions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), proposal_id TEXT NOT NULL,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=32768),
 spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 UNIQUE(project_id,revision)
);
CREATE TABLE project_spec_applies (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL UNIQUE, proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 version_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id,revision)
);
CREATE TABLE project_spec_heads (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), version_id TEXT NOT NULL,
 draft_revision INTEGER NOT NULL
);
CREATE TABLE project_spec_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL REFERENCES project_spec_proposals(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);
CREATE TRIGGER project_spec_proposal_admit BEFORE INSERT ON project_spec_proposals BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending'
  LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN project_spec_versions v ON v.version_id=h.version_id
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.site_draft_revision=NEW.draft_revision
  AND coalesce(h.revision,0)=NEW.expected_revision AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND (NEW.operation!='change' OR h.draft_revision=p.site_draft_revision)
 );
 SELECT RAISE(ABORT,'specification_changed') WHERE NEW.target_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.target_version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'specification_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM content_screening_decisions WHERE user_id=NEW.user_id AND kind='generated_artifact' AND required=1 AND digest IN (NEW.spec_digest,NEW.manifest_digest,NEW.html_digest));
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM project_spec_held WHERE version_id IN(NEW.base_version_id,NEW.target_version_id));
 SELECT RAISE(ABORT,'specification_quota') WHERE (SELECT count(*) FROM project_spec_proposals WHERE project_id=NEW.project_id)>=50 OR (SELECT count(*) FROM project_spec_proposals)>=4000;
END;
CREATE TRIGGER project_spec_proposal_immutable BEFORE UPDATE ON project_spec_proposals BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;
CREATE TRIGGER project_spec_version_immutable BEFORE UPDATE ON project_spec_versions BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;
CREATE TRIGGER project_spec_apply_immutable BEFORE UPDATE ON project_spec_applies BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;
CREATE TRIGGER project_spec_apply_retained BEFORE DELETE ON project_spec_applies WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) BEGIN SELECT RAISE(ABORT,'specification_receipt_retained'); END;
CREATE TRIGGER project_spec_version_admit BEFORE INSERT ON project_spec_versions BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_proposals q JOIN site_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id
  JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND NEW.revision=q.expected_revision+1
  AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.lock_json=q.lock_json
  AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest
  AND v.component_id='site-page@1' AND v.html=q.html AND v.digest=q.html_digest AND v.config_json=q.config_json
 );
END;
CREATE TRIGGER project_spec_apply_admit BEFORE INSERT ON project_spec_applies BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_proposals q JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  JOIN project_spec_versions v ON v.version_id=NEW.version_id AND v.project_id=p.id AND v.proposal_id=q.id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND t.user_text='/confirm-specification '||q.id||' '||q.proposal_digest||' '||q.expected_revision
  LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN project_spec_versions b ON b.version_id=h.version_id
  WHERE q.id=NEW.proposal_id AND q.user_id=NEW.user_id AND q.project_id=NEW.project_id AND q.proposal_digest=NEW.proposal_digest
  AND NEW.id=NEW.version_id AND NEW.revision=q.expected_revision+1 AND v.revision=NEW.revision
  AND coalesce(h.revision,0)=q.expected_revision AND h.version_id IS q.base_version_id AND b.spec_digest IS q.base_digest
  AND p.site_draft_revision=q.draft_revision+1
  AND (q.target_version_id IS NULL OR EXISTS(SELECT 1 FROM site_versions WHERE id=q.target_version_id AND project_id=q.project_id))
 );
 SELECT RAISE(ABORT,'specification_expired') WHERE (SELECT expires_at FROM project_spec_proposals WHERE id=NEW.proposal_id)<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM content_screening_decisions s JOIN project_spec_proposals q ON q.id=NEW.proposal_id AND s.user_id=q.user_id AND s.kind='generated_artifact' AND s.required=1 AND s.digest IN(q.spec_digest,q.manifest_digest,q.html_digest));
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM project_spec_held h JOIN project_spec_proposals q ON q.id=NEW.proposal_id AND h.version_id IN(q.base_version_id,q.target_version_id));
 SELECT RAISE(ABORT,'specification_quota') WHERE (SELECT count(*) FROM project_spec_applies WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM project_spec_applies)>=20000;
END;
CREATE TRIGGER project_spec_head_insert BEFORE INSERT ON project_spec_heads BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_applies a JOIN projects p ON p.id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id=NEW.version_id AND a.revision=NEW.revision AND p.site_draft_revision=NEW.draft_revision);
END;
CREATE TRIGGER project_spec_head_update BEFORE UPDATE ON project_spec_heads BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NEW.project_id!=OLD.project_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM project_spec_applies a JOIN projects p ON p.id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id=NEW.version_id AND a.revision=NEW.revision AND p.site_draft_revision=NEW.draft_revision);
END;
CREATE TRIGGER project_spec_apply AFTER INSERT ON project_spec_applies BEGIN
 INSERT INTO project_spec_heads(project_id,revision,version_id,draft_revision) SELECT NEW.project_id,NEW.revision,NEW.version_id,site_draft_revision FROM projects WHERE id=NEW.project_id
 ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,version_id=excluded.version_id,draft_revision=excluded.draft_revision;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('specification:'||NEW.id,NEW.user_id,NEW.project_id,'site.specification.applied','Saved a reviewed private website version',NEW.created_at);
END;
CREATE TRIGGER project_spec_link_admit BEFORE INSERT ON project_spec_chat_links BEGIN
 SELECT RAISE(ABORT,'specification_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN project_spec_proposals q ON q.user_id=t.user_id JOIN projects p ON p.id=q.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND q.id=NEW.proposal_id);
END;
CREATE TRIGGER project_spec_link_immutable BEFORE UPDATE ON project_spec_chat_links BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;
CREATE TRIGGER project_spec_version_retained BEFORE DELETE ON site_versions WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) BEGIN
 SELECT RAISE(ABORT,'version_removal_specification') WHERE EXISTS(SELECT 1 FROM project_spec_heads WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_specification') WHERE EXISTS(SELECT 1 FROM project_spec_proposals q WHERE (q.base_version_id=OLD.id OR q.target_version_id=OLD.id) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_spec_applies WHERE proposal_id=q.id));
END;
-- Remove full candidate/diff copies when an associated version is removed. Metadata-only
-- apply receipts survive, so lost-response retries cannot recreate deleted content.
CREATE TRIGGER project_spec_forget_deleted AFTER DELETE ON site_versions BEGIN
 DELETE FROM project_spec_proposals WHERE base_version_id=OLD.id OR target_version_id=OLD.id OR id IN(SELECT proposal_id FROM project_spec_applies WHERE version_id=OLD.id);
END;
CREATE VIEW project_spec_held AS SELECT v.version_id FROM project_spec_versions v JOIN projects p ON p.id=v.project_id JOIN site_versions s ON s.id=v.version_id
 WHERE EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=p.owner_user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(v.spec_digest,v.manifest_digest,s.digest));
CREATE TRIGGER specification_publication_insert BEFORE INSERT ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'specification_held'); END;
CREATE TRIGGER specification_publication_update BEFORE UPDATE OF version_id ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'specification_held'); END;

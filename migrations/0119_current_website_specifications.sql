-- Current-only website creation. No saved legacy page is converted into a specification.
CREATE TABLE project_spec_creations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 version_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER project_spec_creation_immutable BEFORE UPDATE ON project_spec_creations BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;
CREATE TRIGGER project_spec_creation_retained BEFORE DELETE ON project_spec_creations
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'specification_receipt_retained'); END;
CREATE TRIGGER project_spec_current_proposal BEFORE INSERT ON project_spec_proposals BEGIN
 SELECT RAISE(ABORT,'specification_current_required') WHERE NEW.operation NOT IN('change','restore') OR json_extract(NEW.spec_json,'$.schemaVersion') IS NOT 2 OR json_extract(NEW.lock_json,'$.compiler.version') IS NOT 2;
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=NEW.project_id AND json_extract(v.spec_json,'$.schemaVersion')=2 AND h.draft_revision=NEW.draft_revision);
END;

DROP TRIGGER project_spec_version_admit;
CREATE TRIGGER project_spec_version_admit BEFORE INSERT ON project_spec_versions BEGIN
 SELECT RAISE(ABORT,'specification_current_required') WHERE json_extract(NEW.spec_json,'$.schemaVersion') IS NOT 2 OR json_extract(NEW.lock_json,'$.compiler.version') IS NOT 2;
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_proposals q JOIN site_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id
  JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND NEW.revision=q.expected_revision+1
  AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.lock_json=q.lock_json
  AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest
  AND v.component_id=json_extract(q.manifest_json,'$.artifacts[0].component') AND v.html=q.html AND v.digest=q.html_digest AND v.config_json=q.config_json
 ) AND NOT EXISTS(
  SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id
  JOIN chat_turns t ON t.id=v.id AND t.user_id=p.owner_user_id AND t.mode='ai' AND t.status='pending' AND t.action_json IS NULL
  WHERE v.id=NEW.version_id AND v.project_id=NEW.project_id AND NEW.proposal_id=NEW.version_id AND NEW.revision=1
  AND p.site_draft_revision=1 AND NOT EXISTS(SELECT 1 FROM project_spec_heads WHERE project_id=p.id)
  AND v.component_id=json_extract(NEW.manifest_json,'$.artifacts[0].component')
  AND v.digest=json_extract(NEW.manifest_json,'$.artifacts[0].digest')
  AND NEW.spec_digest=json_extract(NEW.manifest_json,'$.specificationDigest')
  AND NOT EXISTS(SELECT 1 FROM project_spec_creations WHERE project_id=p.id)
 );
END;
CREATE TRIGGER project_spec_creation_admit BEFORE INSERT ON project_spec_creations BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN site_versions s ON s.project_id=p.id
  JOIN project_spec_versions v ON v.version_id=s.id AND v.project_id=p.id AND v.revision=1 AND v.proposal_id=v.version_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending' AND t.action_json IS NULL
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.site_draft_revision=1
  AND NEW.id=NEW.version_id AND v.version_id=NEW.version_id AND s.source='ai'
  AND NOT EXISTS(SELECT 1 FROM project_spec_heads WHERE project_id=p.id)
  AND json_extract(v.spec_json,'$.schemaVersion')=2 AND json_extract(v.lock_json,'$.compiler.version')=2
 );
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id);
END;
DROP TRIGGER project_spec_head_insert;
CREATE TRIGGER project_spec_head_insert BEFORE INSERT ON project_spec_heads BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_applies a JOIN projects p ON p.id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id=NEW.version_id AND a.revision=NEW.revision AND p.site_draft_revision=NEW.draft_revision)
 AND NOT EXISTS(SELECT 1 FROM project_spec_creations c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND c.version_id=NEW.version_id AND NEW.revision=1 AND p.site_draft_revision=1 AND NEW.draft_revision=1);
END;
CREATE TRIGGER project_spec_created AFTER INSERT ON project_spec_creations BEGIN
 INSERT INTO project_spec_heads(project_id,revision,version_id,draft_revision) VALUES(NEW.project_id,1,NEW.version_id,1);
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('specification:'||NEW.id,NEW.user_id,NEW.project_id,'site.specification.created','Saved the first current website specification',NEW.created_at);
END;
-- No standalone launch component may be created after this cutover.
CREATE TRIGGER current_website_component BEFORE INSERT ON site_versions
WHEN NEW.component_id NOT IN('site-page@1','photo-page@1')
BEGIN SELECT RAISE(ABORT,'specification_current_required'); END;
-- Initial onboarding remains the sole guided project-creation flow.
UPDATE workspace_state SET idea='',brief_project_id=NULL,brief_stage=NULL,step='ready';

DROP TRIGGER welcome_create_project;
CREATE TRIGGER welcome_create_project AFTER UPDATE ON welcome_onboarding WHEN NEW.completed_at IS NOT NULL
 BEGIN
 INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at,audience,preferred_theme)
 VALUES(NEW.project_id,NEW.user_id,NEW.project_name,NEW.idea,'draft',NEW.completed_at,NEW.completed_at,NEW.audience,NEW.preferred_theme);
 INSERT INTO workspace_state(user_id,revision,step,idea) VALUES(NEW.user_id,1,'ready','')
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,step='ready',idea='',brief_project_id=NULL,brief_stage=NULL;
 INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status)
 SELECT NEW.project_id,NEW.user_id,revision,'Start my first project.',
 'Your project “'||NEW.project_name||'” is ready to work on. I saved your idea and preferences privately. Tell me what you would like to build first. Nothing is published, and no services have been purchased.',NEW.completed_at,'guided','completed'
 FROM workspace_state WHERE user_id=NEW.user_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES('welcome:'||NEW.project_id,NEW.user_id,NEW.project_id,'project.created','Started first project during welcome',NEW.completed_at);
 END;

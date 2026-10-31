-- WH-125 shared module instance registry, exact owner activation reviews and module request receipts
-- (current schema input; docs/shared-modules.md). A module instance is one WH-071 logical resource
-- {projectId, resourceId}. Its configuration comes only from an exact saved specification version and is
-- registered by an applied owner activation review; configuration alone never serves. Nothing here stores a
-- visitor-, staff- or public-submitted value: request receipts keep identity, hashes, revisions and a bounded
-- content-free result only. Physical locators and owner identifiers never enter descriptors.
CREATE TABLE module_instances (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 local_id TEXT NOT NULL CHECK(length(local_id) BETWEEN 1 AND 40 AND local_id NOT GLOB '*[^a-z0-9-]*'),
 kind TEXT NOT NULL CHECK(kind IN ('content','records','files','access')),
 module_digest TEXT NOT NULL CHECK(length(module_digest)=64 AND module_digest NOT GLOB '*[^0-9a-f]*'),
 schema_digest TEXT NOT NULL CHECK(length(schema_digest)=64 AND schema_digest NOT GLOB '*[^0-9a-f]*'),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND length(CAST(config_json AS BLOB))<=16384),
 config_digest TEXT NOT NULL CHECK(length(config_digest)=64 AND config_digest NOT GLOB '*[^0-9a-f]*'),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND length(CAST(descriptor_json AS BLOB))<=32768),
 descriptor_digest TEXT NOT NULL CHECK(length(descriptor_digest)=64 AND descriptor_digest NOT GLOB '*[^0-9a-f]*'),
 dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json) AND json_type(dependencies_json)='array' AND json_array_length(dependencies_json)<=3),
 config_revision INTEGER NOT NULL CHECK(config_revision>=1),
 source_version_id TEXT NOT NULL CHECK(length(source_version_id)=36),
 source_spec_digest TEXT NOT NULL CHECK(length(source_spec_digest)=64 AND source_spec_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
 UNIQUE(project_id,local_id)
) STRICT;
CREATE INDEX module_instances_project ON module_instances(project_id,local_id);

-- Activation state is stored apart from configuration and binds the exact descriptor/configuration revision
-- it was reviewed against. Only `active` serves visitor/staff/public operations.
CREATE TABLE module_activations (
 instance_id TEXT PRIMARY KEY REFERENCES module_instances(id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('inactive','active','suspended','migrating')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 review_id TEXT NOT NULL CHECK(length(review_id)=36),
 descriptor_digest TEXT NOT NULL CHECK(length(descriptor_digest)=64),
 config_revision INTEGER NOT NULL CHECK(config_revision>=1),
 updated_at INTEGER NOT NULL CHECK(updated_at>0)
) STRICT;

-- Exact owner activation/disable review. Its id is the Chat turn that prepared it. It binds the project,
-- logical resource, exact source specification version/digest, pins, configuration digest, descriptor,
-- dependency resources and the expected configuration and activation revisions. Expires after ten minutes.
CREATE TABLE module_activation_reviews (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 resource_id TEXT NOT NULL CHECK(length(resource_id)=36),
 local_id TEXT NOT NULL CHECK(length(local_id) BETWEEN 1 AND 40 AND local_id NOT GLOB '*[^a-z0-9-]*'),
 kind TEXT NOT NULL CHECK(kind IN ('content','records','files','access')),
 action TEXT NOT NULL CHECK(action IN ('activate','disable')),
 feature_id TEXT NOT NULL CHECK(feature_id IN ('core.forms','core.editing')),
 source_version_id TEXT NOT NULL CHECK(length(source_version_id)=36),
 source_spec_digest TEXT NOT NULL CHECK(length(source_spec_digest)=64),
 module_digest TEXT NOT NULL CHECK(length(module_digest)=64),
 schema_digest TEXT NOT NULL CHECK(length(schema_digest)=64),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND length(CAST(config_json AS BLOB))<=16384),
 config_digest TEXT NOT NULL CHECK(length(config_digest)=64),
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json) AND length(CAST(descriptor_json AS BLOB))<=32768),
 descriptor_digest TEXT NOT NULL CHECK(length(descriptor_digest)=64),
 dependencies_json TEXT NOT NULL CHECK(json_valid(dependencies_json) AND json_type(dependencies_json)='array' AND json_array_length(dependencies_json)<=3),
 expected_config_revision INTEGER NOT NULL CHECK(expected_config_revision>=0),
 next_config_revision INTEGER NOT NULL CHECK(next_config_revision>=1 AND next_config_revision BETWEEN expected_config_revision AND expected_config_revision+1),
 expected_activation_revision INTEGER NOT NULL CHECK(expected_activation_revision>=0),
 widening INTEGER NOT NULL CHECK(widening IN (0,1)),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64 AND review_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+600),
 CHECK(action='activate' OR (expected_config_revision>=1 AND next_config_revision=expected_config_revision AND expected_activation_revision>=1 AND widening=0))
) STRICT;
CREATE INDEX module_activation_reviews_project ON module_activation_reviews(project_id,created_at DESC);
CREATE INDEX module_activation_reviews_user ON module_activation_reviews(user_id);
CREATE INDEX module_activation_reviews_expiry ON module_activation_reviews(expires_at);

CREATE TABLE module_activation_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES module_activation_reviews(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
) STRICT;
CREATE INDEX module_activation_links_review ON module_activation_links(review_id);

-- Applied receipt: id is the confirming Chat turn. One receipt per review (UNIQUE) gives a single winner;
-- `admitted` is the composed current feature-inclusion result (activation) or 1 (disable).
CREATE TABLE module_activation_applies (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL UNIQUE REFERENCES module_activation_reviews(id) ON DELETE CASCADE,
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 admitted INTEGER,
 state TEXT NOT NULL CHECK(state IN ('active','inactive')),
 activation_revision INTEGER NOT NULL CHECK(activation_revision>=1),
 created_at INTEGER NOT NULL CHECK(created_at>0)
) STRICT;
CREATE INDEX module_activation_applies_user ON module_activation_applies(user_id);

-- Shared idempotent receipts for module API writes (whumpo-modules v1). Same (resource, requestId) and the
-- same request hash reads this receipt after current permission is rechecked; a different hash conflicts.
-- Receipts are content-free and kept for the 30-day replay window, then pruned by the daily maintenance job; the
-- 30-day anonymous intake caps (module_record_admit) count within the same window.
-- result_json is the handler's bounded, content-minimized result and never echoes submitted values.
CREATE TABLE module_request_receipts (
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(length(operation) BETWEEN 1 AND 40),
 principal_kind TEXT NOT NULL CHECK(principal_kind IN ('owner','visitor','public')),
 principal_hash TEXT NOT NULL CHECK(length(principal_hash)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 config_revision INTEGER NOT NULL CHECK(config_revision>=1),
 activation_revision INTEGER NOT NULL CHECK(activation_revision>=1),
 module_digest TEXT NOT NULL CHECK(length(module_digest)=64),
 schema_digest TEXT NOT NULL CHECK(length(schema_digest)=64),
 admitted INTEGER,
 result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(CAST(result_json AS BLOB))<=2048),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(instance_id,request_id)
) STRICT;
CREATE INDEX module_request_receipts_project ON module_request_receipts(project_id,created_at);
-- Sliding-window admission (instance and per-principal caps) and the 30-day retention prune (cleanupModuleRequestReceipts).
CREATE INDEX module_request_receipts_instance ON module_request_receipts(instance_id,created_at);
CREATE INDEX module_request_receipts_principal ON module_request_receipts(instance_id,principal_hash,operation,created_at);
CREATE INDEX module_request_receipts_age ON module_request_receipts(created_at);
-- WH-127 anonymous intake caps count public receipts platform-wide and per project.
CREATE INDEX module_request_receipts_public ON module_request_receipts(principal_kind,created_at);

-- Review admission: prepared only by the owner's typed moduleActivationReview Chat control, for the exact
-- owned project and current saved specification head; disable binds the current registry row.
CREATE TRIGGER module_activation_review_admit BEFORE INSERT ON module_activation_reviews BEGIN
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id AND p.owner_user_id=t.user_id
  WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='moduleActivationReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id
  AND json_extract(t.action_json,'$.instanceId')=NEW.local_id AND json_extract(t.action_json,'$.action')=NEW.action);
 SELECT RAISE(ABORT,'module_activation_changed') WHERE abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NEW.action='activate' AND NOT EXISTS(SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
  WHERE h.project_id=NEW.project_id AND h.version_id=NEW.source_version_id AND v.spec_digest=NEW.source_spec_digest);
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NEW.expected_config_revision=0 AND EXISTS(SELECT 1 FROM module_instances WHERE id=NEW.resource_id OR (project_id=NEW.project_id AND local_id=NEW.local_id));
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NEW.expected_config_revision>0 AND NOT EXISTS(SELECT 1 FROM module_instances WHERE id=NEW.resource_id AND project_id=NEW.project_id AND local_id=NEW.local_id AND kind=NEW.kind AND config_revision=NEW.expected_config_revision);
 -- WH-126: a project has one visitor identity namespace (one project session cookie), so at most one access instance.
 SELECT RAISE(ABORT,'module_activation_access_single') WHERE NEW.kind='access' AND NEW.expected_config_revision=0 AND EXISTS(SELECT 1 FROM module_instances WHERE project_id=NEW.project_id AND kind='access');
 -- Capacity bounds pending (unapplied) reviews only: applied reviews are retained history and never block a later
 -- activation, configuration change or disable.
 SELECT RAISE(ABORT,'module_activation_capacity') WHERE NOT (NEW.action='disable') AND ((SELECT count(*) FROM module_activation_reviews t WHERE t.project_id=NEW.project_id AND NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='disable'))>=25
  OR (SELECT count(*) FROM module_activation_reviews t WHERE t.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='disable'))>=100
  OR (SELECT count(*) FROM module_activation_reviews t WHERE NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='disable'))>=5000
  OR ((SELECT count(*) FROM module_activation_reviews t WHERE NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='disable'))>=2500 AND (SELECT count(*) FROM module_activation_reviews t WHERE t.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='disable'))>=25));
END;
CREATE TRIGGER module_activation_review_immutable BEFORE UPDATE ON module_activation_reviews BEGIN SELECT RAISE(ABORT,'module_activation_immutable'); END;
CREATE TRIGGER module_activation_link_admit BEFORE INSERT ON module_activation_links BEGIN
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN module_activation_reviews r ON r.user_id=t.user_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND r.id=NEW.review_id);
END;
CREATE TRIGGER module_activation_link_immutable BEFORE UPDATE ON module_activation_links BEGIN SELECT RAISE(ABORT,'module_activation_immutable'); END;

-- The committing statement repeats every decision: typed confirming Chat control with exact review digest and
-- revision, current owner, unexpired review, unchanged registry and activation revisions, unchanged pins,
-- current unheld specification head and active dependencies (activation only), and composed inclusion.
CREATE TRIGGER module_activation_apply_admit BEFORE INSERT ON module_activation_applies BEGIN
 SELECT RAISE(ABORT,'module_activation_forbidden') WHERE NEW.admitted IS NOT 1;
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM module_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='moduleActivationApply' AND json_extract(t.action_json,'$.reviewId')=r.id
   AND json_extract(t.action_json,'$.reviewDigest')=r.review_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=r.expected_activation_revision
  WHERE r.id=NEW.review_id AND r.user_id=NEW.user_id AND r.review_digest=NEW.review_digest
  AND NEW.state=CASE r.action WHEN 'activate' THEN 'active' ELSE 'inactive' END AND NEW.activation_revision=r.expected_activation_revision+1);
 SELECT RAISE(ABORT,'module_activation_expired') WHERE (SELECT expires_at FROM module_activation_reviews WHERE id=NEW.review_id)<=unixepoch() OR abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'module_activation_changed') WHERE EXISTS(SELECT 1 FROM module_activation_reviews r WHERE r.id=NEW.review_id AND (
  coalesce((SELECT revision FROM module_activations WHERE instance_id=r.resource_id),0)!=r.expected_activation_revision
  OR (r.expected_config_revision=0 AND EXISTS(SELECT 1 FROM module_instances WHERE id=r.resource_id OR (project_id=r.project_id AND local_id=r.local_id)))
  OR (r.expected_config_revision>0 AND NOT EXISTS(SELECT 1 FROM module_instances i WHERE i.id=r.resource_id AND i.project_id=r.project_id AND i.local_id=r.local_id AND i.kind=r.kind
   AND i.config_revision=r.expected_config_revision AND i.module_digest=r.module_digest AND i.schema_digest=r.schema_digest))
  OR (r.action='disable' AND NOT EXISTS(SELECT 1 FROM module_activations WHERE instance_id=r.resource_id AND state IN ('active','suspended')))
  OR (r.action='activate' AND NOT EXISTS(SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
   WHERE h.project_id=r.project_id AND h.version_id=r.source_version_id AND v.spec_digest=r.source_spec_digest))
  OR (r.action='activate' AND EXISTS(SELECT 1 FROM json_each(r.dependencies_json) d WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id
   WHERE i.id=d.value AND i.project_id=r.project_id AND a.state='active')))));
 SELECT RAISE(ABORT,'module_activation_held') WHERE EXISTS(SELECT 1 FROM module_activation_reviews r JOIN project_spec_held h ON h.version_id=r.source_version_id WHERE r.id=NEW.review_id AND r.action='activate');
END;
-- WH-126: one visitor identity namespace per project. The specification validator already allows one access instance;
-- the registry repeats it so no second access instance can ever own visitors.
CREATE TRIGGER module_instance_access_single BEFORE INSERT ON module_instances WHEN NEW.kind='access' AND EXISTS(SELECT 1 FROM module_instances WHERE project_id=NEW.project_id AND kind='access')
BEGIN SELECT RAISE(ABORT,'module_activation_access_single'); END;
CREATE TRIGGER module_activation_apply AFTER INSERT ON module_activation_applies BEGIN
 INSERT INTO module_instances(id,project_id,local_id,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,config_revision,source_version_id,source_spec_digest,created_at,updated_at)
  SELECT resource_id,project_id,local_id,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,next_config_revision,source_version_id,source_spec_digest,NEW.created_at,NEW.created_at
  FROM module_activation_reviews WHERE id=NEW.review_id AND action='activate' AND expected_config_revision=0;
 UPDATE module_instances SET
  config_json=(SELECT config_json FROM module_activation_reviews WHERE id=NEW.review_id),
  config_digest=(SELECT config_digest FROM module_activation_reviews WHERE id=NEW.review_id),
  descriptor_json=(SELECT descriptor_json FROM module_activation_reviews WHERE id=NEW.review_id),
  descriptor_digest=(SELECT descriptor_digest FROM module_activation_reviews WHERE id=NEW.review_id),
  dependencies_json=(SELECT dependencies_json FROM module_activation_reviews WHERE id=NEW.review_id),
  config_revision=(SELECT next_config_revision FROM module_activation_reviews WHERE id=NEW.review_id),
  source_version_id=(SELECT source_version_id FROM module_activation_reviews WHERE id=NEW.review_id),
  source_spec_digest=(SELECT source_spec_digest FROM module_activation_reviews WHERE id=NEW.review_id),
  updated_at=max(updated_at,NEW.created_at)
  WHERE id=(SELECT resource_id FROM module_activation_reviews WHERE id=NEW.review_id AND action='activate' AND expected_config_revision>0);
 INSERT INTO module_activations(instance_id,state,revision,review_id,descriptor_digest,config_revision,updated_at)
  SELECT r.resource_id,NEW.state,NEW.activation_revision,r.id,r.descriptor_digest,r.next_config_revision,NEW.created_at FROM module_activation_reviews r
  WHERE r.id=NEW.review_id AND NOT EXISTS(SELECT 1 FROM module_activations WHERE instance_id=r.resource_id);
 UPDATE module_activations SET state=NEW.state,revision=NEW.activation_revision,review_id=NEW.review_id,
  descriptor_digest=(SELECT descriptor_digest FROM module_activation_reviews WHERE id=NEW.review_id),
  config_revision=(SELECT next_config_revision FROM module_activation_reviews WHERE id=NEW.review_id),updated_at=NEW.created_at
  WHERE instance_id=(SELECT resource_id FROM module_activation_reviews WHERE id=NEW.review_id) AND revision=NEW.activation_revision-1;
 SELECT RAISE(ABORT,'module_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM module_activations WHERE review_id=NEW.review_id AND revision=NEW.activation_revision AND state=NEW.state);
 -- WH-126: an access instance starts at access revision 1; every later activation, disable or configuration
 -- change advances it so session-bound decisions, cursors and pending writes from before the change fail.
 INSERT INTO module_access_states(instance_id,project_id,revision,updated_at)
  SELECT resource_id,project_id,1,NEW.created_at FROM module_activation_reviews WHERE id=NEW.review_id AND kind='access' AND expected_config_revision=0;
 UPDATE module_access_states SET revision=revision+1,updated_at=max(updated_at,NEW.created_at)
  WHERE instance_id=(SELECT resource_id FROM module_activation_reviews WHERE id=NEW.review_id AND kind='access' AND expected_config_revision>0);
 -- Visitor identity belongs to the access instance: disabling it signs every visitor out and cancels pending sign-ins.
 -- Invitations bind the activation revision, so they stop working too (an expired revision never re-admits).
 DELETE FROM app_sessions WHERE NEW.state='inactive' AND visitor_id IN(SELECT v.id FROM app_visitors v JOIN module_activation_reviews r ON r.resource_id=v.access_id WHERE r.id=NEW.review_id AND r.kind='access');
 DELETE FROM app_auth_challenges WHERE NEW.state='inactive' AND access_id=(SELECT resource_id FROM module_activation_reviews WHERE id=NEW.review_id AND kind='access');
END;
CREATE TRIGGER module_activation_apply_immutable BEFORE UPDATE ON module_activation_applies BEGIN SELECT RAISE(ABORT,'module_activation_immutable'); END;
CREATE TRIGGER module_activation_review_retained BEFORE DELETE ON module_activation_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'module_activation_receipt_retained') WHERE NOT (EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=OLD.id) OR (NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=OLD.id) AND OLD.expires_at<=unixepoch()-3600) OR (OLD.action='disable' AND NOT (EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=OLD.id)) AND EXISTS(SELECT 1 FROM module_activation_reviews x WHERE x.expires_at>OLD.expires_at AND x.action='disable' AND x.resource_id=OLD.resource_id)))
  OR (EXISTS(SELECT 1 FROM module_activations WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=OLD.id)) OR (OLD.action='disable') OR OLD.id NOT IN (SELECT t.id FROM module_activation_reviews t WHERE t.project_id=OLD.project_id AND EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=t.id) AND NOT (t.action='disable') ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='module_activation_reviews' AND id=OLD.id AND (EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=OLD.id))=(outcome IN ('applied','withdrawn')));
END;

-- Identity, project, local id and kind never change; configuration revisions only advance.
CREATE TRIGGER module_instance_update BEFORE UPDATE ON module_instances
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.local_id IS NOT OLD.local_id OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at
 OR NEW.module_digest IS NOT OLD.module_digest OR NEW.schema_digest IS NOT OLD.schema_digest OR NEW.config_revision<OLD.config_revision
 OR (NEW.config_revision=OLD.config_revision AND NEW.config_digest IS NOT OLD.config_digest)
BEGIN SELECT RAISE(ABORT,'module_instance_immutable'); END;
CREATE TRIGGER module_activation_update BEFORE UPDATE ON module_activations
WHEN NEW.instance_id IS NOT OLD.instance_id OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'module_instance_immutable'); END;

-- A saved specification keeps every registered instance. Activation inserts the registry row and it is never deleted
-- while the project exists, so "ever activated" is exactly "has a row". A new saved version (edit or restore) that
-- drops or re-kinds a registered instance is refused inside the commit, closing the race where a removal review
-- prepared while the instance was never activated is applied after an activation. Removing a never-activated
-- instance's configuration is allowed; removing an activated one stays MIGRATION_REQUIRED until WH-077 export exists.
CREATE TRIGGER module_instance_spec_retained BEFORE INSERT ON project_spec_versions BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE EXISTS(SELECT 1 FROM module_instances i WHERE i.project_id=NEW.project_id
  AND NOT EXISTS(SELECT 1 FROM json_each(NEW.spec_json,'$.instances') j WHERE json_extract(j.value,'$.id')=i.local_id AND json_extract(j.value,'$.kind')=i.kind));
END;

-- Module request commit guard. The handler's statements and this receipt share one batch, so a failed guard
-- aborts the effect: current active instance and active dependencies, exact configuration and activation
-- revisions, unchanged pins and the composed principal predicate (`admitted`).
CREATE TRIGGER module_request_admit BEFORE INSERT ON module_request_receipts BEGIN
 SELECT RAISE(ABORT,'module_request_forbidden') WHERE NEW.admitted IS NOT 1;
 SELECT RAISE(ABORT,'module_request_unavailable') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id
  WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND i.module_digest=NEW.module_digest AND i.schema_digest=NEW.schema_digest);
 -- Visitor/staff/public operations serve only an active instance whose dependencies are active. Owner
 -- operations (reads, export, removal, revocation) stay available in every activation state.
 SELECT RAISE(ABORT,'module_request_unavailable') WHERE NEW.principal_kind!='owner' AND (NOT EXISTS(SELECT 1 FROM module_activations WHERE instance_id=NEW.instance_id AND state='active')
  OR EXISTS(SELECT 1 FROM module_instances i, json_each(i.dependencies_json) d WHERE i.id=NEW.instance_id AND NOT EXISTS(SELECT 1 FROM module_instances x JOIN module_activations a ON a.instance_id=x.id
   WHERE x.id=d.value AND x.project_id=i.project_id AND a.state='active')));
 SELECT RAISE(ABORT,'module_request_stale') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id
  WHERE i.id=NEW.instance_id AND i.config_revision=NEW.config_revision AND a.revision=NEW.activation_revision);
 SELECT RAISE(ABORT,'module_request_limited') WHERE abs(NEW.created_at-unixepoch())>60;
 -- Flood guard over a sliding 24-hour window of non-owner receipts. Owner operations (removal, export, revocation) are
 -- never refused by it, and owner receipts do not consume visitor/staff/public capacity.
 SELECT RAISE(ABORT,'module_request_limited') WHERE NEW.principal_kind!='owner'
  AND (SELECT count(*) FROM module_request_receipts WHERE instance_id=NEW.instance_id AND principal_kind!='owner' AND created_at>unixepoch()-86400)>=20000;
 -- Staff/visitor record edits: 60 per hour per visitor identity and instance (submissions have their own 20/hour cap).
 SELECT RAISE(ABORT,'module_request_limited') WHERE NEW.principal_kind='visitor' AND NEW.operation='records.update'
  AND (SELECT count(*) FROM module_request_receipts WHERE instance_id=NEW.instance_id AND principal_hash=NEW.principal_hash AND operation='records.update' AND created_at>unixepoch()-3600)>=60;
END;
CREATE TRIGGER module_request_receipt_immutable BEFORE UPDATE ON module_request_receipts BEGIN SELECT RAISE(ABORT,'module_request_immutable'); END;

-- WH-126 access module (docs/shared-modules.md#access-module-staff-roles-wh-126--october-4-2026-utc). Visitor
-- identities (app_visitors, passkeys, invitations, recovery and sessions in schema/platform.sql) are owned by the
-- project's single access instance (app_visitors.access_id); this module adds the access revision, the `staff` role
-- and exact owner role reviews. A role is project
-- application policy on a visitor identity: it never creates a workspace session, Chat, publication, spending or
-- identity-management authority, and WH-054 workspace members are never visitor or staff principals.
CREATE TABLE module_access_states (
 instance_id TEXT PRIMARY KEY REFERENCES module_instances(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>=1),
 updated_at INTEGER NOT NULL CHECK(updated_at>0)
) STRICT;
CREATE INDEX module_access_states_project ON module_access_states(project_id);

-- Current grant per (access instance, visitor, role). Revocation keeps the row as a `revoked` suppression with
-- the review and access revision that changed it; only a new exact owner review can grant again.
CREATE TABLE module_access_roles (
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role='staff'),
 state TEXT NOT NULL CHECK(state IN ('granted','revoked')),
 review_id TEXT CHECK(review_id IS NULL OR length(review_id)=36),
 access_revision INTEGER NOT NULL CHECK(access_revision>=1),
 granted_at INTEGER NOT NULL CHECK(granted_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=granted_at),
 PRIMARY KEY(instance_id,visitor_id,role)
) STRICT;
CREATE INDEX module_access_roles_visitor ON module_access_roles(visitor_id);
CREATE INDEX module_access_roles_project ON module_access_roles(project_id,state);

-- Exact owner role review, prepared by the typed accessRoleReview Chat control. It binds the owned project, access
-- resource and configuration revision, one visitor identity, the action and the current access revision.
CREATE TABLE module_access_role_reviews (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 local_id TEXT NOT NULL CHECK(length(local_id) BETWEEN 1 AND 40 AND local_id NOT GLOB '*[^a-z0-9-]*'),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role='staff'),
 action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
 config_revision INTEGER NOT NULL CHECK(config_revision>=1),
 expected_access_revision INTEGER NOT NULL CHECK(expected_access_revision>=1),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64 AND review_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+600)
) STRICT;
CREATE INDEX module_access_role_reviews_project ON module_access_role_reviews(project_id,created_at DESC);
CREATE INDEX module_access_role_reviews_user ON module_access_role_reviews(user_id);
CREATE INDEX module_access_role_reviews_visitor ON module_access_role_reviews(visitor_id);
CREATE INDEX module_access_role_reviews_instance ON module_access_role_reviews(instance_id);

CREATE TABLE module_access_role_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES module_access_role_reviews(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
) STRICT;
CREATE INDEX module_access_role_links_review ON module_access_role_links(review_id);

-- Applied receipt; id is the confirming Chat turn. One receipt per review and the access-revision check give one
-- winner, and a replayed review can never re-grant: its expected access revision is gone once anything changed.
CREATE TABLE module_access_role_applies (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL UNIQUE REFERENCES module_access_role_reviews(id) ON DELETE CASCADE,
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 admitted INTEGER,
 access_revision INTEGER NOT NULL CHECK(access_revision>=2),
 created_at INTEGER NOT NULL CHECK(created_at>0)
) STRICT;
CREATE INDEX module_access_role_applies_user ON module_access_role_applies(user_id);

CREATE TRIGGER module_access_state_update BEFORE UPDATE ON module_access_states
WHEN NEW.instance_id IS NOT OLD.instance_id OR NEW.project_id IS NOT OLD.project_id OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'module_access_immutable'); END;
CREATE TRIGGER module_access_role_identity BEFORE UPDATE ON module_access_roles
WHEN NEW.instance_id IS NOT OLD.instance_id OR NEW.visitor_id IS NOT OLD.visitor_id OR NEW.project_id IS NOT OLD.project_id OR NEW.role IS NOT OLD.role OR NEW.granted_at IS NOT OLD.granted_at
BEGIN SELECT RAISE(ABORT,'module_access_immutable'); END;
-- Grants are written only by an applied owner review; a direct grant insert never admits.
CREATE TRIGGER module_access_role_insert BEFORE INSERT ON module_access_roles
WHEN NEW.state!='granted' OR NOT EXISTS(SELECT 1 FROM module_access_role_applies a JOIN module_access_role_reviews r ON r.id=a.review_id
 WHERE a.review_id=NEW.review_id AND r.instance_id=NEW.instance_id AND r.visitor_id=NEW.visitor_id AND r.project_id=NEW.project_id AND r.action='grant')
BEGIN SELECT RAISE(ABORT,'module_access_changed'); END;

CREATE TRIGGER module_access_role_review_admit BEFORE INSERT ON module_access_role_reviews BEGIN
 SELECT RAISE(ABORT,'module_access_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id AND p.owner_user_id=t.user_id
  WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='accessRoleReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id
  AND json_extract(t.action_json,'$.instanceId')=NEW.local_id AND json_extract(t.action_json,'$.visitorId')=NEW.visitor_id AND json_extract(t.action_json,'$.action')=NEW.action);
 SELECT RAISE(ABORT,'module_access_changed') WHERE abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'module_access_changed') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_access_states s ON s.instance_id=i.id JOIN app_visitors v ON v.id=NEW.visitor_id AND v.project_id=i.project_id AND v.access_id=i.id
  WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND i.local_id=NEW.local_id AND i.kind='access' AND i.config_revision=NEW.config_revision AND s.revision=NEW.expected_access_revision);
 SELECT RAISE(ABORT,'module_access_changed') WHERE NEW.action='revoke' AND NOT EXISTS(SELECT 1 FROM module_access_roles WHERE instance_id=NEW.instance_id AND visitor_id=NEW.visitor_id AND role=NEW.role AND state='granted');
 -- Capacity bounds pending (unapplied) reviews only: applied role reviews are retained history and never block a later grant or revoke.
 SELECT RAISE(ABORT,'module_access_capacity') WHERE NOT (NEW.action='revoke') AND ((SELECT count(*) FROM module_access_role_reviews t WHERE t.project_id=NEW.project_id AND NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='revoke'))>=25
  OR (SELECT count(*) FROM module_access_role_reviews t WHERE t.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='revoke'))>=100
  OR (SELECT count(*) FROM module_access_role_reviews t WHERE NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='revoke'))>=5000
  OR ((SELECT count(*) FROM module_access_role_reviews t WHERE NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='revoke'))>=2500 AND (SELECT count(*) FROM module_access_role_reviews t WHERE t.user_id=NEW.user_id AND NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND t.expires_at>unixepoch() AND NOT (t.action='revoke'))>=25));
END;
CREATE TRIGGER module_access_role_review_immutable BEFORE UPDATE ON module_access_role_reviews BEGIN SELECT RAISE(ABORT,'module_access_immutable'); END;
CREATE TRIGGER module_access_role_link_admit BEFORE INSERT ON module_access_role_links BEGIN
 SELECT RAISE(ABORT,'module_access_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN module_access_role_reviews r ON r.user_id=t.user_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND r.id=NEW.review_id);
END;
CREATE TRIGGER module_access_role_link_immutable BEFORE UPDATE ON module_access_role_links BEGIN SELECT RAISE(ABORT,'module_access_immutable'); END;

-- The committing statement repeats every decision: typed confirming control with exact digest and revision, current
-- owner, unexpired review, unchanged access revision and configuration revision; a grant additionally needs an
-- active access instance whose configuration declares `staff`, an unrevoked visitor and composed core.editing
-- inclusion (`admitted`); a revoke needs only the current grant, identity and ownership (any activation state).
CREATE TRIGGER module_access_role_apply_admit BEFORE INSERT ON module_access_role_applies BEGIN
 SELECT RAISE(ABORT,'module_access_forbidden') WHERE NEW.admitted IS NOT 1;
 SELECT RAISE(ABORT,'module_access_changed') WHERE NOT EXISTS(SELECT 1 FROM module_access_role_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='accessRoleApply' AND json_extract(t.action_json,'$.reviewId')=r.id
   AND json_extract(t.action_json,'$.reviewDigest')=r.review_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=r.expected_access_revision
  WHERE r.id=NEW.review_id AND r.user_id=NEW.user_id AND r.review_digest=NEW.review_digest AND NEW.access_revision=r.expected_access_revision+1);
 SELECT RAISE(ABORT,'module_access_expired') WHERE (SELECT expires_at FROM module_access_role_reviews WHERE id=NEW.review_id)<=unixepoch() OR abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'module_access_changed') WHERE EXISTS(SELECT 1 FROM module_access_role_reviews r WHERE r.id=NEW.review_id AND (
  NOT EXISTS(SELECT 1 FROM module_access_states s JOIN module_instances i ON i.id=s.instance_id WHERE s.instance_id=r.instance_id AND s.project_id=r.project_id AND s.revision=r.expected_access_revision AND i.config_revision=r.config_revision)
  OR (r.action='revoke' AND NOT EXISTS(SELECT 1 FROM module_access_roles WHERE instance_id=r.instance_id AND visitor_id=r.visitor_id AND role=r.role AND state='granted'))
  OR (r.action='grant' AND (EXISTS(SELECT 1 FROM module_access_roles WHERE instance_id=r.instance_id AND visitor_id=r.visitor_id AND role=r.role AND state='granted')
   OR NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=r.visitor_id AND project_id=r.project_id AND access_id=r.instance_id AND revoked=0)
   OR NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.id=r.instance_id AND a.state='active'
    AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.roles') WHERE value=r.role))))));
END;
CREATE TRIGGER module_access_role_apply AFTER INSERT ON module_access_role_applies BEGIN
 UPDATE module_access_roles SET state=CASE (SELECT action FROM module_access_role_reviews WHERE id=NEW.review_id) WHEN 'grant' THEN 'granted' ELSE 'revoked' END,
  review_id=NEW.review_id,access_revision=NEW.access_revision,updated_at=max(updated_at,NEW.created_at)
  WHERE (instance_id,visitor_id,role)=(SELECT instance_id,visitor_id,role FROM module_access_role_reviews WHERE id=NEW.review_id);
 INSERT INTO module_access_roles(instance_id,visitor_id,project_id,role,state,review_id,access_revision,granted_at,updated_at)
  SELECT r.instance_id,r.visitor_id,r.project_id,r.role,'granted',r.id,NEW.access_revision,NEW.created_at,NEW.created_at FROM module_access_role_reviews r
  WHERE r.id=NEW.review_id AND r.action='grant' AND NOT EXISTS(SELECT 1 FROM module_access_roles x WHERE x.instance_id=r.instance_id AND x.visitor_id=r.visitor_id AND x.role=r.role);
 UPDATE module_access_states SET revision=NEW.access_revision,updated_at=max(updated_at,NEW.created_at)
  WHERE instance_id=(SELECT instance_id FROM module_access_role_reviews WHERE id=NEW.review_id) AND revision=NEW.access_revision-1;
 SELECT RAISE(ABORT,'module_access_changed') WHERE NOT EXISTS(SELECT 1 FROM module_access_states s JOIN module_access_role_reviews r ON r.instance_id=s.instance_id WHERE r.id=NEW.review_id AND s.revision=NEW.access_revision);
END;
CREATE TRIGGER module_access_role_apply_immutable BEFORE UPDATE ON module_access_role_applies BEGIN SELECT RAISE(ABORT,'module_access_immutable'); END;
CREATE TRIGGER module_access_role_review_retained BEFORE DELETE ON module_access_role_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM app_visitors WHERE id=OLD.visitor_id) AND EXISTS(SELECT 1 FROM module_instances WHERE id=OLD.instance_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'module_access_receipt_retained') WHERE NOT (EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=OLD.id) OR (NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=OLD.id) AND OLD.expires_at<=unixepoch()-3600) OR (OLD.action='revoke' AND NOT (EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=OLD.id)) AND EXISTS(SELECT 1 FROM module_access_role_reviews x WHERE x.expires_at>OLD.expires_at AND x.action='revoke' AND x.instance_id||':'||x.visitor_id=OLD.instance_id||':'||OLD.visitor_id)))
  OR (EXISTS(SELECT 1 FROM module_access_roles WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=OLD.id)) OR (OLD.action='revoke') OR OLD.id NOT IN (SELECT t.id FROM module_access_role_reviews t WHERE t.project_id=OLD.project_id AND EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=t.id) AND NOT (t.action='revoke') ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='module_access_role_reviews' AND id=OLD.id AND (EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=OLD.id))=(outcome IN ('applied','withdrawn')));
END;

-- Revoking or erasing a visitor suppresses their grants and advances their access instance's revision, so
-- decisions and writes bound to the earlier principal fail at their next check or inside their commit.
CREATE TRIGGER module_access_visitor_revoked AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 AND OLD.revoked=0 BEGIN
 UPDATE module_access_roles SET state='revoked',review_id=NULL,access_revision=coalesce((SELECT revision+1 FROM module_access_states WHERE instance_id=module_access_roles.instance_id),access_revision),updated_at=max(updated_at,unixepoch())
  WHERE visitor_id=NEW.id AND state='granted';
 UPDATE module_access_states SET revision=revision+1,updated_at=max(updated_at,unixepoch()) WHERE instance_id=NEW.access_id;
END;
CREATE TRIGGER module_access_visitor_deleted AFTER DELETE ON app_visitors BEGIN
 UPDATE module_access_states SET revision=revision+1,updated_at=max(updated_at,unixepoch()) WHERE instance_id=OLD.access_id;
END;

-- WH-127 records and forms module (docs/shared-modules.md#records-and-forms-module-wh-127--october-4-2026-utc).
-- One row per accepted submission of a records instance's form (lifecycle class module-records). Values are
-- visitor-subject data readable only through the module handlers' field projections and the owner dashboard; they
-- never enter Chat, model context, receipts, events or logs. Writes happen only in the module engine's batch beside its
-- request receipt; the triggers below repeat the instance, form, schema, retention, revision and capacity decisions.
CREATE TABLE module_records (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 schema_id TEXT NOT NULL CHECK(length(schema_id) BETWEEN 1 AND 40 AND schema_id NOT GLOB '*[^a-z0-9-]*'),
 form_id TEXT NOT NULL CHECK(length(form_id) BETWEEN 1 AND 40 AND form_id NOT GLOB '*[^a-z0-9-]*'),
 fields_revision INTEGER NOT NULL CHECK(fields_revision>=1),
 submitter_kind TEXT NOT NULL CHECK(submitter_kind IN ('public','visitor','staff')),
 -- Anonymous submissions to a `public` form have no visitor identity; visitor and staff submissions always have one.
 visitor_id TEXT REFERENCES app_visitors(id) ON DELETE CASCADE CHECK((submitter_kind='public')=(visitor_id IS NULL)),
 values_json TEXT NOT NULL CHECK(json_valid(values_json) AND json_type(values_json)='object' AND length(CAST(values_json AS BLOB))<=8192),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_request_id TEXT NOT NULL CHECK(length(created_request_id)=36),
 last_request_id TEXT NOT NULL CHECK(length(last_request_id)=36),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+31536000),
 -- WH-157: the submitter's explicit, unticked-by-default "email me a receipt" choice; an anonymous (public) record can never consent.
 receipt_consent INTEGER NOT NULL DEFAULT 0 CHECK(receipt_consent IN (0,1)),
 CHECK(submitter_kind!='public' OR receipt_consent=0)
) STRICT;
CREATE INDEX module_records_list ON module_records(instance_id,schema_id,created_at DESC,id DESC);
CREATE INDEX module_records_visitor ON module_records(visitor_id,instance_id,created_at);
CREATE INDEX module_records_project ON module_records(project_id,expires_at);

-- Content-free change events, one per committed records write (primary key = the module request). They are the WH-069
-- `form.accepted` handoff and prove inside the batch that this request's write happened: a created record at revision
-- 1, the record at the new revision written by this request, or a removed record. No submitted value is stored here.
CREATE TABLE module_record_events (
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL CHECK(length(entry_id)=36),
 event TEXT NOT NULL CHECK(event IN ('form.accepted','record.updated','record.removed')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(instance_id,request_id)
) STRICT;
CREATE INDEX module_record_events_project ON module_record_events(project_id,created_at);
CREATE INDEX module_record_events_entry ON module_record_events(entry_id);

-- Anonymous (`public`) submissions reuse the contact form's admission (docs/contact-forms.md#submission-boundary): the
-- visitor gateway runs Turnstile Siteverify and the per-connection allowance before the engine commits, and this trigger
-- repeats a `public` form on a published project and the contact caps over this project's anonymous module receipts
-- (receipts outlive owner removal, so deleting records never recycles the allowance): 20 per hour (or the operator's
-- `contact` containment allowance), 100 per project and 1,000 platform-wide in 30 days, and above 500 platform-wide an
-- account already holding 100 is refused.
CREATE TRIGGER module_record_admit BEFORE INSERT ON module_records BEGIN
 SELECT RAISE(ABORT,'module_request_unavailable') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id AND a.state='active'
  WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND i.kind='records'
  AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.forms') f WHERE json_extract(f.value,'$.id')=NEW.form_id AND json_extract(f.value,'$.recordId')=NEW.schema_id
   AND (json_extract(f.value,'$.uploadCollectionId') IS NULL OR json_extract(f.value,'$.submit')!='public') -- decision D6: a public form never takes uploads
   AND (NEW.submitter_kind!='public' OR json_extract(f.value,'$.submit')='public'))
  AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.schemas') s WHERE json_extract(s.value,'$.id')=NEW.schema_id AND json_extract(s.value,'$.fieldsRevision')=NEW.fields_revision)
  AND NEW.expires_at=NEW.created_at+86400*json_extract(i.config_json,'$.retentionDays'))
  OR NEW.submitter_kind='public' AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL);
 SELECT RAISE(ABORT,'module_request_stale') WHERE NEW.revision!=1 OR NEW.last_request_id!=NEW.created_request_id OR NEW.updated_at!=NEW.created_at OR abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'module_request_forbidden') WHERE NEW.visitor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=NEW.visitor_id AND project_id=NEW.project_id AND revoked=0);
 SELECT RAISE(ABORT,'module_request_limited') WHERE (SELECT count(*) FROM module_records WHERE instance_id=NEW.instance_id)>=10000
  OR (SELECT count(*) FROM module_records WHERE project_id=NEW.project_id)>=20000
  OR NEW.visitor_id IS NOT NULL AND (SELECT count(*) FROM module_records WHERE visitor_id=NEW.visitor_id AND instance_id=NEW.instance_id AND created_at>unixepoch()-3600)>=20;
 SELECT RAISE(ABORT,'module_request_limited') WHERE NEW.submitter_kind='public' AND (
  (SELECT count(*) FROM module_request_receipts WHERE project_id=NEW.project_id AND principal_kind='public' AND created_at>unixepoch()-3600)
   >=coalesce((SELECT coalesce(allowance,0) FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='contact' ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1),20)
  OR (SELECT count(*) FROM module_request_receipts WHERE project_id=NEW.project_id AND principal_kind='public' AND created_at>unixepoch()-2592000)>=100
  OR (SELECT count(*) FROM module_request_receipts WHERE principal_kind='public' AND created_at>unixepoch()-2592000)>=1000
  OR (SELECT count(*) FROM module_request_receipts WHERE principal_kind='public' AND created_at>unixepoch()-2592000)>=500
   AND (SELECT count(*) FROM module_request_receipts r JOIN projects p ON p.id=r.project_id WHERE r.principal_kind='public' AND r.created_at>unixepoch()-2592000
    AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=100);
END;
-- Identity, submitter, schema and retention never change; every change advances the revision by one under a new request,
-- and an expired record cannot be changed.
CREATE TRIGGER module_record_update BEFORE UPDATE ON module_records
WHEN NEW.id IS NOT OLD.id OR NEW.instance_id IS NOT OLD.instance_id OR NEW.project_id IS NOT OLD.project_id OR NEW.schema_id IS NOT OLD.schema_id OR NEW.form_id IS NOT OLD.form_id
 OR NEW.fields_revision IS NOT OLD.fields_revision OR NEW.submitter_kind IS NOT OLD.submitter_kind OR NEW.visitor_id IS NOT OLD.visitor_id OR NEW.created_request_id IS NOT OLD.created_request_id
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.receipt_consent IS NOT OLD.receipt_consent OR NEW.revision!=OLD.revision+1 OR NEW.last_request_id=OLD.last_request_id OR NEW.updated_at<OLD.updated_at
 OR OLD.expires_at<=unixepoch()
BEGIN SELECT RAISE(ABORT,'module_request_stale'); END;
-- Ordinary removal and expiry never delete inside an active safety preservation hold (WH-132 inventory: blocked).
CREATE TRIGGER safety_hold_module_record_retained BEFORE DELETE ON module_records
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER module_record_event_admit BEFORE INSERT ON module_record_events BEGIN
 SELECT RAISE(ABORT,'module_request_stale') WHERE abs(NEW.created_at-unixepoch())>60 OR CASE NEW.event
  WHEN 'form.accepted' THEN NOT EXISTS(SELECT 1 FROM module_records WHERE id=NEW.entry_id AND instance_id=NEW.instance_id AND project_id=NEW.project_id AND revision=1 AND created_request_id=NEW.request_id AND NEW.revision=1)
  WHEN 'record.updated' THEN NOT EXISTS(SELECT 1 FROM module_records WHERE id=NEW.entry_id AND instance_id=NEW.instance_id AND project_id=NEW.project_id AND revision=NEW.revision AND last_request_id=NEW.request_id)
  ELSE EXISTS(SELECT 1 FROM module_records WHERE id=NEW.entry_id) END;
END;
-- WH-127 form attachments (schema batch 3b; docs/shared-modules.md#form-attachments-wh-127--october-29-2026-utc). A record created through a form
-- with an `uploadCollectionId` may link up to four of the submitter's own module uploads, written in the same batch as the
-- record. The links cascade with the record; file_id is unique so one upload is attached once. Removing the record
-- (owner removal, retention expiry, visitor erasure, instance/project deletion) also deletes the attached photo rows
-- (interim default pending an owner retention decision; module_record_files_removed).
CREATE TABLE module_record_files (
 entry_id TEXT NOT NULL REFERENCES module_records(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL UNIQUE REFERENCES module_files(file_id) ON DELETE CASCADE,
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 PRIMARY KEY(entry_id,file_id)
) STRICT;
CREATE INDEX module_record_files_project ON module_record_files(project_id);
CREATE INDEX module_record_files_instance ON module_record_files(instance_id);
-- The link repeats, inside the commit: the record is this request's new record on a non-public form with an upload
-- collection; the file is the submitter's own staff/visitor upload into exactly that collection, in a files instance that
-- is a declared dependency of the records instance, written within the last 60 seconds; at most four per record.
CREATE TRIGGER module_record_file_admit BEFORE INSERT ON module_record_files BEGIN
 SELECT RAISE(ABORT,'module_request_forbidden') WHERE NOT EXISTS(SELECT 1 FROM module_records r JOIN module_instances i ON i.id=r.instance_id AND i.project_id=r.project_id
   JOIN json_each(i.config_json,'$.forms') f ON json_extract(f.value,'$.id')=r.form_id AND json_extract(f.value,'$.uploadCollectionId') IS NOT NULL AND json_extract(f.value,'$.submit')!='public'
   JOIN module_files mf ON mf.file_id=NEW.file_id AND mf.project_id=r.project_id AND mf.visitor_id=r.visitor_id AND mf.uploader_kind=r.submitter_kind AND mf.collection_id=json_extract(f.value,'$.uploadCollectionId')
   JOIN module_instances fi ON fi.id=mf.instance_id AND fi.project_id=r.project_id AND fi.kind='files' AND fi.id IN (SELECT value FROM json_each(i.dependencies_json))
  WHERE r.id=NEW.entry_id AND r.instance_id=NEW.instance_id AND r.project_id=NEW.project_id AND r.revision=1 AND r.created_request_id=NEW.request_id AND r.visitor_id IS NOT NULL);
 SELECT RAISE(ABORT,'module_request_stale') WHERE NOT EXISTS(SELECT 1 FROM module_files WHERE file_id=NEW.file_id AND created_at>unixepoch()-60 AND created_at<=unixepoch()+60);
 SELECT RAISE(ABORT,'module_request_limited') WHERE (SELECT count(*) FROM module_record_files WHERE entry_id=NEW.entry_id)>=4;
END;
CREATE TRIGGER module_record_file_immutable BEFORE UPDATE ON module_record_files BEGIN SELECT RAISE(ABORT,'module_request_immutable'); END;
-- BEFORE, not AFTER: SQLite runs the foreign-key cascade (which removes the links) before AFTER triggers, so an AFTER
-- trigger would find nothing to delete. A held file refuses the photo delete (safety_hold_file_retained), aborting the record delete.
CREATE TRIGGER module_record_files_removed BEFORE DELETE ON module_records BEGIN
 DELETE FROM project_files WHERE id IN (SELECT file_id FROM module_record_files WHERE entry_id=OLD.id);
END;
CREATE TRIGGER module_record_event_immutable BEFORE UPDATE ON module_record_events BEGIN SELECT RAISE(ABORT,'module_request_immutable'); END;

-- WH-128 files and galleries module (docs/shared-modules.md#files-and-galleries-module-wh-128--october-4-2026-utc).
-- A module upload is an ordinary project photo row (project_files: cleaned JPEG up to 1 MiB, create-only private R2
-- object under photos/, project/account/platform quotas, pending safety receipt written by project_photo_safety_insert,
-- exact-digest approval view, safety holds and the cleanup queue) plus this 1:1 row naming its files instance,
-- collection and uploader. Upload authority is the collection's role policy, repeated here and in the engine's receipt
-- predicate; names, object keys and prefixes are never consulted. Staff/visitor module uploads are not part of the owner's
-- Chat/model photo library (lifecycle class module-files). An `owner` row files one of the project's existing owner photos
-- into an owner collection (upload lists owner) without a second object or row; that photo stays in the owner's library.
-- Written only beside the engine's request receipt.
CREATE TABLE module_files (
 file_id TEXT PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 collection_id TEXT NOT NULL CHECK(length(collection_id) BETWEEN 1 AND 40 AND collection_id NOT GLOB '*[^a-z0-9-]*'),
 uploader_kind TEXT NOT NULL CHECK(uploader_kind IN ('owner','staff','visitor')),
 visitor_id TEXT REFERENCES app_visitors(id) CHECK((uploader_kind='owner')=(visitor_id IS NULL)),
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(instance_id,request_id)
) STRICT;
CREATE INDEX module_files_collection ON module_files(instance_id,collection_id,created_at DESC,file_id DESC);
CREATE INDEX module_files_visitor ON module_files(visitor_id,instance_id,created_at);
CREATE INDEX module_files_project ON module_files(project_id);

CREATE TRIGGER module_file_admit BEFORE INSERT ON module_files BEGIN
 SELECT RAISE(ABORT,'module_request_unavailable') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id AND a.state='active'
  WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND i.kind='files'
  AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.collections') c WHERE json_extract(c.value,'$.id')=NEW.collection_id
   AND EXISTS(SELECT 1 FROM json_each(c.value,'$.upload') u WHERE u.value=NEW.uploader_kind)));
 -- Staff/visitor uploads are photo rows written in the same batch (no Chat handoff); an owner row names an existing
 -- ready owner photo of the same project, whatever its upload handoff was.
 SELECT RAISE(ABORT,'module_request_stale') WHERE abs(NEW.created_at-unixepoch())>60 OR NOT EXISTS(SELECT 1 FROM project_files f
  WHERE f.id=NEW.file_id AND f.project_id=NEW.project_id AND f.status='ready' AND (NEW.uploader_kind='owner' OR f.handoff_json='null') AND f.object_key='photos/'||NEW.project_id||'/'||NEW.file_id||'.jpg');
 SELECT RAISE(ABORT,'module_request_forbidden') WHERE NEW.uploader_kind!='owner' AND NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=NEW.visitor_id AND project_id=NEW.project_id AND revoked=0)
  OR NEW.uploader_kind='staff' AND NOT EXISTS(SELECT 1 FROM module_access_roles r JOIN module_instances i ON i.id=NEW.instance_id
   WHERE r.visitor_id=NEW.visitor_id AND r.role='staff' AND r.state='granted' AND r.instance_id IN (SELECT value FROM json_each(i.dependencies_json)));
 SELECT RAISE(ABORT,'module_request_limited') WHERE (SELECT count(*) FROM module_files WHERE visitor_id=NEW.visitor_id AND instance_id=NEW.instance_id AND created_at>unixepoch()-3600)>=10;
END;
CREATE TRIGGER module_file_immutable BEFORE UPDATE ON module_files BEGIN SELECT RAISE(ABORT,'module_request_immutable'); END;
-- A visitor's reviewed erasure (or owner erasure) removes their uploads with them: the photo rows go first, which
-- queues their objects for cleanup and cascades this table; held files refuse the delete (safety_hold_file_retained).
CREATE TRIGGER module_file_visitor_erased BEFORE DELETE ON app_visitors BEGIN
 DELETE FROM project_files WHERE id IN (SELECT file_id FROM module_files WHERE visitor_id=OLD.id);
END;
-- Removing a files instance (only possible with its project today) removes its staff/visitor uploads as photo rows too,
-- so they are never left behind as owner library photos; held files refuse the delete. Owner-filed photos stay in the
-- owner's library: only their collection rows cascade.
CREATE TRIGGER module_file_instance_removed BEFORE DELETE ON module_instances WHEN OLD.kind='files' BEGIN
 DELETE FROM project_files WHERE id IN (SELECT file_id FROM module_files WHERE instance_id=OLD.id AND uploader_kind!='owner');
END;
-- Staff/visitor module uploads are visitor-subject data and never become website photo references, so they can never be
-- published; only owner photos (filed in a collection or not) pass, and version_photo_safety still needs the approval.
CREATE TRIGGER module_file_not_published BEFORE INSERT ON version_photos
WHEN EXISTS(SELECT 1 FROM module_files WHERE file_id=NEW.file_id AND uploader_kind!='owner')
BEGIN SELECT RAISE(ABORT,'version_photo_owner'); END;

-- WH-128 owner photo collection setup. A proposal prepared by the typed filesModuleReview control is exactly the current
-- head plus one appended standard files instance (id photos, module-files, no dependencies, one collection library with
-- owner read, owner-only upload, the 1 MiB photo bound, JPEG only and no gallery, and no other keys) in a project whose
-- head and registry have no instance using the id photos and no files instance with an owner collection or a library
-- collection; nothing else in the specification may change.
CREATE TRIGGER project_spec_files_setup_admit BEFORE INSERT ON project_spec_proposals
WHEN EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='filesModuleReview') BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
  WHERE h.project_id=NEW.project_id AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND json_array_length(NEW.spec_json,'$.instances')=json_array_length(v.spec_json,'$.instances')+1
  AND json(json_remove(NEW.spec_json,'$.instances[#-1]'))=json(v.spec_json)
  AND NOT EXISTS(SELECT 1 FROM json_each(v.spec_json,'$.instances') e WHERE json_extract(e.value,'$.id')='photos'
   OR json_extract(e.value,'$.kind')='files' AND EXISTS(SELECT 1 FROM json_each(e.value,'$.config.collections') c WHERE json_extract(c.value,'$.id')='library'
    OR EXISTS(SELECT 1 FROM json_each(c.value,'$.upload') u WHERE u.value='owner')))
  AND NOT EXISTS(SELECT 1 FROM module_instances i WHERE i.project_id=NEW.project_id AND (i.local_id='photos'
   OR i.kind='files' AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.collections') c WHERE EXISTS(SELECT 1 FROM json_each(c.value,'$.upload') u WHERE u.value='owner'))))
  AND (SELECT count(*) FROM json_each(NEW.spec_json,'$.instances[#-1]'))=6
  AND json_extract(NEW.spec_json,'$.instances[#-1].id')='photos' AND json_extract(NEW.spec_json,'$.instances[#-1].kind')='files'
  AND json_extract(NEW.spec_json,'$.instances[#-1].module.name')='module-files' AND json_extract(NEW.spec_json,'$.instances[#-1].schema.name')='files-data'
  AND json_array_length(NEW.spec_json,'$.instances[#-1].dependencies')=0
  AND (SELECT count(*) FROM json_each(NEW.spec_json,'$.instances[#-1].config'))=1 AND json_array_length(NEW.spec_json,'$.instances[#-1].config.collections')=1
  AND (SELECT count(*) FROM json_each(NEW.spec_json,'$.instances[#-1].config.collections[0]'))=6
  AND json_extract(NEW.spec_json,'$.instances[#-1].config.collections[0].id')='library' AND json_extract(NEW.spec_json,'$.instances[#-1].config.collections[0].read')='owner'
  AND json_array_length(NEW.spec_json,'$.instances[#-1].config.collections[0].upload')=1 AND json_extract(NEW.spec_json,'$.instances[#-1].config.collections[0].upload[0]')='owner'
  AND json_extract(NEW.spec_json,'$.instances[#-1].config.collections[0].maxBytes')=1048576
  AND json_array_length(NEW.spec_json,'$.instances[#-1].config.collections[0].mediaTypes')=1 AND json_extract(NEW.spec_json,'$.instances[#-1].config.collections[0].mediaTypes[0]')='image/jpeg'
  AND json_type(NEW.spec_json,'$.instances[#-1].config.collections[0].gallery')='null'
 );
END;

-- WH-128 published gallery. A proposal prepared by the typed galleryPageReview control is exactly the current head with
-- only the named page's photos (and its photo component) replaced by one to four photos that the owner filed into the
-- named collection of this project's registered files instance and that currently have an exact-digest approval.
-- Nothing else in the specification may change. Saving and publication keep their own photo safety triggers.
CREATE TRIGGER project_spec_gallery_admit BEFORE INSERT ON project_spec_proposals
WHEN EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='galleryPageReview') BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN project_spec_heads h ON h.project_id=NEW.project_id JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
   JOIN json_each(v.spec_json,'$.pages') pg ON json_extract(pg.value,'$.id')=json_extract(t.action_json,'$.pageId')
  WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.projectId')=NEW.project_id
  AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND json_array_length(NEW.spec_json,'$.pages['||pg.key||'].photos') BETWEEN 1 AND 4
  AND json_extract(NEW.spec_json,'$.pages['||pg.key||'].component')='photo-page@1'
  AND json(json_set(v.spec_json,'$.pages['||pg.key||'].photos',json(json_extract(NEW.spec_json,'$.pages['||pg.key||'].photos')),'$.pages['||pg.key||'].component','photo-page@1'))=json(NEW.spec_json)
  AND NOT EXISTS(SELECT 1 FROM json_each(NEW.spec_json,'$.pages['||pg.key||'].photos') ph WHERE NOT EXISTS(
   SELECT 1 FROM module_files mf JOIN module_instances i ON i.id=mf.instance_id AND i.project_id=mf.project_id AND i.kind='files'
    JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id JOIN approved_project_photos safe ON safe.id=f.id AND safe.digest=f.digest
   WHERE mf.file_id=json_extract(ph.value,'$.id') AND mf.project_id=NEW.project_id AND mf.uploader_kind='owner' AND f.status='ready'
   AND i.local_id=json_extract(t.action_json,'$.instanceId') AND mf.collection_id=json_extract(t.action_json,'$.collectionId')))
 );
END;

-- WH-157 notification recipients (schema batch 3c; docs/notifications.md#recipient-scopes G-N7). Nothing here sends: the sender is
-- blocked on WH-036/WH-202. Recipients derive only from these records; the suppression list is the existing per-account
-- contact_notification_suppressions (decision D5: reused across scopes, keyed by the project owner, no rename).
-- A project visitor's notification address lives and dies with the visitor identity (interim default pending an owner decision).
-- The code is stored only as a hash; no code is stored while delivery is unavailable.
CREATE TABLE visitor_notification_addresses (
 visitor_id TEXT PRIMARY KEY REFERENCES app_visitors(id) ON DELETE CASCADE,
 address TEXT NOT NULL CHECK(length(address) BETWEEN 3 AND 254 AND address=lower(address)),
 code_hash TEXT CHECK(code_hash IS NULL OR (length(code_hash)=64 AND code_hash NOT GLOB '*[^0-9a-f]*')),
 code_expires_at INTEGER,
 code_failures INTEGER NOT NULL DEFAULT 0 CHECK(code_failures BETWEEN 0 AND 5),
 verified_at INTEGER,
 CHECK((code_hash IS NULL)=(code_expires_at IS NULL)),
 CHECK(verified_at IS NULL OR code_hash IS NULL)
) STRICT;
-- Staff opt-in: granting the staff role never opts anyone in. Removed with the role (trigger below), the address or the visitor.
CREATE TABLE staff_notification_optins (
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 opted_in_at INTEGER NOT NULL CHECK(opted_in_at>0),
 PRIMARY KEY(instance_id,visitor_id)
) STRICT;
CREATE INDEX staff_notification_optins_visitor ON staff_notification_optins(visitor_id);
CREATE TRIGGER visitor_notification_address_admit BEFORE INSERT ON visitor_notification_addresses BEGIN
 SELECT RAISE(ABORT,'notification_address_state') WHERE NEW.code_hash IS NOT NULL OR NEW.verified_at IS NOT NULL OR NEW.code_failures!=0
  OR NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=NEW.visitor_id AND revoked=0);
 SELECT RAISE(ABORT,'notification_address_suppressed') WHERE EXISTS(SELECT 1 FROM contact_notification_suppressions s JOIN app_visitors v ON v.id=NEW.visitor_id JOIN projects p ON p.id=v.project_id
  WHERE s.user_id=p.owner_user_id AND s.address=NEW.address);
END;
CREATE TRIGGER visitor_notification_address_update BEFORE UPDATE ON visitor_notification_addresses BEGIN
 SELECT RAISE(ABORT,'notification_address_state') WHERE NEW.visitor_id IS NOT OLD.visitor_id
  OR NEW.address IS NOT OLD.address AND (NEW.verified_at IS NOT NULL OR NEW.code_hash IS NOT NULL)
  OR NEW.verified_at IS NOT NULL AND NEW.verified_at IS NOT OLD.verified_at AND (OLD.verified_at IS NOT NULL OR OLD.code_hash IS NULL OR OLD.code_expires_at<=unixepoch());
 SELECT RAISE(ABORT,'notification_address_suppressed') WHERE NEW.address IS NOT OLD.address AND EXISTS(SELECT 1 FROM contact_notification_suppressions s JOIN app_visitors v ON v.id=NEW.visitor_id JOIN projects p ON p.id=v.project_id
  WHERE s.user_id=p.owner_user_id AND s.address=NEW.address);
END;
-- A changed or removed address drops the opt-in that was given for the old one.
CREATE TRIGGER visitor_notification_address_changed AFTER UPDATE OF address ON visitor_notification_addresses WHEN NEW.address IS NOT OLD.address BEGIN
 DELETE FROM staff_notification_optins WHERE visitor_id=OLD.visitor_id;
END;
CREATE TRIGGER visitor_notification_address_removed AFTER DELETE ON visitor_notification_addresses BEGIN
 DELETE FROM staff_notification_optins WHERE visitor_id=OLD.visitor_id;
END;
CREATE TRIGGER staff_notification_optin_admit BEFORE INSERT ON staff_notification_optins BEGIN
 SELECT RAISE(ABORT,'notification_optin_forbidden') WHERE NOT EXISTS(SELECT 1 FROM module_access_roles r JOIN app_visitors v ON v.id=r.visitor_id AND v.project_id=r.project_id AND v.access_id=r.instance_id AND v.revoked=0
   JOIN visitor_notification_addresses a ON a.visitor_id=v.id AND a.verified_at IS NOT NULL
  WHERE r.instance_id=NEW.instance_id AND r.visitor_id=NEW.visitor_id AND r.role='staff' AND r.state='granted');
 SELECT RAISE(ABORT,'notification_address_suppressed') WHERE EXISTS(SELECT 1 FROM visitor_notification_addresses a JOIN app_visitors v ON v.id=a.visitor_id JOIN projects p ON p.id=v.project_id
  JOIN contact_notification_suppressions s ON s.user_id=p.owner_user_id AND s.address=a.address WHERE a.visitor_id=NEW.visitor_id);
END;
CREATE TRIGGER staff_notification_optin_immutable BEFORE UPDATE ON staff_notification_optins BEGIN SELECT RAISE(ABORT,'notification_optin_forbidden'); END;
-- Role revocation (also a visitor revocation, which revokes the grant) removes the opt-in, so a later re-grant does not silently opt in again.
CREATE TRIGGER staff_notification_optin_revoked AFTER UPDATE OF state ON module_access_roles WHEN NEW.state='revoked' AND OLD.state='granted' BEGIN
 DELETE FROM staff_notification_optins WHERE instance_id=NEW.instance_id AND visitor_id=NEW.visitor_id;
END;
-- A consent is only meaningful with a verified, unsuppressed address, and that is decided by the view below and by the form admission, never by refusing the record:
-- a suppressed visitor who ticks "email me a receipt" still submits, and no receipt is queued (WH-158).
-- WH-158: a notice remembers the exact address of its last attempt (`notification_notices.sent_to`) so a bounce can suppress exactly that address. It is the
-- visitor's address, so it leaves with it: removing or changing the address, or deleting the visitor (the cascade deletes the address row), clears it on that visitor's notices.
CREATE TRIGGER visitor_notification_address_erased AFTER DELETE ON visitor_notification_addresses BEGIN
 UPDATE notification_notices SET sent_to=NULL WHERE recipient_key IN ('project-staff:'||OLD.visitor_id,'submitter:'||OLD.visitor_id) AND sent_to IS NOT NULL;
END;
CREATE TRIGGER visitor_notification_address_replaced AFTER UPDATE OF address ON visitor_notification_addresses WHEN NEW.address IS NOT OLD.address BEGIN
 UPDATE notification_notices SET sent_to=NULL WHERE recipient_key IN ('project-staff:'||OLD.visitor_id,'submitter:'||OLD.visitor_id) AND sent_to IS NOT NULL;
END;
-- The single place recipients are derived (read at enqueue and again before every provider call): `ref` is the destination id (owner),
-- the visitor id (staff) or the record id (submitter). Suppression is the project owner's, across all three scopes.
CREATE VIEW notification_recipients(project_id,scope,ref,address) AS
 SELECT d.project_id,'owner',d.id,d.address FROM contact_notification_destinations d
  WHERE d.state='verified' AND NOT EXISTS(SELECT 1 FROM contact_notification_suppressions s WHERE s.user_id=d.user_id AND s.address=d.address)
 UNION ALL
 SELECT v.project_id,'staff',v.id,a.address FROM staff_notification_optins o
  JOIN module_access_roles r ON r.instance_id=o.instance_id AND r.visitor_id=o.visitor_id AND r.role='staff' AND r.state='granted'
  JOIN app_visitors v ON v.id=o.visitor_id AND v.project_id=r.project_id AND v.access_id=o.instance_id AND v.revoked=0
  JOIN visitor_notification_addresses a ON a.visitor_id=v.id AND a.verified_at IS NOT NULL
  JOIN projects p ON p.id=v.project_id
  WHERE NOT EXISTS(SELECT 1 FROM contact_notification_suppressions s WHERE s.user_id=p.owner_user_id AND s.address=a.address)
 UNION ALL
 SELECT r.project_id,'submitter',r.id,a.address FROM module_records r
  JOIN app_visitors v ON v.id=r.visitor_id AND v.project_id=r.project_id AND v.revoked=0
  JOIN visitor_notification_addresses a ON a.visitor_id=v.id AND a.verified_at IS NOT NULL
  JOIN projects p ON p.id=r.project_id
  WHERE r.receipt_consent=1 AND r.submitter_kind!='public' AND r.expires_at>unixepoch()
   AND NOT EXISTS(SELECT 1 FROM contact_notification_suppressions s WHERE s.user_id=p.owner_user_id AND s.address=a.address);

-- WH-158 customer notification configuration (docs/notifications.md; schema batch 5). One row per records instance form: which of the
-- three standard appointment presets are on (owner notice, staff notice, submitter receipt), the owner's business name, the validated
-- configuration objects (template pins, scopes, limits, sender; never an address), the provider price they were reviewed at, a revision and a
-- digest. It is written only by notification_configuration_review_apply, i.e. by an exact owner review confirmed with a typed control. Configuring
-- provisions nothing: the sender, provider and ceiling are platform facts; whether anything is sent is decided at send time.
CREATE TABLE notification_configurations (
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 form_id TEXT NOT NULL CHECK(length(form_id) BETWEEN 1 AND 40 AND form_id NOT GLOB '*[^a-z0-9-]*'),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 owner_notice INTEGER NOT NULL CHECK(owner_notice IN (0,1)),
 staff_notice INTEGER NOT NULL CHECK(staff_notice IN (0,1)),
 receipt INTEGER NOT NULL CHECK(receipt IN (0,1)),
 business_name TEXT NOT NULL CHECK(length(business_name) BETWEEN 1 AND 80),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json)='array' AND length(CAST(config_json AS BLOB))<=8192),
 price_micros INTEGER NOT NULL CHECK(price_micros>=0),
 price_checked_at TEXT NOT NULL CHECK(length(price_checked_at)=10),
 revision INTEGER NOT NULL CHECK(revision>=1),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 review_id TEXT NOT NULL UNIQUE CHECK(length(review_id)=36),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(instance_id,form_id)
) STRICT;
CREATE INDEX notification_configurations_project ON notification_configurations(project_id);
-- The exact owner review. The id is the preparing chat turn; the confirming control is a later typed `confirm` turn for this review.
CREATE TABLE notification_configuration_reviews (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 instance_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 form_id TEXT NOT NULL CHECK(length(form_id) BETWEEN 1 AND 40 AND form_id NOT GLOB '*[^a-z0-9-]*'),
 owner_notice INTEGER NOT NULL CHECK(owner_notice IN (0,1)),
 staff_notice INTEGER NOT NULL CHECK(staff_notice IN (0,1)),
 receipt INTEGER NOT NULL CHECK(receipt IN (0,1)),
 business_name TEXT NOT NULL CHECK(length(business_name) BETWEEN 1 AND 80),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND json_type(config_json)='array' AND length(CAST(config_json AS BLOB))<=8192),
 price_micros INTEGER NOT NULL CHECK(price_micros>=0),
 price_checked_at TEXT NOT NULL CHECK(length(price_checked_at)=10),
 base_revision INTEGER NOT NULL CHECK(base_revision>=0),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
) STRICT;
CREATE INDEX notification_configuration_reviews_project ON notification_configuration_reviews(project_id,user_id);
CREATE TRIGGER notification_configuration_review_insert BEFORE INSERT ON notification_configuration_reviews BEGIN
 SELECT RAISE(ABORT,'notification_configuration_changed') WHERE NEW.status!='pending' OR NEW.confirmed_by IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND i.kind='records' AND p.owner_user_id=NEW.user_id)
  OR NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.id AND user_id=NEW.user_id);
END;
CREATE TRIGGER notification_configuration_review_identity BEFORE UPDATE ON notification_configuration_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.instance_id!=OLD.instance_id OR NEW.form_id!=OLD.form_id OR NEW.owner_notice!=OLD.owner_notice OR NEW.staff_notice!=OLD.staff_notice
 OR NEW.receipt!=OLD.receipt OR NEW.business_name!=OLD.business_name OR NEW.config_json!=OLD.config_json OR NEW.price_micros!=OLD.price_micros OR NEW.price_checked_at!=OLD.price_checked_at OR NEW.base_revision!=OLD.base_revision
 OR NEW.digest!=OLD.digest OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'notification_configuration_changed'); END;
-- Confirmation: unexpired, still the owner's, confirmed by a typed `confirm` control for exactly this review (a model proposal can never be one), and still
-- on the revision it was prepared against (a configuration changed in between makes the review stale).
CREATE TRIGGER notification_configuration_review_confirm BEFORE UPDATE ON notification_configuration_reviews BEGIN
 SELECT RAISE(ABORT,'notification_configuration_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  OR NOT EXISTS(SELECT 1 FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE i.id=NEW.instance_id AND i.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id)
  OR NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='notificationConfiguration' AND json_extract(action_json,'$.reviewId')=NEW.id);
 SELECT RAISE(ABORT,'notification_configuration_stale') WHERE coalesce((SELECT revision FROM notification_configurations WHERE instance_id=NEW.instance_id AND form_id=NEW.form_id),0)!=NEW.base_revision;
END;
CREATE TRIGGER notification_configuration_review_apply AFTER UPDATE ON notification_configuration_reviews BEGIN
 INSERT INTO notification_configurations(instance_id,form_id,project_id,owner_notice,staff_notice,receipt,business_name,config_json,price_micros,price_checked_at,revision,digest,review_id,created_at)
  VALUES(NEW.instance_id,NEW.form_id,NEW.project_id,NEW.owner_notice,NEW.staff_notice,NEW.receipt,NEW.business_name,NEW.config_json,NEW.price_micros,NEW.price_checked_at,NEW.base_revision+1,NEW.digest,NEW.id,unixepoch())
  ON CONFLICT(instance_id,form_id) DO UPDATE SET owner_notice=excluded.owner_notice,staff_notice=excluded.staff_notice,receipt=excluded.receipt,business_name=excluded.business_name,config_json=excluded.config_json,
   price_micros=excluded.price_micros,price_checked_at=excluded.price_checked_at,revision=excluded.revision,digest=excluded.digest,review_id=excluded.review_id,created_at=excluded.created_at;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('notification-config:'||NEW.id,NEW.user_id,NEW.project_id,'notifications.configuration','Set the reviewed appointment email notices (nothing is sent until delivery is active)',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- Admission of a configuration row: only the maintained approved-configuration appointment templates (never a platform template), only the
-- platform sender, one revision at a time. Template digests are pinned in code against the catalog (validateNotificationConfiguration).
CREATE TRIGGER notification_configuration_admit BEFORE INSERT ON notification_configurations BEGIN
 SELECT RAISE(ABORT,'notification_configuration_platform_template') WHERE EXISTS(SELECT 1 FROM json_each(NEW.config_json) j
  WHERE json_extract(j.value,'$.template.id') IS NOT NULL AND json_extract(j.value,'$.template.id') NOT IN ('appointment.staff-notice','appointment.request-receipt'))
  OR EXISTS(SELECT 1 FROM json_each(NEW.config_json) j WHERE json_extract(j.value,'$.template.id') IS NULL OR json_extract(j.value,'$.sender')!='whumpo-notify');
 -- An upsert of an existing row fires this too; its revision is then held by notification_configuration_revise.
 SELECT RAISE(ABORT,'notification_configuration_stale') WHERE NEW.revision!=1 AND NOT EXISTS(SELECT 1 FROM notification_configurations WHERE instance_id=NEW.instance_id AND form_id=NEW.form_id);
END;
CREATE TRIGGER notification_configuration_revise BEFORE UPDATE ON notification_configurations BEGIN
 SELECT RAISE(ABORT,'notification_configuration_platform_template') WHERE EXISTS(SELECT 1 FROM json_each(NEW.config_json) j
  WHERE json_extract(j.value,'$.template.id') IS NULL OR json_extract(j.value,'$.template.id') NOT IN ('appointment.staff-notice','appointment.request-receipt') OR json_extract(j.value,'$.sender')!='whumpo-notify');
 SELECT RAISE(ABORT,'notification_configuration_stale') WHERE NEW.revision!=OLD.revision+1 OR NEW.instance_id!=OLD.instance_id OR NEW.form_id!=OLD.form_id OR NEW.project_id!=OLD.project_id;
END;

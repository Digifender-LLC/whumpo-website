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
 SELECT RAISE(ABORT,'module_activation_capacity') WHERE (SELECT count(*) FROM module_activation_reviews WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM module_activation_reviews)>=50000;
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
END;
CREATE TRIGGER module_activation_apply_immutable BEFORE UPDATE ON module_activation_applies BEGIN SELECT RAISE(ABORT,'module_activation_immutable'); END;
-- Applied receipts keep their review: a review with a receipt is never pruned.
CREATE TRIGGER module_activation_review_retained BEFORE DELETE ON module_activation_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM module_activation_applies WHERE review_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'module_activation_receipt_retained'); END;

-- Identity, project, local id and kind never change; configuration revisions only advance.
CREATE TRIGGER module_instance_update BEFORE UPDATE ON module_instances
WHEN NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.local_id IS NOT OLD.local_id OR NEW.kind IS NOT OLD.kind OR NEW.created_at IS NOT OLD.created_at
 OR NEW.module_digest IS NOT OLD.module_digest OR NEW.schema_digest IS NOT OLD.schema_digest OR NEW.config_revision<OLD.config_revision
 OR (NEW.config_revision=OLD.config_revision AND NEW.config_digest IS NOT OLD.config_digest)
BEGIN SELECT RAISE(ABORT,'module_instance_immutable'); END;
CREATE TRIGGER module_activation_update BEFORE UPDATE ON module_activations
WHEN NEW.instance_id IS NOT OLD.instance_id OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'module_instance_immutable'); END;

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
 SELECT RAISE(ABORT,'module_request_limited') WHERE (SELECT count(*) FROM module_request_receipts WHERE instance_id=NEW.instance_id)>=20000 OR abs(NEW.created_at-unixepoch())>60;
END;
CREATE TRIGGER module_request_receipt_immutable BEFORE UPDATE ON module_request_receipts BEGIN SELECT RAISE(ABORT,'module_request_immutable'); END;

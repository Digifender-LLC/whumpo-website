-- WH-091 owner brand kits and saved sections (docs/brand-kits.md). Tenant-owned, owner-only, versioned and immutable per version.
-- A project never reads these tables when it compiles or serves: applying a kit copies one version's tokens into that project's
-- specification through the exact website review (D57), so editing or deleting a kit never changes a saved or published site.
-- Tokens are validated by src/brand-tokens.ts (closed shape, #rrggbb colors, fixed font/radius/density keys, 4.5:1 contrast) before
-- insert; SQL only bounds size and shape. No logo bytes live here: a logo is an approved photo of the target project, chosen at apply.
CREATE TABLE brand_kits (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60 AND trim(name)=name),
 latest_version INTEGER NOT NULL CHECK(latest_version BETWEEN 1 AND 50),
 created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 20 AND 30),
 updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 20 AND 30)
) STRICT;
CREATE INDEX brand_kits_owner ON brand_kits(owner_user_id,updated_at DESC);
CREATE TABLE brand_kit_versions (
 kit_id TEXT NOT NULL REFERENCES brand_kits(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 50),
 tokens_json TEXT NOT NULL CHECK(json_valid(tokens_json) AND json_type(tokens_json)='object' AND length(tokens_json) BETWEEN 2 AND 1024),
 tokens_digest TEXT NOT NULL CHECK(length(tokens_digest)=64 AND tokens_digest NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 20 AND 30),
 PRIMARY KEY(kit_id,version)
) STRICT;
CREATE TABLE saved_sections (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60 AND trim(name)=name),
 latest_version INTEGER NOT NULL CHECK(latest_version BETWEEN 1 AND 50),
 created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 20 AND 30),
 updated_at TEXT NOT NULL CHECK(length(updated_at) BETWEEN 20 AND 30)
) STRICT;
CREATE INDEX saved_sections_owner ON saved_sections(owner_user_id,updated_at DESC);
CREATE TABLE saved_section_versions (
 section_id TEXT NOT NULL REFERENCES saved_sections(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 50),
 content_json TEXT NOT NULL CHECK(json_valid(content_json) AND json_type(content_json)='object' AND length(content_json) BETWEEN 2 AND 2048),
 content_digest TEXT NOT NULL CHECK(length(content_digest)=64 AND content_digest NOT GLOB '*[^0-9a-f]*'),
 created_at TEXT NOT NULL CHECK(length(created_at) BETWEEN 20 AND 30),
 PRIMARY KEY(section_id,version)
) STRICT;

-- Bounded per owner, enforced in the commit so a race cannot exceed it.
CREATE TRIGGER brand_kits_capacity BEFORE INSERT ON brand_kits
WHEN (SELECT count(*) FROM brand_kits WHERE owner_user_id=NEW.owner_user_id)>=20 BEGIN SELECT RAISE(ABORT,'brand_kit_capacity'); END;
CREATE TRIGGER saved_sections_capacity BEFORE INSERT ON saved_sections
WHEN (SELECT count(*) FROM saved_sections WHERE owner_user_id=NEW.owner_user_id)>=60 BEGIN SELECT RAISE(ABORT,'saved_section_capacity'); END;
-- Versions only append, in order, and never change: a published or reviewed site can always be traced to the exact version.
CREATE TRIGGER brand_kit_versions_append BEFORE INSERT ON brand_kit_versions
WHEN NEW.version IS NOT (SELECT latest_version FROM brand_kits WHERE id=NEW.kit_id) BEGIN SELECT RAISE(ABORT,'brand_kit_version_order'); END;
CREATE TRIGGER brand_kit_versions_immutable BEFORE UPDATE ON brand_kit_versions BEGIN SELECT RAISE(ABORT,'brand_kit_version_immutable'); END;
CREATE TRIGGER saved_section_versions_append BEFORE INSERT ON saved_section_versions
WHEN NEW.version IS NOT (SELECT latest_version FROM saved_sections WHERE id=NEW.section_id) BEGIN SELECT RAISE(ABORT,'saved_section_version_order'); END;
CREATE TRIGGER saved_section_versions_immutable BEFORE UPDATE ON saved_section_versions BEGIN SELECT RAISE(ABORT,'saved_section_version_immutable'); END;
-- Ownership never moves.
CREATE TRIGGER brand_kits_owner_fixed BEFORE UPDATE OF owner_user_id,id,created_at ON brand_kits BEGIN SELECT RAISE(ABORT,'brand_kit_immutable'); END;
CREATE TRIGGER saved_sections_owner_fixed BEFORE UPDATE OF owner_user_id,id,created_at ON saved_sections BEGIN SELECT RAISE(ABORT,'saved_section_immutable'); END;

-- Applying a kit prepares the existing exact website review; the model never chooses tokens. The review's next specification must
-- equal the saved head with only design.brand replaced, and that brand must be one saved version of a kit this user owns.
-- Removing the brand (design.brand null) is admitted for the same control. Saving still requires specificationApply.
CREATE TRIGGER project_spec_brand_apply_admit BEFORE INSERT ON project_spec_proposals
WHEN EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type') IN('brandKitReview','brandRemoveReview')) BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
  WHERE h.project_id=NEW.project_id AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND json(json_remove(NEW.spec_json,'$.design.brand'))=json(json_remove(v.spec_json,'$.design.brand'))
  AND (json_type(NEW.spec_json,'$.design.brand')='null' OR EXISTS(SELECT 1 FROM brand_kit_versions kv JOIN brand_kits k ON k.id=kv.kit_id
   WHERE k.owner_user_id=NEW.user_id AND kv.kit_id=json_extract(NEW.spec_json,'$.design.brand.source.kitId') AND kv.version=json_extract(NEW.spec_json,'$.design.brand.source.version')
   AND json(json_extract(kv.tokens_json,'$.light'))=json(json_extract(NEW.spec_json,'$.design.brand.light'))
   AND json(json_extract(kv.tokens_json,'$.dark')) IS json(json_extract(NEW.spec_json,'$.design.brand.dark'))
   AND json_extract(kv.tokens_json,'$.font')=json_extract(NEW.spec_json,'$.design.brand.font')
   AND json_extract(kv.tokens_json,'$.radius')=json_extract(NEW.spec_json,'$.design.brand.radius')
   AND json_extract(kv.tokens_json,'$.density')=json_extract(NEW.spec_json,'$.design.brand.density'))));
END;

-- WH-091 preservation: a kit's name and logo description, and a saved section's text, are owner-written text that may be evidence.
-- While an account safety hold is active they are kept; deletion (including the account cascade) is refused like other held owner text.
CREATE TRIGGER safety_hold_brand_kit_retained BEFORE DELETE ON brand_kits
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.owner_user_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_saved_section_retained BEFORE DELETE ON saved_sections
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.owner_user_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;

-- Model and tool paths can never apply a brand: outside the typed brand controls a change must leave design.brand exactly as the saved
-- head has it, and a first draft carries none. (The typed controls are admitted by project_spec_brand_apply_admit above.)
CREATE TRIGGER project_spec_brand_unchanged BEFORE INSERT ON project_spec_proposals
WHEN NEW.operation='change' AND NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type') IN('brandKitReview','brandRemoveReview')) BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_versions v WHERE v.version_id=NEW.base_version_id AND v.project_id=NEW.project_id
  AND json(json_extract(v.spec_json,'$.design.brand')) IS json(json_extract(NEW.spec_json,'$.design.brand')));
END;
CREATE TRIGGER project_spec_first_draft_no_brand BEFORE INSERT ON project_spec_versions
WHEN NEW.revision=1 AND json_type(NEW.spec_json,'$.design.brand') IS NOT 'null' BEGIN SELECT RAISE(ABORT,'specification_changed'); END;

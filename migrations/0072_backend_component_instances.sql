-- Shared artifact identity only; tenant data stays in owned backend versions.
CREATE TABLE backend_component_instances (
 version_id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 component_id TEXT NOT NULL CHECK(length(component_id) BETWEEN 1 AND 80),
 component_version INTEGER NOT NULL CHECK(component_version>0),
 artifact_digest TEXT NOT NULL CHECK(length(artifact_digest)=64),
 provenance TEXT NOT NULL,
 license TEXT NOT NULL
);
CREATE TRIGGER backend_component_integrity BEFORE INSERT ON backend_component_instances
 WHEN NOT EXISTS(SELECT 1 FROM backend_versions v WHERE v.id=NEW.version_id AND v.digest=NEW.artifact_digest)
 BEGIN SELECT RAISE(ABORT,'backend_component_digest_mismatch'); END;
CREATE TRIGGER backend_component_immutable BEFORE UPDATE ON backend_component_instances
 BEGIN SELECT RAISE(ABORT,'backend_component_immutable'); END;
CREATE TRIGGER backend_component_retained BEFORE DELETE ON backend_component_instances
 WHEN EXISTS(SELECT 1 FROM backend_versions WHERE id=OLD.version_id)
 BEGIN SELECT RAISE(ABORT,'backend_component_retained'); END;

-- Private owner consent records only; never a shared catalog or execution queue.
CREATE TABLE backend_nominations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES backend_versions(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','nominated','withdrawn')),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consent_at TEXT,
 withdrawn_at TEXT,
 CHECK((state='review' AND consent_at IS NULL AND withdrawn_at IS NULL) OR
       (state='nominated' AND consent_at IS NOT NULL AND withdrawn_at IS NULL) OR
       (state='withdrawn' AND withdrawn_at IS NOT NULL))
);
CREATE INDEX backend_nominations_owner ON backend_nominations(user_id,created_at,id);
CREATE TRIGGER backend_nomination_insert BEFORE INSERT ON backend_nominations BEGIN
 SELECT RAISE(ABORT,'nomination_requires_review') WHERE NEW.state!='review';
 SELECT RAISE(ABORT,'nomination_owner_or_digest') WHERE NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.owner_user_id=NEW.user_id AND v.digest=NEW.digest);
 SELECT RAISE(ABORT,'nomination_capacity') WHERE (SELECT COUNT(*) FROM backend_nominations WHERE user_id=NEW.user_id)>=20 OR (SELECT COUNT(*) FROM backend_nominations WHERE user_id=NEW.user_id AND (state='nominated' OR (state='review' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))>=5;
 SELECT RAISE(ABORT,'nomination_already_open') WHERE EXISTS(SELECT 1 FROM backend_nominations WHERE user_id=NEW.user_id AND version_id=NEW.version_id AND (state='nominated' OR (state='review' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))));
END;
CREATE TRIGGER backend_nomination_update BEFORE UPDATE ON backend_nominations BEGIN
 SELECT RAISE(ABORT,'nomination_immutable') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.version_id IS NOT OLD.version_id OR NEW.digest IS NOT OLD.digest OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at;
 SELECT RAISE(ABORT,'nomination_transition') WHERE NOT ((OLD.state='review' AND NEW.state='nominated' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.state IN ('review','nominated') AND NEW.state='withdrawn' AND NEW.consent_at IS OLD.consent_at));
 SELECT RAISE(ABORT,'nomination_owner_or_digest') WHERE NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.owner_user_id=NEW.user_id AND v.digest=NEW.digest);
END;

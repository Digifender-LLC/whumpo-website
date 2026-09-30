-- Private document recovery, not a control-database or credential backup.
CREATE TABLE app_recovery_points (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX app_recovery_project ON app_recovery_points(project_id,created_at);
CREATE TABLE app_recovery_documents (
 point_id TEXT NOT NULL REFERENCES app_recovery_points(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>=0),
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096),
 PRIMARY KEY(point_id,visitor_id)
);
CREATE TRIGGER app_recovery_admit BEFORE INSERT ON app_recovery_points BEGIN
 SELECT RAISE(ABORT,'recovery_initial') WHERE NEW.sealed!=0;
 SELECT RAISE(ABORT,'recovery_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.version_id=NEW.version_id);
 SELECT RAISE(ABORT,'recovery_capacity') WHERE (SELECT count(*) FROM app_recovery_points WHERE project_id=NEW.project_id)>=10 OR (SELECT count(*) FROM app_recovery_points)>=100;
END;
CREATE TRIGGER app_recovery_capture AFTER INSERT ON app_recovery_points BEGIN
 INSERT INTO app_recovery_documents(point_id,visitor_id,revision,state_json) SELECT NEW.id,v.id,d.revision,d.state_json FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id WHERE v.project_id=NEW.project_id AND v.revoked=0;
 UPDATE app_recovery_points SET sealed=1 WHERE id=NEW.id;
END;
CREATE TRIGGER app_recovery_point_immutable BEFORE UPDATE ON app_recovery_points WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.created_at!=OLD.created_at OR OLD.sealed!=0 OR NEW.sealed!=1 BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;
CREATE TRIGGER app_recovery_document_admit BEFORE INSERT ON app_recovery_documents BEGIN
 SELECT RAISE(ABORT,'recovery_document') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points r JOIN app_visitors v ON v.project_id=r.project_id JOIN app_documents d ON d.visitor_id=v.id WHERE r.id=NEW.point_id AND r.sealed=0 AND v.id=NEW.visitor_id AND v.revoked=0 AND d.revision=NEW.revision AND d.state_json=NEW.state_json);
END;
CREATE TRIGGER app_recovery_document_delete BEFORE DELETE ON app_recovery_documents WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=OLD.point_id) AND EXISTS(SELECT 1 FROM app_visitors WHERE id=OLD.visitor_id AND revoked=0) BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;
CREATE TRIGGER app_recovery_document_immutable BEFORE UPDATE ON app_recovery_documents BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;
-- Revocation also removes retained snapshots. Erasure uses the visitor FK cascade.
CREATE TRIGGER app_recovery_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN DELETE FROM app_recovery_documents WHERE visitor_id=NEW.id; END;
CREATE TABLE app_restore_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 point_id TEXT NOT NULL REFERENCES app_recovery_points(id),
 base_revision INTEGER NOT NULL,
 roster_json TEXT NOT NULL CHECK(json_valid(roster_json) AND json_type(roster_json)='array' AND json_array_length(roster_json)<=100 AND length(CAST(roster_json AS BLOB))<=12000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
);
-- Current active roster including each document revision, in stable order.
CREATE VIEW app_recovery_rosters AS SELECT a.project_id,coalesce((SELECT json_group_array(json(row_json)) FROM (SELECT json_object('visitor',v.id,'revision',d.revision) row_json FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id WHERE v.project_id=a.project_id AND v.revoked=0 ORDER BY v.id)),'[]') roster_json FROM app_spaces a;
CREATE TRIGGER app_restore_admit BEFORE INSERT ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_initial') WHERE NEW.status!='pending';
 SELECT RAISE(ABORT,'restore_authority') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND a.version_id=r.version_id AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
 SELECT RAISE(ABORT,'restore_capacity') WHERE (SELECT count(*) FROM app_restore_reviews WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_restore_reviews)>=1000;
END;
CREATE TRIGGER app_restore_immutable BEFORE UPDATE ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_immutable') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.point_id!=OLD.point_id OR NEW.base_revision!=OLD.base_revision OR NEW.roster_json!=OLD.roster_json OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied';
 SELECT RAISE(ABORT,'restore_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND a.version_id=r.version_id AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
END;
CREATE TRIGGER app_restore_apply AFTER UPDATE OF status ON app_restore_reviews BEGIN
 UPDATE app_documents SET revision=revision+1,state_json=(SELECT state_json FROM app_recovery_documents WHERE point_id=NEW.point_id AND visitor_id=app_documents.visitor_id) WHERE visitor_id IN(SELECT json_extract(value,'$.visitor') FROM json_each(NEW.roster_json));
END;
CREATE TRIGGER app_restore_delete_guard BEFORE DELETE ON app_restore_reviews BEGIN SELECT RAISE(ABORT,'restore_immutable'); END;

-- A saved private configuration may prepare existing service reviews, never replace their approvals.
CREATE TABLE service_client_activation_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL, version_revision INTEGER NOT NULL CHECK(version_revision>0),
 spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64),
 service TEXT NOT NULL CHECK(service IN('contact','statelessForm')),
 enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 target_json TEXT NOT NULL CHECK(json_valid(target_json) AND length(CAST(target_json AS BLOB))<=4096),
 target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 preview_digest TEXT NOT NULL CHECK(length(preview_digest)=64),
 candidate_digest TEXT NOT NULL CHECK(length(candidate_digest)=64),
 policy_version TEXT NOT NULL, expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX service_client_activation_project ON service_client_activation_reviews(project_id,created_at);
CREATE INDEX service_client_activation_version ON service_client_activation_reviews(version_id);
CREATE TABLE service_client_activation_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES service_client_activation_reviews(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);
CREATE VIEW service_client_activation_state AS
 SELECT a.id,r.status FROM service_client_activation_reviews a JOIN contact_reviews r ON a.service='contact' AND r.id=a.id AND r.user_id=a.user_id AND r.project_id=a.project_id
 UNION ALL SELECT a.id,r.status FROM service_client_activation_reviews a JOIN backend_form_reviews r ON a.service='statelessForm' AND r.id=a.id AND r.user_id=a.user_id AND r.project_id=a.project_id;
CREATE VIEW service_client_activation_valid AS SELECT a.id FROM service_client_activation_reviews a
 JOIN service_client_versions v ON v.id=a.version_id AND v.project_id=a.project_id AND v.revision=a.version_revision AND v.spec_digest=a.spec_digest
 JOIN service_client_heads h ON h.project_id=v.project_id AND h.version_id=v.id AND h.revision=v.revision
 JOIN service_client_current c ON c.project_id=a.project_id AND c.owner_user_id=a.user_id
 JOIN site_versions w ON w.id=v.website_version_id AND w.project_id=a.project_id
 WHERE a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND json_extract(a.target_json,'$.projectId')=a.project_id AND json_extract(a.target_json,'$.website.versionId')=w.id AND json_extract(a.target_json,'$.website.digest')=w.digest
 AND json_extract(a.target_json,'$.publication.revision')=c.site_revision AND json_extract(a.target_json,'$.publication.versionId') IS c.live_version_id
 AND (a.enabled=0 OR c.live_version_id=w.id)
 AND json_extract(a.target_json,'$.contact.revision')=c.contact_revision AND json_extract(a.target_json,'$.contact.active')=c.contact_active
 AND json_extract(a.target_json,'$.form.revision')=c.form_revision AND json_extract(a.target_json,'$.form.reviewId') IS c.form_review_id AND json_extract(a.target_json,'$.form.active')=c.form_active
 AND json_extract(a.target_json,'$.backend.revision') IS c.backend_revision AND json_extract(a.target_json,'$.backend.reviewId') IS c.backend_review_id
 AND json_extract(a.target_json,'$.backend.versionId') IS c.backend_version_id AND json_extract(a.target_json,'$.backend.digest') IS c.backend_digest
 AND (json_type(v.spec_json,'$.statelessForm')='null' OR (json_extract(v.target_json,'$.backend.versionId')=c.backend_version_id AND json_extract(v.target_json,'$.backend.digest')=c.backend_digest))
 AND NOT EXISTS(SELECT 1 FROM service_client_held WHERE id=v.id)
 AND NOT EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=a.user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(a.spec_digest,a.manifest_digest,a.preview_digest,a.candidate_digest,json_extract(a.target_json,'$.website.digest'),json_extract(a.target_json,'$.backend.digest')))
 AND (
  a.service='contact' AND a.enabled=(json_type(v.spec_json,'$.contact')<>'null') AND EXISTS(SELECT 1 FROM contact_reviews r WHERE r.id=a.id AND r.user_id=a.user_id AND r.project_id=a.project_id AND r.status='pending' AND r.enabled=a.enabled AND r.expected_revision=c.contact_revision AND r.publication_revision=CASE WHEN c.live_version_id IS NULL THEN -1 ELSE c.site_revision END AND r.expires_at=a.expires_at)
  OR a.service='statelessForm' AND a.enabled=(json_type(v.spec_json,'$.statelessForm')<>'null') AND EXISTS(SELECT 1 FROM backend_form_reviews r WHERE r.id=a.id AND r.user_id=a.user_id AND r.project_id=a.project_id AND r.status='pending' AND r.enabled=a.enabled AND r.base_revision=c.form_revision AND r.expires_at=a.expires_at AND (a.enabled=0 AND r.config_json IS NULL AND r.site_revision=-1 AND r.backend_publication_id IS NULL OR a.enabled=1 AND r.config_json=json_extract(v.spec_json,'$.statelessForm.config') AND r.site_revision=c.site_revision AND r.backend_publication_id=c.backend_review_id))
 );
CREATE TRIGGER service_client_activation_admit BEFORE INSERT ON service_client_activation_reviews BEGIN
 SELECT RAISE(ABORT,'service_client_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.id AND user_id=NEW.user_id AND mode='ai' AND status='pending');
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_activation_reviews WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM service_client_activation_reviews)>=20000;
END;
CREATE TRIGGER service_client_activation_validate AFTER INSERT ON service_client_activation_reviews BEGIN
 SELECT RAISE(ABORT,'service_client_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_activation_valid WHERE id=NEW.id);
END;
CREATE TRIGGER service_client_activation_immutable BEFORE UPDATE ON service_client_activation_reviews BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_activation_retained BEFORE DELETE ON service_client_activation_reviews WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'service_client_receipt_retained'); END;
CREATE TRIGGER service_client_activation_link_admit BEFORE INSERT ON service_client_activation_links BEGIN
 SELECT RAISE(ABORT,'service_client_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN service_client_activation_reviews a ON a.user_id=t.user_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND a.id=NEW.review_id);
END;
CREATE TRIGGER service_client_activation_link_immutable BEFORE UPDATE ON service_client_activation_links BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_contact_confirm BEFORE UPDATE OF status ON contact_reviews WHEN NEW.status='applied' AND EXISTS(SELECT 1 FROM service_client_activation_reviews WHERE id=NEW.id) BEGIN
 SELECT RAISE(ABORT,'service_client_activation_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_activation_valid WHERE id=NEW.id);
END;
-- The original form trigger updates settings BEFORE the review row. Keep all checks
-- in this one trigger: ordering separate BEFORE triggers is not a safe contract.
DROP TRIGGER backend_form_apply;
CREATE TRIGGER backend_form_apply BEFORE UPDATE OF status ON backend_form_reviews BEGIN
 SELECT RAISE(ABORT,'service_client_activation_changed') WHERE EXISTS(SELECT 1 FROM service_client_activation_reviews WHERE id=NEW.id) AND NOT EXISTS(SELECT 1 FROM service_client_activation_valid WHERE id=NEW.id);
 SELECT RAISE(ABORT,'backend_form_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM backend_form_settings s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision);
 SELECT RAISE(ABORT,'backend_form_targets') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications s JOIN backend_publications b ON b.project_id=s.project_id JOIN backend_publication_reviews r ON r.id=b.review_id WHERE s.project_id=NEW.project_id AND s.version_id IS NOT NULL AND s.revision=NEW.site_revision AND b.review_id=NEW.backend_publication_id AND r.user_id=NEW.user_id AND r.status='applied');
 UPDATE backend_form_settings SET review_id=NEW.id,revision=revision+1 WHERE project_id=NEW.project_id;
END;
CREATE TRIGGER service_client_activation_version_retained BEFORE DELETE ON service_client_versions WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=OLD.project_id) BEGIN
 SELECT RAISE(ABORT,'service_client_version_retained') WHERE EXISTS(SELECT 1 FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id WHERE a.version_id=OLD.id AND s.status='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER service_client_activation_site_retained BEFORE DELETE ON site_versions WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=OLD.project_id) BEGIN
 SELECT RAISE(ABORT,'version_removal_service_client') WHERE EXISTS(SELECT 1 FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id JOIN service_client_versions v ON v.id=a.version_id WHERE v.website_version_id=OLD.id AND s.status='pending' AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
-- A later known hold suppresses linked public clients; it never grants clearance.
CREATE VIEW service_client_activation_held AS SELECT a.id FROM service_client_activation_reviews a
 WHERE NOT EXISTS(SELECT 1 FROM service_client_versions WHERE id=a.version_id AND project_id=a.project_id)
 OR EXISTS(SELECT 1 FROM service_client_held WHERE id=a.version_id)
 OR EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=a.user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(a.spec_digest,a.manifest_digest,a.preview_digest,a.candidate_digest,json_extract(a.target_json,'$.website.digest'),json_extract(a.target_json,'$.backend.digest')));
CREATE VIEW service_client_blocked_contacts AS SELECT c.project_id FROM contact_settings c
 JOIN contact_reviews r ON r.project_id=c.project_id AND r.expected_revision+1=c.revision AND r.status='applied' AND r.enabled=1 AND r.publication_revision=c.publication_revision
 JOIN service_client_activation_held a ON a.id=r.id;
DROP VIEW backend_live_forms;
CREATE VIEW backend_live_forms AS
 SELECT r.id,r.project_id,r.config_json,r.backend_publication_id,r.site_revision
 FROM backend_form_settings f JOIN backend_form_reviews r ON r.id=f.review_id JOIN projects p ON p.id=f.project_id AND p.owner_user_id=r.user_id JOIN publications s ON s.project_id=f.project_id JOIN backend_publications b ON b.project_id=f.project_id
 WHERE r.status='applied' AND r.enabled=1 AND s.version_id IS NOT NULL AND s.revision=r.site_revision AND b.review_id=r.backend_publication_id AND b.version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM service_client_activation_held WHERE id=r.id);
CREATE TRIGGER service_client_contact_submission BEFORE INSERT ON contact_submissions BEGIN
 SELECT RAISE(ABORT,'contact_unavailable') WHERE EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=NEW.project_id);
END;

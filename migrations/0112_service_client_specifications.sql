-- Desired service clients are private configuration, never activation authority.
CREATE TABLE service_client_proposals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 website_version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('prepare','restore')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0),
 base_version_id TEXT, base_digest TEXT, restore_version_id TEXT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=6144), spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64),
 target_json TEXT NOT NULL CHECK(json_valid(target_json) AND length(CAST(target_json AS BLOB))<=4096), target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384), manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 preview_html TEXT NOT NULL CHECK(length(CAST(preview_html AS BLOB))<=49152), preview_digest TEXT NOT NULL CHECK(length(preview_digest)=64),
 candidate_html TEXT NOT NULL CHECK(length(CAST(candidate_html AS BLOB))<=49152), candidate_digest TEXT NOT NULL CHECK(length(candidate_digest)=64),
 diff_json TEXT NOT NULL CHECK(json_valid(diff_json) AND length(CAST(diff_json AS BLOB))<=16384),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND length(CAST(envelope_json AS BLOB))<=16384),
 policy_version TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX service_client_proposals_project ON service_client_proposals(project_id,expires_at);
CREATE INDEX service_client_proposals_expiry ON service_client_proposals(expires_at);
CREATE TABLE service_client_versions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 website_version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), proposal_id TEXT NOT NULL,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=6144), spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64),
 target_json TEXT NOT NULL CHECK(json_valid(target_json) AND length(CAST(target_json AS BLOB))<=4096), target_digest TEXT NOT NULL CHECK(length(target_digest)=64),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384), manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 preview_html TEXT NOT NULL CHECK(length(CAST(preview_html AS BLOB))<=49152), preview_digest TEXT NOT NULL CHECK(length(preview_digest)=64),
 candidate_html TEXT NOT NULL CHECK(length(CAST(candidate_html AS BLOB))<=49152), candidate_digest TEXT NOT NULL CHECK(length(candidate_digest)=64),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(project_id,revision)
);
CREATE INDEX service_client_versions_website ON service_client_versions(website_version_id);
CREATE TABLE service_client_applies (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL UNIQUE, proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64), version_id TEXT NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision>0), created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id,revision)
);
CREATE TABLE service_client_heads (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), version_id TEXT NOT NULL
);
CREATE TABLE service_client_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL REFERENCES service_client_proposals(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);
-- Same projection as the read-only owned resolver. Rechecked inside apply, not just at preview.
CREATE VIEW service_client_current AS SELECT p.id project_id,p.owner_user_id,
 coalesce(s.revision,0) site_revision,s.version_id live_version_id,
 coalesce(c.revision,0) contact_revision,CASE WHEN c.enabled=1 AND s.version_id IS NOT NULL AND c.publication_revision=s.revision THEN 1 ELSE 0 END contact_active,
 coalesce(f.revision,0) form_revision,f.review_id form_review_id,CASE WHEN lf.id IS NULL THEN 0 ELSE 1 END form_active,
 CASE WHEN bv.id IS NOT NULL THEN b.revision ELSE NULL END backend_revision,r.id backend_review_id,bv.id backend_version_id,bv.digest backend_digest
 FROM projects p LEFT JOIN publications s ON s.project_id=p.id LEFT JOIN contact_settings c ON c.project_id=p.id
 LEFT JOIN backend_form_settings f ON f.project_id=p.id LEFT JOIN backend_live_forms lf ON lf.project_id=p.id
 LEFT JOIN backend_publications b ON b.project_id=p.id
 LEFT JOIN backend_publication_reviews r ON r.id=b.review_id AND r.project_id=p.id AND r.user_id=p.owner_user_id AND r.status='applied' AND r.operation='publish' AND r.version_id=b.version_id
 LEFT JOIN backend_versions bv ON bv.id=r.version_id AND bv.project_id=p.id;
CREATE VIEW service_client_held AS SELECT v.id FROM service_client_versions v JOIN projects p ON p.id=v.project_id
 WHERE EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=v.website_version_id)
 OR EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=p.owner_user_id AND d.kind='generated_artifact' AND d.required=1
 AND d.digest IN(v.spec_digest,v.manifest_digest,v.preview_digest,v.candidate_digest,json_extract(v.target_json,'$.website.digest'),json_extract(v.target_json,'$.backend.digest')));
CREATE VIEW service_client_valid_proposals AS SELECT q.id FROM service_client_proposals q
 JOIN service_client_current c ON c.project_id=q.project_id AND c.owner_user_id=q.user_id
 JOIN site_versions w ON w.id=q.website_version_id AND w.project_id=q.project_id
 LEFT JOIN service_client_heads h ON h.project_id=q.project_id LEFT JOIN service_client_versions v ON v.id=h.version_id AND v.project_id=q.project_id
 WHERE coalesce(h.revision,0)=q.expected_revision AND h.version_id IS q.base_version_id AND v.spec_digest IS q.base_digest
 AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND json_extract(q.target_json,'$.projectId')=q.project_id AND json_extract(q.target_json,'$.website.versionId')=w.id AND json_extract(q.target_json,'$.website.digest')=w.digest
 AND json_extract(q.target_json,'$.publication.revision')=c.site_revision AND json_extract(q.target_json,'$.publication.versionId') IS c.live_version_id
 AND json_extract(q.target_json,'$.contact.revision')=c.contact_revision AND json_extract(q.target_json,'$.contact.active')=c.contact_active
 AND json_extract(q.target_json,'$.form.revision')=c.form_revision AND json_extract(q.target_json,'$.form.reviewId') IS c.form_review_id AND json_extract(q.target_json,'$.form.active')=c.form_active
 AND json_extract(q.target_json,'$.backend.reviewId') IS c.backend_review_id AND json_extract(q.target_json,'$.backend.versionId') IS c.backend_version_id
 AND json_extract(q.target_json,'$.backend.revision') IS c.backend_revision AND json_extract(q.target_json,'$.backend.digest') IS c.backend_digest
 AND (q.operation='prepare' AND q.restore_version_id IS NULL OR q.operation='restore' AND EXISTS(SELECT 1 FROM service_client_versions r WHERE r.id=q.restore_version_id AND r.project_id=q.project_id AND r.website_version_id=q.website_version_id AND r.spec_json=q.spec_json AND r.lock_json=q.lock_json AND (json_type(q.spec_json,'$.statelessForm')='null' OR json_extract(r.target_json,'$.backend.versionId') IS json_extract(q.target_json,'$.backend.versionId') AND json_extract(r.target_json,'$.backend.digest') IS json_extract(q.target_json,'$.backend.digest'))))
 AND NOT EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=q.website_version_id)
 AND NOT EXISTS(SELECT 1 FROM service_client_held WHERE id IN(q.base_version_id,q.restore_version_id))
 AND NOT EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=q.user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(q.spec_digest,q.manifest_digest,q.preview_digest,q.candidate_digest,json_extract(q.target_json,'$.website.digest'),json_extract(q.target_json,'$.backend.digest')));
CREATE TRIGGER service_client_proposal_admit BEFORE INSERT ON service_client_proposals BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending' AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_proposals WHERE project_id=NEW.project_id)>=20 OR (SELECT count(*) FROM service_client_proposals)>=400;
END;
CREATE TRIGGER service_client_proposal_validate AFTER INSERT ON service_client_proposals BEGIN SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_valid_proposals WHERE id=NEW.id); END;
CREATE TRIGGER service_client_proposal_immutable BEFORE UPDATE ON service_client_proposals BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_version_immutable BEFORE UPDATE ON service_client_versions BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_apply_immutable BEFORE UPDATE ON service_client_applies BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_apply_retained BEFORE DELETE ON service_client_applies WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'service_client_receipt_retained'); END;
CREATE TRIGGER service_client_version_admit BEFORE INSERT ON service_client_versions BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=q.user_id AND t.mode='guided' AND t.user_text='/confirm-service-clients '||q.id||' '||q.proposal_digest||' '||q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND q.website_version_id=NEW.website_version_id AND NEW.revision=q.expected_revision+1
 AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.target_json=q.target_json AND NEW.target_digest=q.target_digest AND NEW.lock_json=q.lock_json AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest AND NEW.preview_html=q.preview_html AND NEW.preview_digest=q.preview_digest AND NEW.candidate_html=q.candidate_html AND NEW.candidate_digest=q.candidate_digest);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_versions WHERE project_id=NEW.project_id)>=25 OR (SELECT count(*) FROM service_client_versions)>=1000;
END;
CREATE TRIGGER service_client_apply_admit BEFORE INSERT ON service_client_applies BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id JOIN service_client_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id AND v.proposal_id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND t.user_text='/confirm-service-clients '||q.id||' '||q.proposal_digest||' '||q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.user_id=NEW.user_id AND q.project_id=NEW.project_id AND q.proposal_digest=NEW.proposal_digest AND NEW.id=NEW.version_id AND NEW.revision=q.expected_revision+1 AND v.revision=NEW.revision);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_applies WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM service_client_applies)>=20000;
END;
CREATE TRIGGER service_client_head_insert BEFORE INSERT ON service_client_heads BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_applies WHERE project_id=NEW.project_id AND version_id=NEW.version_id AND revision=NEW.revision);
END;
CREATE TRIGGER service_client_head_update BEFORE UPDATE ON service_client_heads BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NEW.project_id!=OLD.project_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM service_client_applies WHERE project_id=NEW.project_id AND version_id=NEW.version_id AND revision=NEW.revision);
END;
CREATE TRIGGER service_client_apply AFTER INSERT ON service_client_applies BEGIN
 INSERT INTO service_client_heads(project_id,revision,version_id) VALUES(NEW.project_id,NEW.revision,NEW.version_id) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,version_id=excluded.version_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('service-client:'||NEW.id,NEW.user_id,NEW.project_id,'site.services.saved','Saved reviewed private website service settings',NEW.created_at);
END;
CREATE TRIGGER service_client_link_admit BEFORE INSERT ON service_client_chat_links BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN service_client_proposals q ON q.user_id=t.user_id JOIN projects p ON p.id=q.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND q.id=NEW.proposal_id);
END;
CREATE TRIGGER service_client_link_immutable BEFORE UPDATE ON service_client_chat_links BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;
CREATE TRIGGER service_client_version_retained BEFORE DELETE ON service_client_versions
 WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=OLD.project_id) BEGIN
 SELECT RAISE(ABORT,'service_client_version_retained') WHERE EXISTS(SELECT 1 FROM service_client_heads WHERE version_id=OLD.id) OR EXISTS(SELECT 1 FROM service_client_proposals q WHERE (q.base_version_id=OLD.id OR q.restore_version_id=OLD.id) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM service_client_applies WHERE proposal_id=q.id));
END;
-- Removing an eligible underlying site version purges all full companion copies; receipts remain.
CREATE TRIGGER service_client_site_retained BEFORE DELETE ON site_versions BEGIN
 SELECT RAISE(ABORT,'version_removal_service_client') WHERE EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=OLD.project_id) AND (EXISTS(SELECT 1 FROM service_client_heads h JOIN service_client_versions v ON v.id=h.version_id WHERE v.website_version_id=OLD.id)
 OR EXISTS(SELECT 1 FROM service_client_proposals q WHERE (q.website_version_id=OLD.id OR q.base_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=OLD.id) OR q.restore_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=OLD.id)) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM service_client_applies WHERE proposal_id=q.id)));
 -- Validate before purging; separate BEFORE triggers have no safe ordering contract.
 DELETE FROM service_client_proposals WHERE website_version_id=OLD.id OR base_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=OLD.id) OR restore_version_id IN(SELECT id FROM service_client_versions WHERE website_version_id=OLD.id);
END;
CREATE TRIGGER service_client_forget_version AFTER DELETE ON service_client_versions BEGIN
 DELETE FROM service_client_proposals WHERE base_version_id=OLD.id OR restore_version_id=OLD.id OR id=OLD.proposal_id;
END;
CREATE TRIGGER service_client_head_retained BEFORE DELETE ON service_client_heads WHEN EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.owner_user_id WHERE p.id=OLD.project_id) BEGIN SELECT RAISE(ABORT,'service_client_head_retained'); END;

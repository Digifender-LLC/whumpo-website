-- Current typed Chat receipts; human messages have no action identity.
ALTER TABLE chat_turns ADD COLUMN action_json TEXT CHECK(action_json IS NULL OR (json_valid(action_json) AND json_type(action_json)='object' AND length(action_json)<=2048));
CREATE TRIGGER chat_action_guided BEFORE INSERT ON chat_turns WHEN NEW.action_json IS NOT NULL AND NEW.mode!='guided'
BEGIN SELECT RAISE(ABORT,'chat_action_mode'); END;
CREATE TRIGGER chat_action_immutable BEFORE UPDATE OF action_json,user_text ON chat_turns
WHEN NEW.action_json IS NOT OLD.action_json OR (OLD.action_json IS NOT NULL AND NEW.user_text IS NOT OLD.user_text)
BEGIN SELECT RAISE(ABORT,'chat_action_immutable'); END;

DROP TRIGGER directory_review_confirm;
CREATE TRIGGER directory_review_confirm BEFORE UPDATE ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM directories d JOIN projects p ON p.id=d.project_id WHERE d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.kind='publish' AND (NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL AND revision=NEW.publication_revision) OR NEW.snapshot_json!=(SELECT draft_json FROM directories WHERE project_id=NEW.project_id));
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='directory' AND json_extract(action_json,'$.reviewId')=NEW.id);
END;

DROP TRIGGER domain_proof_removal_guard;
CREATE TRIGGER domain_proof_removal_guard BEFORE UPDATE ON domain_proof_removals
BEGIN
 SELECT RAISE(ABORT,'domain_proof_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'domain_proof_removal_changed') WHERE NOT EXISTS(
  SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by
  WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND d.hostname=NEW.hostname AND d.token=NEW.proof_token AND d.expires_at=NEW.proof_expires_at AND p.owner_user_id=NEW.user_id
  AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='confirm' AND json_extract(t.action_json,'$.kind')='domainProof' AND json_extract(t.action_json,'$.reviewId')=NEW.id);
END;

DROP TRIGGER project_spec_apply_admit;
CREATE TRIGGER project_spec_apply_admit BEFORE INSERT ON project_spec_applies BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_proposals q JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  JOIN project_spec_versions v ON v.version_id=NEW.version_id AND v.project_id=p.id AND v.proposal_id=q.id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='specificationApply' AND json_extract(t.action_json,'$.reviewId')=q.id AND json_extract(t.action_json,'$.proposalDigest')=q.proposal_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=q.expected_revision
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

DROP TRIGGER service_client_version_admit;
CREATE TRIGGER service_client_version_admit BEFORE INSERT ON service_client_versions BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=q.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='serviceClientApply' AND json_extract(t.action_json,'$.reviewId')=q.id AND json_extract(t.action_json,'$.proposalDigest')=q.proposal_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND q.website_version_id=NEW.website_version_id AND NEW.revision=q.expected_revision+1
 AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.target_json=q.target_json AND NEW.target_digest=q.target_digest AND NEW.lock_json=q.lock_json AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest AND NEW.preview_html=q.preview_html AND NEW.preview_digest=q.preview_digest AND NEW.candidate_html=q.candidate_html AND NEW.candidate_digest=q.candidate_digest);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_versions WHERE project_id=NEW.project_id)>=25 OR (SELECT count(*) FROM service_client_versions)>=1000;
END;

DROP TRIGGER service_client_apply_admit;
CREATE TRIGGER service_client_apply_admit BEFORE INSERT ON service_client_applies BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id JOIN service_client_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id AND v.proposal_id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='serviceClientApply' AND json_extract(t.action_json,'$.reviewId')=q.id AND json_extract(t.action_json,'$.proposalDigest')=q.proposal_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.user_id=NEW.user_id AND q.project_id=NEW.project_id AND q.proposal_digest=NEW.proposal_digest AND NEW.id=NEW.version_id AND NEW.revision=q.expected_revision+1 AND v.revision=NEW.revision);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_applies WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM service_client_applies)>=20000;
END;

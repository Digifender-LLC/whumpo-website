-- WH-092 expiring guest preview links and accountless feedback (current schema input).
-- A link is an owner-issued bearer capability for exactly one owner/project/immutable saved
-- website version. Only a SHA-256 hash of its random token is stored; the raw token is shown to
-- the owner once and is never stored, exported or logged. A link grants no workspace session,
-- membership, editing, publication, spending or model authority.
-- Removing the referenced saved version clears version_id, which ends guest access while the
-- owner keeps the link record and its feedback. Account/project deletion cascades.
CREATE TABLE guest_preview_links (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT REFERENCES site_versions(id) ON DELETE SET NULL,
 version_digest TEXT NOT NULL CHECK(length(version_digest) BETWEEN 1 AND 128),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 label TEXT NOT NULL DEFAULT '' CHECK(length(label)<=80),
 feedback_enabled INTEGER NOT NULL CHECK(feedback_enabled IN (0,1)),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>=created_at+3600 AND expires_at<=created_at+604800),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at>=created_at),
 rate_window INTEGER NOT NULL DEFAULT 0 CHECK(rate_window>=0),
 rate_views INTEGER NOT NULL DEFAULT 0 CHECK(rate_views BETWEEN 0 AND 60)
) STRICT;
CREATE INDEX guest_preview_links_project ON guest_preview_links(project_id,created_at DESC);
CREATE INDEX guest_preview_links_owner ON guest_preview_links(owner_user_id);
CREATE INDEX guest_preview_links_version ON guest_preview_links(version_id);
CREATE INDEX guest_preview_links_ended ON guest_preview_links(coalesce(revoked_at,expires_at));

-- Plain bounded text from an anonymous guest holding a current link. The display name is
-- unverified and never an identity. Stored only for owner reading/resolution/deletion; no
-- Chat, model, notification or job reads it.
CREATE TABLE guest_preview_feedback (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 link_id TEXT NOT NULL REFERENCES guest_preview_links(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 display_name TEXT NOT NULL DEFAULT '' CHECK(length(display_name)<=60),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 resolved_at INTEGER CHECK(resolved_at IS NULL OR resolved_at>=created_at),
 UNIQUE(link_id,request_id)
) STRICT;
CREATE INDEX guest_preview_feedback_link ON guest_preview_feedback(link_id,created_at);
CREATE INDEX guest_preview_feedback_created ON guest_preview_feedback(created_at);

-- Issuance guard: exact owned project, existing current-format saved version with the pinned
-- digest, no recorded safety hold, server time, fresh state and bounded counts.
CREATE TRIGGER guest_preview_links_admit BEFORE INSERT ON guest_preview_links BEGIN
 SELECT RAISE(ABORT,'guest_preview_scope') WHERE NOT EXISTS(SELECT 1 FROM projects p JOIN site_versions v ON v.project_id=p.id
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.owner_user_id AND v.id=NEW.version_id AND v.digest=NEW.version_digest)
  OR NOT EXISTS(SELECT 1 FROM project_spec_versions WHERE version_id=NEW.version_id)
  OR EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id);
 SELECT RAISE(ABORT,'guest_preview_state') WHERE NEW.revoked_at IS NOT NULL OR NEW.rate_window!=0 OR NEW.rate_views!=0 OR abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'guest_preview_capacity') WHERE
  (SELECT count(*) FROM guest_preview_links WHERE project_id=NEW.project_id AND revoked_at IS NULL AND expires_at>unixepoch() AND version_id IS NOT NULL)>=20
  OR (SELECT count(*) FROM guest_preview_links WHERE project_id=NEW.project_id)>=200
  OR (SELECT count(*) FROM guest_preview_links)>=20000;
END;
-- Only one-way revocation, the version-removal FK action and the view-rate counters change.
CREATE TRIGGER guest_preview_links_update BEFORE UPDATE ON guest_preview_links
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.project_id IS NOT OLD.project_id
 OR NEW.version_digest IS NOT OLD.version_digest OR NEW.token_hash IS NOT OLD.token_hash OR NEW.request_hash IS NOT OLD.request_hash
 OR NEW.label IS NOT OLD.label OR NEW.feedback_enabled IS NOT OLD.feedback_enabled OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at) OR (NEW.version_id IS NOT OLD.version_id AND NEW.version_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'guest_preview_immutable'); END;

-- Feedback is accepted only for a current, unrevoked, feedback-enabled link whose version
-- still exists, within per-link burst/lifetime limits and per-owner/global storage bounds.
CREATE TRIGGER guest_preview_feedback_admit BEFORE INSERT ON guest_preview_feedback BEGIN
 SELECT RAISE(ABORT,'guest_preview_unavailable') WHERE NOT EXISTS(SELECT 1 FROM guest_preview_links l
  WHERE l.id=NEW.link_id AND l.feedback_enabled=1 AND l.revoked_at IS NULL AND l.expires_at>unixepoch() AND l.version_id IS NOT NULL);
 SELECT RAISE(ABORT,'guest_preview_state') WHERE NEW.resolved_at IS NOT NULL OR abs(NEW.created_at-unixepoch())>60;
 SELECT RAISE(ABORT,'guest_feedback_rate') WHERE
  (SELECT count(*) FROM guest_preview_feedback WHERE link_id=NEW.link_id AND created_at>unixepoch()-600)>=10
  OR (SELECT count(*) FROM guest_preview_feedback WHERE link_id=NEW.link_id)>=200;
 SELECT RAISE(ABORT,'guest_preview_capacity') WHERE
  (SELECT count(*) FROM guest_preview_feedback f JOIN guest_preview_links l ON l.id=f.link_id
   WHERE l.owner_user_id=(SELECT owner_user_id FROM guest_preview_links WHERE id=NEW.link_id))>=2000
  OR (SELECT count(*) FROM guest_preview_feedback)>=100000;
END;
CREATE TRIGGER guest_preview_feedback_update BEFORE UPDATE ON guest_preview_feedback
WHEN NEW.id IS NOT OLD.id OR NEW.link_id IS NOT OLD.link_id OR NEW.request_id IS NOT OLD.request_id OR NEW.request_hash IS NOT OLD.request_hash
 OR NEW.display_name IS NOT OLD.display_name OR NEW.body IS NOT OLD.body OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'guest_preview_immutable'); END;
-- Like contact submissions, visitor-supplied feedback is preserved under an active account hold.
CREATE TRIGGER safety_hold_guest_feedback_retained BEFORE DELETE ON guest_preview_feedback
WHEN EXISTS(SELECT 1 FROM guest_preview_links l JOIN safety_preservation_holds h ON h.subject_user_id=l.owner_user_id WHERE l.id=OLD.link_id AND h.released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
-- A cascading feedback delete no longer sees its parent link, so guard the link itself too.
CREATE TRIGGER safety_hold_guest_link_retained BEFORE DELETE ON guest_preview_links
WHEN EXISTS(SELECT 1 FROM guest_preview_feedback WHERE link_id=OLD.id)
 AND EXISTS(SELECT 1 FROM safety_preservation_holds WHERE subject_user_id=OLD.owner_user_id AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;

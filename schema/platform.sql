-- Current platform schema, applied to an empty database during the coordinated test reset.

-- Workspace identity inputs and policy schema are composed by tools/current-schema.mjs.

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'building', 'live', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, audience TEXT NOT NULL DEFAULT '' CHECK(length(audience)<=1000), style_notes TEXT NOT NULL DEFAULT '' CHECK(length(style_notes)<=1000), preferred_theme TEXT NOT NULL DEFAULT 'ocean' CHECK(preferred_theme IN ('ocean','clay','forest')), details_revision INTEGER NOT NULL DEFAULT 0, backend_revision INTEGER NOT NULL DEFAULT 0 CHECK(backend_revision>=0), site_draft_revision INTEGER NOT NULL DEFAULT 0 CHECK(site_draft_revision>=0));

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workspace_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  step TEXT NOT NULL DEFAULT 'idea' CHECK(step IN ('idea','name','ready')),
  idea TEXT NOT NULL DEFAULT ''
, brief_project_id TEXT, brief_stage TEXT CHECK(brief_stage IN ('audience','style')));

CREATE TABLE chat_turns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL,
  created_at TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'guided' CHECK(mode IN ('guided','ai')), status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','uncertain')), input_tokens INTEGER, output_tokens INTEGER, ai_context_allowed INTEGER NOT NULL DEFAULT 1 CHECK(ai_context_allowed IN (0,1)), action_json TEXT CHECK(action_json IS NULL OR (json_valid(action_json) AND json_type(action_json)='object' AND length(action_json)<=2048)),
  UNIQUE(user_id, revision)
);

CREATE TABLE site_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 component_id TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(length(CAST(config_json AS BLOB)) <= 8192),
 html TEXT NOT NULL CHECK(length(CAST(html AS BLOB)) <= 32768),
 digest TEXT NOT NULL,
 created_at TEXT NOT NULL
, source TEXT NOT NULL DEFAULT 'guided' CHECK(source IN ('guided','ai')), base_version_id TEXT);

CREATE TABLE publications (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 version_id TEXT REFERENCES site_versions(id) ON DELETE SET NULL
);

CREATE TABLE publication_actions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('publish','restore','unpublish')),
 version_id TEXT REFERENCES site_versions(id) ON DELETE CASCADE,
 expected_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE,
 CHECK((kind = 'unpublish' AND version_id IS NULL) OR (kind != 'unpublish' AND version_id IS NOT NULL))
);

CREATE TABLE publication_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES publication_actions(id) ON DELETE CASCADE
);

CREATE TABLE chat_exports (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE
);

CREATE TABLE project_files (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 object_key TEXT NOT NULL UNIQUE,
 digest TEXT NOT NULL,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready')),
 created_at TEXT NOT NULL,
 handoff_json TEXT NOT NULL DEFAULT 'null' CHECK(json_valid(handoff_json) AND (handoff_json='null' OR
  (json_type(handoff_json)='object' AND json_extract(handoff_json,'$.interactionId') IS NOT NULL
   AND json_type(handoff_json,'$.interactionId')='text' AND length(json_extract(handoff_json,'$.interactionId'))=36
   AND json_extract(handoff_json,'$.definitionDigest') IS NOT NULL AND json_type(handoff_json,'$.definitionDigest')='text' AND length(json_extract(handoff_json,'$.definitionDigest'))=64)))
);

-- project_id/owner_user_id let preservation holds keep queued objects of held scope (WH-132).
CREATE TABLE file_cleanup (object_key TEXT PRIMARY KEY,created_at TEXT NOT NULL,project_id TEXT,owner_user_id TEXT);

CREATE TABLE version_photos (
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 3),
 alt TEXT NOT NULL CHECK(length(alt) BETWEEN 1 AND 200),
 PRIMARY KEY(version_id,file_id),
 UNIQUE(version_id,position)
);

CREATE TABLE storage_usage (
 period TEXT PRIMARY KEY,
 read_ops INTEGER NOT NULL DEFAULT 0 CHECK(read_ops BETWEEN 0 AND 100000),
 write_ops INTEGER NOT NULL DEFAULT 0 CHECK(write_ops BETWEEN 0 AND 10000)
);

CREATE TABLE domain_claims (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 hostname TEXT NOT NULL CHECK(length(hostname) BETWEEN 3 AND 253),
 token TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 verified_at TEXT,
 created_at TEXT NOT NULL,
 UNIQUE(project_id,hostname)
);

-- Navigation provenance is independent of one-time OAuth state and credential
-- custody. A consumed/replaced callback can still return to its original Chat.
CREATE TABLE connection_chat_links (
 provider TEXT NOT NULL CHECK(provider IN ('github','cloudflare')),
 state_hash TEXT NOT NULL CHECK(length(state_hash)=64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 authority_id TEXT NOT NULL,
 interaction_id TEXT NOT NULL REFERENCES chat_interactions(id) ON DELETE CASCADE,
 definition_digest TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 PRIMARY KEY(provider,state_hash)
);
CREATE INDEX connection_chat_links_retention ON connection_chat_links(expires_at);
CREATE TRIGGER connection_chat_link_admit BEFORE INSERT ON connection_chat_links BEGIN
 SELECT RAISE(ABORT,'connection_chat_link_changed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_interactions i WHERE i.id=NEW.interaction_id AND i.user_id=NEW.user_id
   AND i.definition_digest=NEW.definition_digest AND i.state='open' AND i.removed_at IS NULL
   AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND NEW.expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(i.draft_saved_at,i.created_at),'+7 days')
   AND NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id))
   AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id)
   AND json_extract(i.envelope_json,'$.definition.cards[0].binding')='connection.'||NEW.provider||'@1');
 SELECT RAISE(ABORT,'connection_chat_link_changed') WHERE NOT EXISTS(
  SELECT 1 FROM github_oauth_states WHERE NEW.provider='github' AND user_id=NEW.user_id AND state_hash=NEW.state_hash AND authority_id=NEW.authority_id AND claimed=0 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  UNION ALL
  SELECT 1 FROM cloudflare_oauth_states WHERE NEW.provider='cloudflare' AND user_id=NEW.user_id AND state_hash=NEW.state_hash AND authority_id=NEW.authority_id AND claimed=0 AND cancelled=0 AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER connection_chat_link_immutable BEFORE UPDATE ON connection_chat_links
 BEGIN SELECT RAISE(ABORT,'connection_chat_link_changed'); END;

CREATE TABLE github_oauth_states (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL UNIQUE,
 authority_id TEXT NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
 verifier_ciphertext TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1))
);


CREATE TABLE github_token_vault (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','revoking'))
);

-- Refresh credentials have their own encrypted purpose and survive access-token
-- expiration/revocation. No automatic grant revocation or token refresh is implied.
CREATE TABLE github_refresh_custody (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 128),
 github_user_id TEXT CHECK(github_user_id IS NULL OR (length(github_user_id) BETWEEN 1 AND 16 AND github_user_id NOT GLOB '*[^0-9]*' AND substr(github_user_id,1,1)!='0' AND CAST(github_user_id AS INTEGER)<=9007199254740991)),
 ciphertext TEXT NOT NULL,
 expires_at TEXT,
 access_revoked_at TEXT
);
CREATE TRIGGER github_refresh_owner BEFORE INSERT ON github_refresh_custody
WHEN NEW.github_user_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.token_id AND user_id=NEW.user_id)
 OR NOT EXISTS(SELECT 1 FROM connection_oauth_exchanges WHERE token_id=NEW.token_id AND user_id=NEW.user_id AND provider='github' AND client_id=NEW.client_id)
BEGIN SELECT RAISE(ABORT,'github_refresh_custody_admission'); END;
CREATE TRIGGER github_refresh_identity BEFORE UPDATE ON github_refresh_custody
WHEN NEW.token_id!=OLD.token_id OR NEW.user_id!=OLD.user_id OR NEW.client_id!=OLD.client_id OR NEW.expires_at IS NOT OLD.expires_at
 OR (NEW.github_user_id IS NOT OLD.github_user_id AND OLD.github_user_id IS NOT NULL)
 OR (NEW.access_revoked_at IS NOT OLD.access_revoked_at AND (OLD.access_revoked_at IS NOT NULL OR NEW.access_revoked_at IS NULL))
BEGIN SELECT RAISE(ABORT,'github_refresh_immutable'); END;
CREATE TRIGGER github_refresh_retained BEFORE DELETE ON github_refresh_custody
WHEN NOT EXISTS(SELECT 1 FROM github_grant_revocations a WHERE a.state='revoked' AND a.user_id=OLD.user_id AND a.client_id=OLD.client_id AND a.github_user_id=OLD.github_user_id AND OLD.token_id IN (SELECT value FROM json_each(a.token_ids)))
BEGIN SELECT RAISE(ABORT,'github_refresh_grant_evidence_required'); END;
CREATE TRIGGER github_refresh_no_reactivation BEFORE UPDATE OF state ON github_token_vault
WHEN NEW.state='active' AND EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=NEW.id AND access_revoked_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'github_refresh_access_revoked'); END;

CREATE TABLE github_connections (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 github_user_id TEXT NOT NULL,
 login TEXT NOT NULL,
 active_token_id TEXT REFERENCES github_token_vault(id) ON DELETE SET NULL,
 connected_at TEXT NOT NULL
);
CREATE TRIGGER github_connection_refresh_identity_insert BEFORE INSERT ON github_connections
WHEN EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=NEW.active_token_id)
 AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=NEW.active_token_id AND user_id=NEW.user_id AND github_user_id=NEW.github_user_id)
BEGIN SELECT RAISE(ABORT,'github_connection_refresh_identity'); END;
CREATE TRIGGER github_connection_refresh_identity_update BEFORE UPDATE ON github_connections
WHEN EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=NEW.active_token_id)
 AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=NEW.active_token_id AND user_id=NEW.user_id AND github_user_id=NEW.github_user_id)
BEGIN SELECT RAISE(ABORT,'github_connection_refresh_identity'); END;

-- An explicitly reviewed app-wide effect. Terminal metadata survives deletion
-- of the exact retired credential set; unknown dispatch has no TTL/retry escape.
CREATE TABLE github_grant_revocations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 client_id TEXT NOT NULL,
 github_user_id TEXT NOT NULL,
 login TEXT NOT NULL,
 token_id TEXT NOT NULL,
 token_ids TEXT NOT NULL CHECK(json_valid(token_ids) AND json_type(token_ids)='array' AND json_array_length(token_ids) BETWEEN 1 AND 10 AND length(token_ids)<=1024),
 state TEXT NOT NULL CHECK(state IN ('review','dispatching','uncertain','revoked','cancelled')),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 dispatched_at TEXT,
 settled_at TEXT,
 http_status INTEGER,
 CHECK((state IN ('review','cancelled') AND dispatched_at IS NULL AND settled_at IS NULL AND http_status IS NULL) OR (state IN ('dispatching','uncertain') AND dispatched_at IS NOT NULL AND settled_at IS NULL AND http_status IS NULL) OR (state='revoked' AND dispatched_at IS NOT NULL AND settled_at IS NOT NULL AND http_status=204))
);
CREATE UNIQUE INDEX github_grant_pending_client ON github_grant_revocations(client_id) WHERE state IN ('dispatching','uncertain');
CREATE TRIGGER github_grant_review BEFORE INSERT ON github_grant_revocations
-- Revocations are withdrawals: never refused for capacity (WH-181, OD-5).
WHEN NEW.state!='review'
 OR NOT EXISTS(SELECT 1 FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id JOIN github_refresh_custody r ON r.token_id=t.id WHERE c.user_id=NEW.user_id AND t.user_id=NEW.user_id AND t.state='active' AND t.expires_at>NEW.created_at AND t.id=NEW.token_id AND r.client_id=NEW.client_id AND r.github_user_id=NEW.github_user_id AND c.github_user_id=NEW.github_user_id AND c.login=NEW.login)
BEGIN SELECT RAISE(ABORT,'github_grant_review'); END;
CREATE TRIGGER github_grant_identity BEFORE UPDATE ON github_grant_revocations
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.client_id!=OLD.client_id OR NEW.github_user_id!=OLD.github_user_id OR NEW.login!=OLD.login OR NEW.token_id!=OLD.token_id OR NEW.token_ids!=OLD.token_ids OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
 OR NOT ((OLD.state='review' AND NEW.state IN ('dispatching','cancelled')) OR (OLD.state='dispatching' AND NEW.state IN ('uncertain','revoked')) OR (OLD.state='uncertain' AND NEW.state='revoked'))
 OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at)
BEGIN SELECT RAISE(ABORT,'github_grant_immutable'); END;
CREATE TRIGGER github_grant_retained BEFORE DELETE ON github_grant_revocations
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'github_grant_receipt_required') WHERE NOT (OLD.state='revoked' OR (OLD.state='review' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (1 AND NOT (OLD.state='revoked') AND EXISTS(SELECT 1 FROM github_grant_revocations x WHERE x.expires_at>OLD.expires_at AND 1 AND x.token_id=OLD.token_id)) OR OLD.state='cancelled')
  OR 0
  OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id)
  OR NOT (NOT (OLD.state='revoked') OR (1) OR OLD.id NOT IN (SELECT t.id FROM github_grant_revocations t WHERE t.user_id=OLD.user_id AND t.state='revoked' AND NOT (1) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='github_grant_revocations' AND id=OLD.id AND (OLD.state='revoked')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER github_grant_dispatch BEFORE UPDATE OF state ON github_grant_revocations
WHEN NEW.state='dispatching' AND (
 NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 OR NOT EXISTS(SELECT 1 FROM github_connections c JOIN github_token_vault t ON t.id=c.active_token_id JOIN github_refresh_custody r ON r.token_id=t.id WHERE c.user_id=NEW.user_id AND c.github_user_id=NEW.github_user_id AND t.id=NEW.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND r.client_id=NEW.client_id AND r.github_user_id=NEW.github_user_id)
 OR NEW.token_ids!=(SELECT json_group_array(token_id) FROM (SELECT token_id FROM github_refresh_custody WHERE user_id=NEW.user_id AND client_id=NEW.client_id AND github_user_id=NEW.github_user_id ORDER BY token_id))
 OR EXISTS(SELECT 1 FROM github_refresh_custody WHERE client_id=NEW.client_id AND (github_user_id IS NULL OR (github_user_id=NEW.github_user_id AND user_id!=NEW.user_id)))
 OR EXISTS(SELECT 1 FROM connection_oauth_exchanges WHERE provider='github' AND client_id=NEW.client_id)
 OR EXISTS(SELECT 1 FROM github_token_vault t WHERE t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM github_refresh_custody WHERE token_id=t.id))
 OR EXISTS(SELECT 1 FROM github_revocation_claims WHERE token_id IN (SELECT value FROM json_each(NEW.token_ids)))
 )
BEGIN SELECT RAISE(ABORT,'github_grant_scope_changed'); END;

CREATE TABLE github_backups (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 token_id TEXT REFERENCES github_token_vault(id) ON DELETE SET NULL,
 github_user_id TEXT NOT NULL,
 repo_id INTEGER NOT NULL,
 repo_owner TEXT NOT NULL,
 repo_name TEXT NOT NULL,
 repo_private INTEGER NOT NULL CHECK(repo_private IN (0,1)),
 branch TEXT NOT NULL,
 path TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 tree_sha TEXT NOT NULL,
 base_head TEXT NOT NULL,
 files_json TEXT NOT NULL CHECK(length(files_json)<=4096),
 byte_length INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','dispatching','uncertain','complete','failed')),
 commit_sha TEXT,
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 dispatched_at TEXT
);

CREATE TABLE domain_connections (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 claim_id TEXT NOT NULL REFERENCES domain_claims(id) ON DELETE RESTRICT,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
 hostname TEXT NOT NULL,
 zone_id TEXT NOT NULL,
 target TEXT NOT NULL,
 proof_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('review','creating','uncertain','provisioning','active','disconnecting','disconnected')),
 provider_id TEXT,
 provider_status TEXT NOT NULL DEFAULT '',
 ssl_status TEXT NOT NULL DEFAULT '',
 detail TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 checked_at TEXT,
 serve_until TEXT
, check_id TEXT, reconciliation_id TEXT, reconciliation_evidence TEXT, reconciliation_operator TEXT);

CREATE TABLE domain_reconciliations (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL REFERENCES domain_connections(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL,
 hostname TEXT NOT NULL,
 zone_id TEXT NOT NULL,
 provider_id TEXT NOT NULL,
 old_state TEXT NOT NULL,
 new_state TEXT NOT NULL,
 evidence TEXT NOT NULL CHECK(length(evidence) BETWEEN 12 AND 1000),
 operator TEXT NOT NULL CHECK(length(operator) BETWEEN 1 AND 100),
 created_at TEXT NOT NULL
);

CREATE TABLE photo_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 file_id TEXT NOT NULL,
 name TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);

CREATE TABLE cloudflare_oauth_states (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL UNIQUE, authority_id TEXT NOT NULL REFERENCES identity_sessions(id) ON DELETE CASCADE,
 verifier_ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL,
 claimed INTEGER NOT NULL DEFAULT 0 CHECK(claimed IN (0,1)),
 cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0,1))
);


CREATE TABLE cloudflare_token_vault (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 ciphertext TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 revoke_attempt TEXT, revoke_after TEXT,
 state TEXT NOT NULL CHECK(state IN ('staged','active','revoking'))
);

CREATE TABLE cloudflare_dns_actions (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL REFERENCES domain_claims(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 token_id TEXT NOT NULL,zone_id TEXT NOT NULL,zone_name TEXT NOT NULL,
 record_name TEXT NOT NULL,content TEXT NOT NULL,inventory_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'review' CHECK(state IN ('review','sending','uncertain','applied','unchanged','observed')),
 provider_id TEXT,detail TEXT NOT NULL DEFAULT ''
, record_type TEXT NOT NULL DEFAULT 'TXT' CHECK(record_type IN ('TXT','CNAME')), connection_id TEXT REFERENCES domain_connections(id) ON DELETE RESTRICT, proof_token TEXT);

CREATE TABLE version_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL,digest TEXT NOT NULL,component_id TEXT NOT NULL,
 version_created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);

CREATE TABLE contact_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 publication_revision INTEGER NOT NULL DEFAULT -1
);

CREATE TABLE contact_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 expected_revision INTEGER NOT NULL,
 publication_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
);

CREATE TABLE contact_receipts (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

CREATE TABLE contact_submissions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 settings_revision INTEGER NOT NULL,
 request_hash TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 254),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

CREATE TABLE chat_comparisons (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES site_versions(id) ON DELETE CASCADE,
 baseline_id TEXT REFERENCES site_versions(id) ON DELETE CASCADE
);

CREATE TABLE site_health_checks (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL,
 publication_revision INTEGER NOT NULL,
 contact_revision INTEGER NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('manual','publish','scheduled')),
 state TEXT NOT NULL DEFAULT 'checking' CHECK(state IN ('checking','healthy','unhealthy','superseded')),
 detail TEXT NOT NULL DEFAULT 'Checking the published page and photo responses',
 started_at TEXT NOT NULL,
 finished_at TEXT
, form_review_id TEXT, directory_review_id TEXT);

CREATE TABLE site_health_budget(day TEXT PRIMARY KEY,checks INTEGER NOT NULL CHECK(checks BETWEEN 1 AND 500));

CREATE TABLE directories (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 draft_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(draft_json) AND json_type(draft_json)='array' AND json_array_length(draft_json)<=25 AND length(CAST(draft_json AS BLOB))<=24576),
 live_json TEXT CHECK(live_json IS NULL OR (json_valid(live_json) AND json_type(live_json)='array' AND json_array_length(live_json)<=25 AND length(CAST(live_json AS BLOB))<=24576)),
 publication_revision INTEGER NOT NULL DEFAULT -1,
 published_at TEXT,
 live_review_id TEXT REFERENCES directory_reviews(id),
 live_digest TEXT CHECK(live_digest IS NULL OR (length(live_digest)=64 AND live_digest NOT GLOB '*[^0-9a-f]*')),
 -- A live directory always carries the digest and the review that published it.
 CHECK((live_json IS NULL AND live_review_id IS NULL AND live_digest IS NULL) OR (live_json IS NOT NULL AND live_review_id IS NOT NULL AND live_digest IS NOT NULL))
);

CREATE TABLE directory_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('edit','publish','unpublish')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='array' AND json_array_length(snapshot_json)<=25 AND length(CAST(snapshot_json AS BLOB))<=24576),
 digest TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 publication_revision INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
, source_review_id TEXT);

CREATE TABLE directory_exports (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES directory_reviews(id) ON DELETE CASCADE
);

CREATE TABLE review_receipts (
 family TEXT NOT NULL CHECK(family IN ('directory_reviews','backend_form_reviews','module_activation_reviews','module_access_role_reviews','app_activation_reviews','app_page_reviews','app_restore_reviews','app_migration_checks','backend_publication_reviews','backend_state_reviews','backend_nominations','cloudflare_dns_actions','domain_connections','github_backups','github_grant_revocations','composition_plans','cms_setup_reviews','cms_publication_reviews','cms_unpublish_reviews','cms_discard_reviews','cms_import_reviews')),
 id TEXT NOT NULL CHECK(length(id) BETWEEN 1 AND 128),
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('change','withdrawal')),
 target TEXT NOT NULL CHECK(length(target) BETWEEN 1 AND 256),
 outcome TEXT NOT NULL CHECK(outcome IN ('applied','withdrawn','expired','superseded','failed')),
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 confirmed_by TEXT CHECK(confirmed_by IS NULL OR length(confirmed_by) BETWEEN 1 AND 128),
 applied_at TEXT,
 lifecycle_class TEXT NOT NULL CHECK(length(lifecycle_class) BETWEEN 1 AND 64),
 sealed_at TEXT NOT NULL,
 seal TEXT NOT NULL CHECK(length(seal)=64 AND seal NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(family,id),
 CHECK(outcome<>'withdrawn' OR kind='withdrawal'),
 CHECK(outcome<>'applied' OR kind='change')
);
CREATE INDEX review_receipts_project ON review_receipts(project_id,family,sealed_at);
CREATE INDEX review_receipts_owner ON review_receipts(owner_user_id);

-- A sealed receipt is written in the batch that compacts its source row, and binds every field the still-present source
-- row carries (owner, project, kind, target, outcome, confirming turn, and the digest or request hash where the source
-- has one). Sealing time cannot be backdated, because the replay horizon runs from it. The Worker computes and verifies
-- the SHA-256 seal; SQLite cannot, so the seal, the applied time and a digest the source row does not carry are only
-- checked for shape here.
CREATE TRIGGER review_receipt_bind BEFORE INSERT ON review_receipts BEGIN
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.sealed_at NOT GLOB '????-??-??T??:??:??*Z' OR NEW.sealed_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute') OR NEW.sealed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 minute');
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='directory_reviews' AND (NEW.lifecycle_class<>'directories' OR NOT EXISTS(SELECT 1 FROM directory_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.kind='unpublish' THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.project_id
  AND NEW.payload_digest=r.digest
  AND NEW.confirmed_by IS r.confirmed_by
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN (CASE WHEN r.kind='unpublish' THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.kind='unpublish' AND NOT (r.status='applied') AND EXISTS(SELECT 1 FROM directory_reviews x WHERE x.expires_at>r.expires_at AND x.kind='unpublish' AND x.project_id=r.project_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='backend_form_reviews' AND (NEW.lifecycle_class<>'backend-artifacts' OR NOT EXISTS(SELECT 1 FROM backend_form_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.enabled=0 THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN (CASE WHEN r.enabled=0 THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.enabled=0 AND NOT (r.status='applied') AND EXISTS(SELECT 1 FROM backend_form_reviews x WHERE x.expires_at>r.expires_at AND x.enabled=0 AND x.project_id=r.project_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='module_activation_reviews' AND (NEW.lifecycle_class<>'module-registry' OR NOT EXISTS(SELECT 1 FROM module_activation_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.action='disable' THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.resource_id
  AND NEW.payload_digest=r.review_digest
  AND NEW.request_hash=r.request_hash
  AND NEW.confirmed_by IS (SELECT a.id FROM module_activation_applies a WHERE a.review_id=r.id)
  AND (NEW.outcome=(CASE WHEN EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=r.id) THEN (CASE WHEN r.action='disable' THEN 'withdrawn' ELSE 'applied' END) WHEN (NOT EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=r.id) AND r.expires_at<=unixepoch()-3600) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.action='disable' AND NOT (EXISTS(SELECT 1 FROM module_activation_applies a WHERE a.review_id=r.id)) AND EXISTS(SELECT 1 FROM module_activation_reviews x WHERE x.expires_at>r.expires_at AND x.action='disable' AND x.resource_id=r.resource_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='module_access_role_reviews' AND (NEW.lifecycle_class<>'project-roles' OR NOT EXISTS(SELECT 1 FROM module_access_role_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.action='revoke' THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.instance_id||':'||r.visitor_id
  AND NEW.payload_digest=r.review_digest
  AND NEW.request_hash=r.request_hash
  AND NEW.confirmed_by IS (SELECT a.id FROM module_access_role_applies a WHERE a.review_id=r.id)
  AND (NEW.outcome=(CASE WHEN EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=r.id) THEN (CASE WHEN r.action='revoke' THEN 'withdrawn' ELSE 'applied' END) WHEN (NOT EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=r.id) AND r.expires_at<=unixepoch()-3600) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.action='revoke' AND NOT (EXISTS(SELECT 1 FROM module_access_role_applies a WHERE a.review_id=r.id)) AND EXISTS(SELECT 1 FROM module_access_role_reviews x WHERE x.expires_at>r.expires_at AND x.action='revoke' AND x.instance_id||':'||x.visitor_id=r.instance_id||':'||r.visitor_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='app_activation_reviews' AND (NEW.lifecycle_class<>'visitor-app-data' OR NOT EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.enabled=0 THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN (CASE WHEN r.enabled=0 THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.enabled=0 AND NOT (r.status='applied') AND EXISTS(SELECT 1 FROM app_activation_reviews x WHERE x.expires_at>r.expires_at AND x.enabled=0 AND x.project_id=r.project_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='app_page_reviews' AND (NEW.lifecycle_class<>'visitor-app-data' OR NOT EXISTS(SELECT 1 FROM app_page_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.config_json IS NULL THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN (CASE WHEN r.config_json IS NULL THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.config_json IS NULL AND NOT (r.status='applied') AND EXISTS(SELECT 1 FROM app_page_reviews x WHERE x.expires_at>r.expires_at AND x.config_json IS NULL AND x.project_id=r.project_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='app_restore_reviews' AND (NEW.lifecycle_class<>'application-recovery' OR NOT EXISTS(SELECT 1 FROM app_restore_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN 'applied' WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='app_migration_checks' AND (NEW.lifecycle_class<>'application-recovery' OR NOT EXISTS(SELECT 1 FROM app_migration_checks r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=r.id AND a.status='applied') THEN 'applied' WHEN (r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') AND NOT EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=r.id) AND NOT EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=r.id)) THEN 'expired' WHEN EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=r.id) THEN 'failed' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='backend_publication_reviews' AND (NEW.lifecycle_class<>'backend-artifacts' OR NOT EXISTS(SELECT 1 FROM backend_publication_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=(CASE WHEN r.operation='unpublish' THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN (CASE WHEN r.operation='unpublish' THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (r.operation='unpublish' AND NOT (r.status='applied') AND EXISTS(SELECT 1 FROM backend_publication_reviews x WHERE x.expires_at>r.expires_at AND x.operation='unpublish' AND x.project_id=r.project_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='backend_state_reviews' AND (NEW.lifecycle_class<>'backend-artifacts' OR NOT EXISTS(SELECT 1 FROM backend_state_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='applied' THEN 'applied' WHEN (r.status IN ('preparing','ready') AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' WHEN r.status='failed' THEN 'failed' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='backend_nominations' AND (NEW.lifecycle_class<>'shared-reuse' OR NOT EXISTS(SELECT 1 FROM backend_nominations r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND NEW.project_id IS NULL
  AND NEW.kind=('change')
  AND NEW.target IS r.version_id
  AND NEW.payload_digest=r.digest
  AND (NEW.outcome=(CASE WHEN (r.state='withdrawn' AND r.consent_at IS NOT NULL) THEN 'applied' WHEN (r.state='review' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' WHEN (r.state='withdrawn' AND r.consent_at IS NULL) THEN 'failed' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cloudflare_dns_actions' AND (NEW.lifecycle_class<>'domains-dns' OR NOT EXISTS(SELECT 1 FROM cloudflare_dns_actions r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.record_name
  AND (NEW.outcome=(CASE WHEN r.state IN ('applied','unchanged','observed') THEN 'applied' WHEN (r.state='review' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='domain_connections' AND (NEW.lifecycle_class<>'domains-dns' OR NOT EXISTS(SELECT 1 FROM domain_connections r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.hostname
  AND (NEW.outcome=(CASE WHEN r.state='disconnected' THEN 'applied' WHEN (r.state='review' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='github_backups' AND (NEW.lifecycle_class<>'github-backups' OR NOT EXISTS(SELECT 1 FROM github_backups r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.repo_owner||'/'||r.repo_name
  AND NEW.payload_digest=r.sha256
  AND NEW.request_hash=r.request_hash
  AND (NEW.outcome=(CASE WHEN r.state='complete' THEN 'applied' WHEN (r.state='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' WHEN r.state='failed' THEN 'failed' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='github_grant_revocations' AND (NEW.lifecycle_class<>'connections' OR NOT EXISTS(SELECT 1 FROM github_grant_revocations r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND NEW.project_id IS NULL
  AND NEW.kind=(CASE WHEN 1 THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.token_id
  AND (NEW.outcome=(CASE WHEN r.state='revoked' THEN (CASE WHEN 1 THEN 'withdrawn' ELSE 'applied' END) WHEN (r.state='review' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' WHEN r.state='cancelled' THEN 'failed' END) OR (NEW.outcome='superseded' AND (1 AND NOT (r.state='revoked') AND EXISTS(SELECT 1 FROM github_grant_revocations x WHERE x.expires_at>r.expires_at AND 1 AND x.token_id=r.token_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='composition_plans' AND (NEW.lifecycle_class<>'backend-artifacts' OR NOT EXISTS(SELECT 1 FROM composition_plans r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id
  AND NEW.request_hash=r.request_hash
  AND (NEW.outcome=(CASE WHEN EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=r.id) THEN 'applied' WHEN (r.expires_at<=unixepoch()-3600 AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=r.id)) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cms_setup_reviews' AND (NEW.lifecycle_class<>'cms-resources' OR NOT EXISTS(SELECT 1 FROM cms_setup_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id
  AND (NEW.outcome=(CASE WHEN r.status='approved' THEN 'applied' WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cms_publication_reviews' AND (NEW.lifecycle_class<>'cms-content' OR NOT EXISTS(SELECT 1 FROM cms_publication_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id||':'||r.collection||':'||r.item_id
  AND NEW.payload_digest=r.digest
  AND (NEW.outcome=(CASE WHEN r.status='published' THEN 'applied' WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cms_unpublish_reviews' AND (NEW.lifecycle_class<>'cms-content' OR NOT EXISTS(SELECT 1 FROM cms_unpublish_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND NEW.project_id IS NULL
  AND NEW.kind=(CASE WHEN 1 THEN 'withdrawal' ELSE 'change' END)
  AND NEW.target IS r.publication_id
  AND (NEW.outcome=(CASE WHEN r.status='complete' THEN (CASE WHEN 1 THEN 'withdrawn' ELSE 'applied' END) WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END) OR (NEW.outcome='superseded' AND (1 AND NOT (r.status='complete') AND EXISTS(SELECT 1 FROM cms_unpublish_reviews x WHERE x.expires_at>r.expires_at AND 1 AND x.publication_id=r.publication_id))))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cms_discard_reviews' AND (NEW.lifecycle_class<>'cms-content' OR NOT EXISTS(SELECT 1 FROM cms_discard_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND NEW.project_id IS NULL
  AND NEW.kind=('change')
  AND NEW.target IS r.publication_id
  AND (NEW.outcome=(CASE WHEN r.status='complete' THEN 'applied' WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' END))));
 SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='cms_import_reviews' AND (NEW.lifecycle_class<>'cms-media-imports' OR NOT EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=NEW.id
  AND r.user_id=NEW.owner_user_id
  AND r.project_id=NEW.project_id
  AND NEW.kind=('change')
  AND NEW.target IS r.project_id||':'||r.source_id
  AND NEW.payload_digest=r.source_digest
  AND (NEW.outcome=(CASE WHEN r.status='imported' THEN 'applied' WHEN (r.status='pending' AND r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) THEN 'expired' WHEN r.status='superseded' THEN 'superseded' END))));
END;
CREATE TRIGGER review_receipt_immutable BEFORE UPDATE ON review_receipts BEGIN SELECT RAISE(ABORT,'review_receipt_immutable'); END;
-- Receipts leave with project or account cleanup, or after the 30-day replay horizon and never inside a safety hold.
CREATE TRIGGER review_receipt_retained BEFORE DELETE ON review_receipts
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_user_id) AND (OLD.project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id))
BEGIN
 SELECT RAISE(ABORT,'review_receipt_retained') WHERE OLD.sealed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')
  OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.owner_user_id)
  OR (OLD.project_id IS NOT NULL AND EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id));
END;

CREATE TABLE backend_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(length(CAST(source AS BLOB)) BETWEEN 1 AND 8192),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 created_at TEXT NOT NULL
);

CREATE TABLE backend_runs (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES backend_versions(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL,
 day TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','complete')),
 result_json TEXT CHECK(result_json IS NULL OR length(CAST(result_json AS BLOB))<=18000),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((state='running' AND result_json IS NULL) OR (state='complete' AND result_json IS NOT NULL))
);

CREATE TABLE backend_state (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096)
);

CREATE TABLE backend_state_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 base_revision INTEGER NOT NULL,
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 input_json TEXT NOT NULL CHECK(json_valid(input_json) AND length(CAST(input_json AS BLOB))<=4096),
 after_json TEXT CHECK(after_json IS NULL OR (json_valid(after_json) AND length(CAST(after_json AS BLOB))<=4096)),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(CAST(result_json AS BLOB))<=4096)),
 status TEXT NOT NULL DEFAULT 'preparing' CHECK(status IN ('preparing','ready','applied','failed')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')), restore_review_id TEXT REFERENCES backend_state_reviews(id), restore_side TEXT CHECK(restore_side IN ('before','after')),
 CHECK((status IN ('preparing','failed') AND after_json IS NULL AND result_json IS NULL) OR (status IN ('ready','applied') AND after_json IS NOT NULL AND result_json IS NOT NULL))
);

CREATE TABLE backend_state_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES backend_state_reviews(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('review','export'))
);

CREATE TABLE cms_setup_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
 tagline TEXT NOT NULL CHECK(length(tagline)<=200),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
);

CREATE TABLE cms_instances (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL UNIQUE REFERENCES cms_setup_reviews(id),
 worker_name TEXT NOT NULL UNIQUE,
 database_name TEXT NOT NULL UNIQUE,
 bucket_name TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','provisioning','ready','uncertain')),
 database_id TEXT UNIQUE,
 session_namespace_id TEXT UNIQUE,
 deployed_version_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state<>'ready' OR (database_id IS NOT NULL AND session_namespace_id IS NOT NULL AND deployed_version_id IS NOT NULL))
);

CREATE TABLE cms_resource_jobs (
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('database','media','session')),
 account_id TEXT NOT NULL CHECK(length(account_id)=32),
 resource_name TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete')),
 provider_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(project_id,kind),
 UNIQUE(account_id,kind,provider_id),
 CHECK((state='pending' AND provider_id IS NULL) OR (state='complete' AND provider_id IS NOT NULL))
);

CREATE TABLE cms_deployments (
 project_id TEXT PRIMARY KEY REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 secret_digest TEXT NOT NULL CHECK(length(secret_digest)=64),
 origin TEXT NOT NULL UNIQUE,
 tag TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','uploaded','verified','connected')),
 worker_version_id TEXT,
 platform_version_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((state='reserved' AND worker_version_id IS NULL AND platform_version_id IS NULL) OR (state IN ('uploaded','verified') AND worker_version_id IS NOT NULL AND platform_version_id IS NULL) OR (state='connected' AND worker_version_id IS NOT NULL AND platform_version_id IS NOT NULL))
);

CREATE TABLE cms_platform_deploy_lock (id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires_at TEXT NOT NULL);

CREATE TABLE cms_draft_requests (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=4096),
 item_id TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, content_format TEXT NOT NULL DEFAULT 'plain' CHECK(content_format IN ('plain','structured')));

CREATE TABLE cms_edit_requests (
 id TEXT PRIMARY KEY,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB))<=4096),
 result TEXT CHECK(result IS NULL OR length(CAST(result AS BLOB))<=2048),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, content_format TEXT NOT NULL DEFAULT 'plain' CHECK(content_format IN ('plain','structured')));

CREATE TABLE cms_preview_links (
 turn_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE
);

CREATE TABLE cms_publication_reviews (
 id TEXT PRIMARY KEY,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE CASCADE,
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 item_id TEXT NOT NULL,
 revision TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB))<=16384),
 preview_html TEXT NOT NULL CHECK(length(CAST(preview_html AS BLOB))<=32768),
 public_html TEXT NOT NULL CHECK(length(CAST(public_html AS BLOB))<=32768),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','published')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, withdrawn INTEGER NOT NULL DEFAULT 0 CHECK(withdrawn IN (0,1)), replaces_publication_id TEXT REFERENCES cms_publication_reviews(id), media_manifest TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_manifest) AND json_type(media_manifest)='array' AND json_array_length(media_manifest)<=4 AND length(media_manifest)<=4096));

CREATE TABLE cms_unpublish_reviews (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES cms_publication_reviews(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 revision TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','complete')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cms_discard_reviews (
 id TEXT PRIMARY KEY,
 publication_id TEXT NOT NULL REFERENCES cms_publication_reviews(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 revision TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(length(CAST(snapshot AS BLOB))<=16384),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','complete')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE backend_publications (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 review_id TEXT,
 version_id TEXT REFERENCES backend_versions(id),
 CHECK((review_id IS NULL)=(version_id IS NULL))
);

CREATE TABLE backend_publication_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 operation TEXT NOT NULL CHECK(operation IN ('publish','unpublish')),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 run_id TEXT REFERENCES backend_runs(id),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((operation='publish' AND run_id IS NOT NULL) OR (operation='unpublish' AND run_id IS NULL))
);

CREATE TABLE backend_public_usage (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 day TEXT NOT NULL,
 calls INTEGER NOT NULL CHECK(calls BETWEEN 0 AND 500),
 publication_id TEXT NOT NULL REFERENCES backend_publication_reviews(id)
);

-- Per-client attempt sub-limits inside each project's public allowance (WH-075, src/public-admission.ts).
-- client_key is a scope/project/UTC-day SHA-256 of the connecting address (IPv6 /64), never the address.
CREATE TABLE public_client_usage (
 scope TEXT NOT NULL CHECK(scope IN ('backend','contact','photo')),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 client_key TEXT NOT NULL CHECK(length(client_key)=64),
 day TEXT NOT NULL,
 uses INTEGER NOT NULL CHECK(uses BETWEEN 1 AND 400),
 PRIMARY KEY(scope,project_id,client_key,day)
);

-- Per-project monthly public photo reads, charged with the platform storage_usage ceiling (WH-075).
CREATE TABLE storage_project_usage (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 read_ops INTEGER NOT NULL CHECK(read_ops BETWEEN 1 AND 50000),
 PRIMARY KEY(project_id,period)
);

-- Operator containment (WH-050 F7, runbook G3; tools/operator-containment.mjs). One row per action and public scope:
-- a freeze (allowance NULL) or a temporary per-project allowance (project subjects only), enforced inside the public
-- admission triggers. The `build` scope (WH-074) is freeze-only: it refuses new build jobs and cancels running or
-- succeeded-but-unpublished ones in the frozen scope. The `serving` scope (owner decision October 8, 2026) is a separate,
-- project-only serving stop: its own action, never combined with another scope. Rows are the audit: append-only except
-- one explicit resolution, always expiring within 30 days, and they never delete or change customer data. Resolution is
-- 'lifted' (ended while still active) or 'closed' (recorded after expiry); expiry alone is not resolution. Resolved rows
-- may be deleted 90 days after resolution (owner decision October 8, 2026), never while unresolved or inside a safety hold.
-- No foreign key, so closure is neither blocked nor erases the record.
CREATE TABLE operator_containments (
 id TEXT NOT NULL CHECK(length(id)=36),
 scope TEXT NOT NULL CHECK(scope IN ('backend','transition','contact','photo','build','serving')),
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('account','project')),
 subject_id TEXT NOT NULL CHECK(length(subject_id)=36),
 allowance INTEGER CHECK(allowance IS NULL OR (scope NOT IN ('build','serving') AND allowance>=0 AND allowance<=CASE scope WHEN 'backend' THEN 500 WHEN 'transition' THEN 500 WHEN 'contact' THEN 100 ELSE 50000 END)),
 operator_ref TEXT NOT NULL CHECK(length(operator_ref) BETWEEN 1 AND 128 AND operator_ref NOT GLOB '*[^A-Za-z0-9_.:@-]*'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 resolution TEXT CHECK(resolution IS NULL OR resolution IN ('lifted','closed')),
 resolved_at TEXT,
 resolved_by TEXT CHECK(resolved_by IS NULL OR (length(resolved_by) BETWEEN 1 AND 128 AND resolved_by NOT GLOB '*[^A-Za-z0-9_.:@-]*')),
 resolution_reason TEXT CHECK(resolution_reason IS NULL OR length(resolution_reason) BETWEEN 1 AND 500),
 resolution_digest TEXT CHECK(resolution_digest IS NULL OR length(resolution_digest)=64),
 PRIMARY KEY(id,scope),
 CHECK(allowance IS NULL OR subject_kind='project'),
 CHECK(scope<>'serving' OR subject_kind='project'),
 CHECK((resolved_at IS NULL)=(resolution IS NULL) AND (resolved_at IS NULL)=(resolved_by IS NULL) AND (resolved_at IS NULL)=(resolution_reason IS NULL) AND (resolved_at IS NULL)=(resolution_digest IS NULL))
);

-- Operator workspace session revocation for one account (owner decision October 8, 2026; tools/operator-containment.mjs).
-- One immutable receipt per reviewed action, bound to the exact reviewed identity state (epoch, credential revision and
-- the complete set of the account's workspace session rows). Inserting it deletes exactly those sessions in the same
-- statement, like server-side sign-out. Passkeys, recovery kit, epoch, enrollment/recovery grants, challenges and every
-- customer or visitor record are unchanged, so the owner can sign in again or recover. Completed on insert; deletable 90
-- days later unless the account is inside a safety hold. No foreign key, so closure neither is blocked by nor erases it.
CREATE TABLE operator_session_revocations (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL CHECK(length(account_id)=36),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch>=1),
 credential_revision INTEGER NOT NULL CHECK(credential_revision>=0),
 sessions TEXT NOT NULL CHECK(json_valid(sessions) AND json_type(sessions)='array' AND json_array_length(sessions) BETWEEN 1 AND 10),
 operator_ref TEXT NOT NULL CHECK(length(operator_ref) BETWEEN 1 AND 128 AND operator_ref NOT GLOB '*[^A-Za-z0-9_.:@-]*'),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Reviewed operator retention cleanup of resolved containment rows, revocation receipts and older cleanup receipts.
-- Inserting the receipt deletes exactly the listed records in the same statement; every delete trigger still applies.
CREATE TABLE operator_retention_receipts (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 cutoff TEXT NOT NULL,
 containments TEXT NOT NULL CHECK(json_valid(containments) AND json_type(containments)='array' AND json_array_length(containments)<=500),
 revocations TEXT NOT NULL CHECK(json_valid(revocations) AND json_type(revocations)='array' AND json_array_length(revocations)<=500),
 receipts TEXT NOT NULL CHECK(json_valid(receipts) AND json_type(receipts)='array' AND json_array_length(receipts)<=500),
 operator_ref TEXT NOT NULL CHECK(length(operator_ref) BETWEEN 1 AND 128 AND operator_ref NOT GLOB '*[^A-Za-z0-9_.:@-]*'),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(json_array_length(containments)+json_array_length(revocations)+json_array_length(receipts)>=1)
);

CREATE TABLE backend_form_settings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 revision INTEGER NOT NULL DEFAULT 0,
 review_id TEXT
);

CREATE TABLE backend_form_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 config_json TEXT CHECK(config_json IS NULL OR length(CAST(config_json AS BLOB))<=4096),
 site_revision INTEGER NOT NULL,
 backend_publication_id TEXT REFERENCES backend_publication_reviews(id),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((enabled=1 AND config_json IS NOT NULL AND backend_publication_id IS NOT NULL) OR (enabled=0 AND config_json IS NULL AND backend_publication_id IS NULL))
);

CREATE TABLE app_spaces (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 owner_user_id TEXT NOT NULL REFERENCES users(id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 -- WH-126: the visitor application is an execution resource (WH-071 logical resource `resource_id`) that consumes the
 -- project's access module instance. Visitor identity belongs to that access instance, never to the application.
 access_id TEXT NOT NULL REFERENCES module_instances(id),
 resource_id TEXT NOT NULL UNIQUE CHECK(length(resource_id)=36)
, review_id TEXT, migration_id TEXT REFERENCES app_migration_approvals(id), rollback_id TEXT REFERENCES app_restore_reviews(id));

-- WH-126 project visitor identity, owned by the project's access module instance (at most one per project, see
-- src/shared-modules/schema.sql). Enrollment, passkeys, recovery and sessions need only that instance to be active;
-- a visitor application, when one exists, consumes these identities for its per-visitor documents.
CREATE TABLE app_visitors (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 access_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE app_sessions (
 token_hash TEXT PRIMARY KEY,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);

CREATE TABLE app_documents (
 visitor_id TEXT PRIMARY KEY REFERENCES app_visitors(id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096)
);

CREATE TABLE app_runs (
 id TEXT PRIMARY KEY,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 session_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 base_revision INTEGER NOT NULL,
 program_revision INTEGER NOT NULL,
 -- The visitor page live when the change was admitted (NULL when none); the commit requires the same live page, so
 -- withdrawing or replacing the page rejects in-flight changes (visitor sign-in itself belongs to the access instance).
 page_review_id TEXT REFERENCES app_page_reviews(id),
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','complete','failed','conflict')),
 result_json TEXT CHECK(result_json IS NULL OR length(CAST(result_json AS BLOB))<=4608),
 next_json TEXT CHECK(next_json IS NULL OR json_valid(next_json) AND length(CAST(next_json AS BLOB))<=4096),
 day TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
 CHECK((state='running' AND result_json IS NULL AND next_json IS NULL) OR (state='complete' AND result_json IS NOT NULL AND next_json IS NOT NULL) OR (state IN ('failed','conflict') AND result_json IS NOT NULL AND next_json IS NULL))
);

CREATE TABLE app_activation_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 run_id TEXT REFERENCES backend_runs(id),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 base_revision INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')),
 CHECK((enabled=1 AND run_id IS NOT NULL) OR (enabled=0 AND run_id IS NULL))
);

CREATE TABLE plan_catalog (
 id TEXT PRIMARY KEY,
 tier INTEGER NOT NULL,
 published_sites INTEGER NOT NULL CHECK(published_sites>0)
);

CREATE TABLE inference_budgets (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 budget_micros INTEGER NOT NULL CHECK(budget_micros BETWEEN 1 AND 20000000),
 spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(spent_micros>=0),
 reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micros>=0),
 PRIMARY KEY(user_id,period),
 CHECK(spent_micros+reserved_micros<=budget_micros)
);

CREATE TABLE inference_calls (
 id TEXT PRIMARY KEY,
 turn_id TEXT NOT NULL REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 period TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('ack','orchestrator','normal','advanced')),
 model TEXT NOT NULL,
 provider_origin TEXT NOT NULL,
 protocol TEXT NOT NULL CHECK(protocol IN ('chat','responses')),
 policy TEXT NOT NULL,
 cost_basis TEXT NOT NULL CHECK(cost_basis IN ('subscription-shadow','unpriced')),
 ack_text TEXT CHECK(ack_text IS NULL OR (role='ack' AND status='observed' AND length(ack_text)<=180)),
 rate_id TEXT NOT NULL,
 input_rate INTEGER NOT NULL CHECK(input_rate>=0),
 output_rate INTEGER NOT NULL CHECK(output_rate>=0),
 reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','dispatched','observed','released','uncertain')),
 input_tokens INTEGER,
 output_tokens INTEGER,
 estimated_micros INTEGER,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(turn_id,role),
 FOREIGN KEY(user_id,period) REFERENCES inference_budgets(user_id,period),
 CHECK((status='observed' AND input_tokens>=0 AND output_tokens>=0 AND estimated_micros>=0 AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND estimated_micros IS NOT NULL)
 OR (status!='observed' AND input_tokens IS NULL AND output_tokens IS NULL AND estimated_micros IS NULL))
);

CREATE TABLE workspace_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 layout_json TEXT NOT NULL CHECK(json_valid(layout_json) AND length(CAST(layout_json AS BLOB))<=12000 AND COALESCE(json_extract(layout_json,'$.version')=1,0)),
 updated_at TEXT NOT NULL
);
CREATE TABLE workspace_layout_receipts (
 request_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(CAST(request_json AS BLOB))<=14000),
 from_revision INTEGER NOT NULL CHECK(from_revision>=0),
 to_revision INTEGER NOT NULL CHECK(to_revision=from_revision+1),
 previous_json TEXT NOT NULL CHECK(json_valid(previous_json) AND length(CAST(previous_json AS BLOB))<=12000 AND COALESCE(json_extract(previous_json,'$.version')=1,0)),
 layout_json TEXT NOT NULL CHECK(json_valid(layout_json) AND length(CAST(layout_json AS BLOB))<=12000 AND COALESCE(json_extract(layout_json,'$.version')=1,0)),
 -- Retained provenance: Chat cleanup must not erase current layout history.
 origin_turn_id TEXT CHECK(origin_turn_id IS NULL OR origin_turn_id=request_id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,request_id), UNIQUE(user_id,to_revision), UNIQUE(origin_turn_id)
);
CREATE TRIGGER workspace_layout_receipt_immutable BEFORE UPDATE ON workspace_layout_receipts
BEGIN SELECT RAISE(ABORT,'workspace_layout_immutable'); END;
CREATE TRIGGER workspace_layout_receipt_current BEFORE INSERT ON workspace_layout_receipts
WHEN NOT EXISTS(SELECT 1 FROM workspace_preferences p WHERE p.user_id=NEW.user_id AND p.revision=NEW.from_revision AND p.layout_json=NEW.previous_json)
 OR (NEW.origin_turn_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM chat_turns c WHERE c.id=NEW.origin_turn_id AND c.user_id=NEW.user_id AND c.mode='ai' AND c.status='pending' AND c.input_tokens IS NULL))
BEGIN SELECT RAISE(ABORT,'workspace_layout_changed'); END;
-- B11: an owner keeps the latest 50 layout revisions. The newest receipt (the current layout, needed for undo) is never pruned; nightly maintenance repeats this for any older surplus.
CREATE TRIGGER workspace_layout_receipt_cap AFTER INSERT ON workspace_layout_receipts
BEGIN DELETE FROM workspace_layout_receipts WHERE user_id=NEW.user_id AND to_revision<=NEW.to_revision-50; END;
CREATE TRIGGER workspace_layout_current_update BEFORE UPDATE ON workspace_preferences
WHEN NEW.user_id!=OLD.user_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(
 SELECT 1 FROM workspace_layout_receipts r WHERE r.user_id=NEW.user_id AND r.from_revision=OLD.revision AND r.to_revision=NEW.revision AND r.previous_json=OLD.layout_json AND r.layout_json=NEW.layout_json)
BEGIN SELECT RAISE(ABORT,'workspace_layout_changed'); END;
CREATE TABLE workspace_layout_checks(denied INTEGER NOT NULL);
CREATE TRIGGER workspace_layout_refuse BEFORE INSERT ON workspace_layout_checks
BEGIN SELECT RAISE(ABORT,'workspace_layout_changed'); END;

CREATE TABLE capacity_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 preferred_plan TEXT NOT NULL DEFAULT 'starter' CHECK(preferred_plan IN ('starter','personal','business','business-pro')),
 billing_interval TEXT NOT NULL DEFAULT 'month' CHECK(billing_interval IN ('month','year')),
 draft_overage_cents INTEGER NOT NULL DEFAULT 0 CHECK(draft_overage_cents BETWEEN 0 AND 100000),
 updated_at TEXT NOT NULL
);

CREATE TABLE user_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 name TEXT NOT NULL DEFAULT '' CHECK(length(name)<=80),
 about_me TEXT NOT NULL DEFAULT '' CHECK(length(about_me)<=1200),
 share_context INTEGER NOT NULL DEFAULT 0 CHECK(share_context IN(0,1)),
 -- WH-025 opt-in for content-free funnel measurements; withdrawal deletes recorded events.
 measurement_consent INTEGER NOT NULL DEFAULT 0 CHECK(measurement_consent IN(0,1)),
 measurement_consented_at TEXT CHECK((measurement_consent=1)=(measurement_consented_at IS NOT NULL)),
 theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN('system','light','dark')),
 photo TEXT CHECK(photo IS NULL OR length(photo)<=45000)
, avatar_id TEXT NOT NULL DEFAULT 'cloud' CHECK(avatar_id IN ('cloud','sun','moon','leaf','star','planet')), photo_digest TEXT CHECK(photo_digest IS NULL OR length(photo_digest)=64));

CREATE TABLE app_invitations (
 code_hash TEXT PRIMARY KEY CHECK(length(code_hash)=64),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 access_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 activation_revision INTEGER NOT NULL CHECK(activation_revision>=1),
 used_by TEXT REFERENCES app_visitors(id),
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);

CREATE TABLE app_passkeys (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 1400),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id),
 public_key TEXT NOT NULL CHECK(length(public_key) BETWEEN 1 AND 3000),
 counter INTEGER NOT NULL CHECK(counter>=0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);

CREATE TABLE app_auth_challenges (
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 access_id TEXT NOT NULL REFERENCES module_instances(id) ON DELETE CASCADE,
 activation_revision INTEGER NOT NULL CHECK(activation_revision>=1),
 challenge TEXT NOT NULL CHECK(length(challenge) BETWEEN 16 AND 128),
 kind TEXT NOT NULL CHECK(kind IN ('signup','login','add')),
 visitor_id TEXT NOT NULL,
 invite_hash TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 -- WH-004 B5: SHA-256 of the requester's connecting address (never the address), so one client cannot hold more than 5 live challenges per project.
 client_hash TEXT NOT NULL CHECK(length(client_hash)=64 AND client_hash NOT GLOB '*[^0-9a-f]*'),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))
);

CREATE TABLE app_recovery_codes (
 visitor_id TEXT PRIMARY KEY REFERENCES app_visitors(id),
 code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash)=64)
);

CREATE TABLE app_page_settings (
 project_id TEXT PRIMARY KEY REFERENCES app_spaces(project_id),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 review_id TEXT
);

CREATE TABLE app_page_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 program_revision INTEGER NOT NULL CHECK(program_revision>=0),
 base_revision INTEGER NOT NULL CHECK(base_revision>=0),
 config_json TEXT CHECK(config_json IS NULL OR json_valid(config_json) AND length(CAST(config_json AS BLOB))<=4096),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
);

CREATE TABLE app_daily_usage (
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 day TEXT NOT NULL,
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 PRIMARY KEY(project_id,day)
);

CREATE TABLE app_deletion_receipts (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 proof_hash TEXT NOT NULL CHECK(length(proof_hash)=64),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))
);

CREATE TABLE agent_inspections (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 result_text TEXT NOT NULL CHECK(length(CAST(result_text AS BLOB))<=8000),
 input_tokens INTEGER NOT NULL CHECK(input_tokens>=0),
 output_tokens INTEGER NOT NULL CHECK(output_tokens>=0),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE site_traffic_daily (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 day TEXT NOT NULL CHECK(length(day)=10),
 requests INTEGER NOT NULL CHECK(requests>=0),
 PRIMARY KEY(project_id,day)
);

CREATE TABLE site_traffic_metadata (
 id INTEGER PRIMARY KEY CHECK(id=1),
 enabled_at TEXT NOT NULL
);

-- WH-037: aggregate-only measurement quality per project and UTC day. Counts requests excluded from the page metric
-- (known automated clients, platform checks) and measurements that failed or were shed. No identifiers or headers.
CREATE TABLE site_traffic_quality (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 day TEXT NOT NULL CHECK(length(day)=10),
 excluded_requests INTEGER NOT NULL DEFAULT 0 CHECK(excluded_requests>=0),
 missed_measurements INTEGER NOT NULL DEFAULT 0 CHECK(missed_measurements>=0),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(project_id,day)
);

CREATE TABLE cms_export_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 draft_request_id TEXT NOT NULL REFERENCES cms_draft_requests(id) ON DELETE CASCADE
);

CREATE TABLE gateway_spend_buckets (
 id TEXT PRIMARY KEY,
 scope TEXT NOT NULL CHECK(scope IN ('platform','account','task','premium','approval')),
 user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
 task_id TEXT,
 limit_micros INTEGER NOT NULL CHECK(typeof(limit_micros)='integer' AND limit_micros BETWEEN 0 AND 1000000000000),
 held_micros INTEGER NOT NULL DEFAULT 0 CHECK(typeof(held_micros)='integer' AND held_micros>=0),
 spent_micros INTEGER NOT NULL DEFAULT 0 CHECK(typeof(spent_micros)='integer' AND spent_micros>=0),
 terms_json TEXT NOT NULL DEFAULT '{}',
 CHECK(json_valid(terms_json)),
 CHECK(held_micros+spent_micros<=limit_micros),
 CHECK((scope='platform' AND user_id IS NULL AND task_id IS NULL) OR (scope IN ('account','premium') AND user_id IS NOT NULL AND task_id IS NULL) OR (scope IN ('task','approval') AND user_id IS NOT NULL AND task_id IS NOT NULL))
);

CREATE TABLE gateway_spend_attempts (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 task_id TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),
 task_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 account_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 platform_bucket TEXT NOT NULL REFERENCES gateway_spend_buckets(id),
 premium_bucket TEXT REFERENCES gateway_spend_buckets(id),
 approval_bucket TEXT REFERENCES gateway_spend_buckets(id),
 provider_reserved INTEGER NOT NULL CHECK(typeof(provider_reserved)='integer' AND provider_reserved BETWEEN 0 AND 1000000000000),
 customer_reserved INTEGER NOT NULL CHECK(typeof(customer_reserved)='integer' AND customer_reserved BETWEEN 0 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','dispatched','uncertain','settled','released')),
 input_tokens INTEGER, output_tokens INTEGER, provider_actual INTEGER, customer_actual INTEGER,
 CHECK((status='settled' AND typeof(input_tokens)='integer' AND typeof(output_tokens)='integer' AND typeof(provider_actual)='integer' AND typeof(customer_actual)='integer' AND input_tokens>=0 AND output_tokens>=0 AND provider_actual BETWEEN 0 AND provider_reserved AND customer_actual BETWEEN 0 AND customer_reserved)
 OR (status!='settled' AND input_tokens IS NULL AND output_tokens IS NULL AND provider_actual IS NULL AND customer_actual IS NULL))
);

CREATE TABLE fair_use_project_lifecycle (
 project_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 observed_since TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ai_saved_at TEXT,
 export_prepared_at TEXT,
 removed_at TEXT
);

CREATE TABLE fair_use_control (
 id INTEGER PRIMARY KEY CHECK(id=1),
 requested_mode TEXT NOT NULL DEFAULT 'monitor' CHECK(requested_mode IN ('monitor','enforce')),
 updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cms_media_uploads (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id) ON DELETE RESTRICT,
 origin TEXT NOT NULL,
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 5 AND 100),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 size INTEGER NOT NULL CHECK(size BETWEEN 20 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 result TEXT CHECK(result IS NULL OR (json_valid(result) AND length(result)<=2048)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE cms_publication_media (
 review_id TEXT NOT NULL REFERENCES cms_publication_reviews(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(size BETWEEN 20 AND 1048576),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 PRIMARY KEY(review_id,media_id)
);

CREATE TABLE cms_import_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
 source_id INTEGER NOT NULL CHECK(source_id BETWEEN 1 AND 9007199254740991),
 collection TEXT NOT NULL CHECK(collection IN ('posts','pages')),
 body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=4096),
 provenance TEXT NOT NULL CHECK(json_valid(provenance) AND length(CAST(provenance AS BLOB))<=32768),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','imported','superseded')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+24 hours'))
, source_upload_id TEXT REFERENCES cms_wordpress_sources(id), taxonomy_plan TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(taxonomy_plan) AND json_type(taxonomy_plan)='array' AND json_array_length(taxonomy_plan)<=20 AND length(CAST(taxonomy_plan AS BLOB))<=4096), media_plan TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(media_plan) AND json_type(media_plan)='array' AND json_array_length(media_plan)<=4 AND length(CAST(media_plan AS BLOB))<=24576));

CREATE TABLE cms_wordpress_sources (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES cms_instances(project_id),
 filename TEXT NOT NULL CHECK(length(filename) BETWEEN 5 AND 100),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id,digest)
);

CREATE TABLE backend_component_instances (
 version_id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 component_id TEXT NOT NULL CHECK(length(component_id) BETWEEN 1 AND 80),
 component_version INTEGER NOT NULL CHECK(component_version>0),
 artifact_digest TEXT NOT NULL CHECK(length(artifact_digest)=64),
 provenance TEXT NOT NULL,
 license TEXT NOT NULL
);

CREATE TABLE welcome_onboarding (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 stage TEXT NOT NULL DEFAULT 'profile' CHECK(stage IN ('profile','project','review','complete')),
 project_id TEXT NOT NULL UNIQUE,
 project_name TEXT NOT NULL DEFAULT '' CHECK(length(project_name)<=100),
 idea TEXT NOT NULL DEFAULT '' CHECK(length(idea)<=1000),
 audience TEXT NOT NULL DEFAULT '' CHECK(length(audience)<=1000),
 preferred_theme TEXT NOT NULL DEFAULT 'ocean' CHECK(preferred_theme IN ('ocean','clay','forest')),
 completed_at TEXT,
 prompt TEXT NOT NULL DEFAULT 'name',
 CHECK((stage='profile' AND prompt IN ('name','picture','bio'))
  OR (stage='project' AND prompt IN ('idea','project-name','audience','style'))
  OR (stage IN ('review','complete') AND prompt='review'))
);

CREATE TABLE domain_proof_removals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL, hostname TEXT NOT NULL, proof_token TEXT NOT NULL,
 proof_expires_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE REFERENCES chat_turns(id),
 CHECK((status='pending' AND confirmed_by IS NULL) OR (status='applied' AND confirmed_by IS NOT NULL))
);

CREATE TABLE gateway_inference_requests (
 attempt_id TEXT PRIMARY KEY REFERENCES gateway_spend_attempts(id) ON DELETE RESTRICT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND
  json_type(result_json,'$.text') IS 'text' AND length(json_extract(result_json,'$.text')) BETWEEN 1 AND 32000 AND
  json_type(result_json,'$.inputTokens') IS 'integer' AND json_extract(result_json,'$.inputTokens')>=0 AND
  json_type(result_json,'$.outputTokens') IS 'integer' AND json_extract(result_json,'$.outputTokens')>=0))
);

CREATE TABLE gateway_provider_receipts (
 attempt_id TEXT PRIMARY KEY REFERENCES gateway_inference_requests(attempt_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL CHECK(length(account_id)=32 AND account_id NOT GLOB '*[^0-9a-f]*'),
 gateway_id TEXT NOT NULL CHECK(length(gateway_id) BETWEEN 1 AND 64 AND gateway_id NOT GLOB '*[^a-z0-9-]*'),
 http_status INTEGER NOT NULL CHECK(typeof(http_status)='integer' AND http_status BETWEEN 100 AND 599),
 event_id TEXT CHECK(event_id IS NULL OR (length(event_id) BETWEEN 1 AND 128 AND event_id NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 log_id TEXT CHECK(log_id IS NULL OR (length(log_id) BETWEEN 1 AND 128 AND log_id NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE welcome_first_drafts (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE cms_import_taxonomy_jobs (
 review_id TEXT PRIMARY KEY REFERENCES cms_import_reviews(id) ON DELETE CASCADE,
 body TEXT NOT NULL CHECK(json_valid(body) AND length(CAST(body AS BLOB))<=4096),
 state TEXT NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','applied'))
);

CREATE TABLE application_builds (
 id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64)
);

-- WH-074 pooled build job envelope (src/build-jobs.ts, docs/build-jobs.md). One bounded job per owner-requested
-- application build. Only the SHA-256 of the per-job lease is stored; the lease never leaves the request that admitted it.
-- Shared toolchain keys hold no tenant input; the private artifact key is bound to project, job and source digest.
-- A row is a record of shared capacity in use, never an allocated container, server or warm workspace.
CREATE TABLE build_jobs (
 id TEXT PRIMARY KEY REFERENCES application_builds(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose='project-build'),
 origin TEXT NOT NULL CHECK(origin='owner-chat'),
 lease_digest TEXT NOT NULL CHECK(length(lease_digest)=64),
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 toolchain_key TEXT NOT NULL CHECK(length(toolchain_key)=81 AND substr(toolchain_key,1,17)='shared/toolchain/' AND substr(toolchain_key,18) NOT GLOB '*[^0-9a-f]*'),
 artifact_key TEXT NOT NULL CHECK(length(artifact_key)=146 AND artifact_key='private/'||project_id||'/'||id||'/'||substr(artifact_key,83) AND substr(artifact_key,83) NOT GLOB '*[^0-9a-f]*'),
 state TEXT NOT NULL DEFAULT 'running' CHECK(state IN ('running','succeeded','failed','cancelled','expired','published')),
 cleanup TEXT NOT NULL DEFAULT 'pending' CHECK(cleanup IN ('pending','released','failed')),
 diagnostics_json TEXT CHECK(diagnostics_json IS NULL OR (json_valid(diagnostics_json) AND json_type(diagnostics_json)='array' AND length(CAST(diagnostics_json AS BLOB))<=2048)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 dispatched_at TEXT,
 finished_at TEXT,
 CHECK((state='running')=(finished_at IS NULL))
);

-- Append-only cleanup attempts. A failed or missing cleanup keeps the job's capacity slot held until a later attempt
-- records release; nothing treats an unconfirmed workspace, memory or disk as free.
CREATE TABLE build_job_cleanups (
 job_id TEXT NOT NULL REFERENCES build_jobs(id) ON DELETE CASCADE,
 attempt INTEGER NOT NULL CHECK(attempt BETWEEN 1 AND 5),
 outcome TEXT NOT NULL CHECK(outcome IN ('released','failed')),
 reason TEXT NOT NULL CHECK(reason IN ('runtime-returned','not-dispatched','runtime-unconfirmed','runtime-bound-elapsed')),
 held_ms INTEGER NOT NULL CHECK(held_ms>=0),
 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(job_id,attempt),
 CHECK((outcome='failed')=(reason='runtime-unconfirmed'))
);

CREATE TABLE app_owner_erasures (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id),
 visitor_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))
);

CREATE TABLE app_recovery_points (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 version_id TEXT NOT NULL REFERENCES backend_versions(id),
 sealed INTEGER NOT NULL DEFAULT 0 CHECK(sealed IN (0,1)),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
, removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)));

CREATE TABLE app_recovery_documents (
 point_id TEXT NOT NULL REFERENCES app_recovery_points(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>=0),
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=4096),
 PRIMARY KEY(point_id,visitor_id)
);

CREATE TABLE app_restore_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 point_id TEXT NOT NULL REFERENCES app_recovery_points(id),
 base_revision INTEGER NOT NULL,
 roster_json TEXT NOT NULL CHECK(json_valid(roster_json) AND json_type(roster_json)='array' AND json_array_length(roster_json)<=100 AND length(CAST(roster_json AS BLOB))<=12000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'))
, restore_program INTEGER NOT NULL DEFAULT 0 CHECK(restore_program IN (0,1)), from_version TEXT REFERENCES backend_versions(id));

CREATE TABLE app_migration_checks (
 id TEXT PRIMARY KEY REFERENCES app_recovery_points(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 from_version TEXT NOT NULL REFERENCES backend_versions(id),
 to_version TEXT NOT NULL REFERENCES backend_versions(id),
 transform_version TEXT NOT NULL REFERENCES backend_versions(id),
 test_id TEXT NOT NULL REFERENCES backend_runs(id),
 base_revision INTEGER NOT NULL,
 roster_json TEXT NOT NULL CHECK(json_valid(roster_json) AND json_type(roster_json)='array' AND json_array_length(roster_json)<=100 AND length(CAST(roster_json AS BLOB))<=12000),
 expires_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 minutes'))
);

CREATE TABLE app_migration_documents (
 migration_id TEXT NOT NULL REFERENCES app_migration_checks(id),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 base_revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','ready','failed')),
 next_json TEXT CHECK(next_json IS NULL OR (json_valid(next_json) AND length(CAST(next_json AS BLOB))<=4096)),
 error TEXT CHECK(error IS NULL OR error IN ('invalid_output','invalid_request','invalid_code','execution_failed','work_limit','unresolved_promise','unavailable','busy')),
 PRIMARY KEY(migration_id,visitor_id),
 CHECK((state IN ('pending','running') AND next_json IS NULL AND error IS NULL) OR (state='ready' AND next_json IS NOT NULL AND error IS NULL) OR (state='failed' AND next_json IS NULL AND error IS NOT NULL))
);

CREATE TABLE app_migration_approvals (
 id TEXT PRIMARY KEY REFERENCES app_migration_checks(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 changed_documents INTEGER NOT NULL CHECK(changed_documents BETWEEN 0 AND 100),
 status TEXT NOT NULL DEFAULT 'applying' CHECK(status IN ('applying','applied')),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE app_migration_cancellations (
 id TEXT PRIMARY KEY REFERENCES app_migration_checks(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE app_maintenance_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('upgrade','rollback')),
 review_id TEXT NOT NULL,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);

CREATE TABLE fair_use_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 policy_version TEXT NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100),
 plan_id TEXT NOT NULL CHECK(plan_id IN ('starter','personal','business','business-pro')),
 category TEXT NOT NULL CHECK(category IN ('unrelated_chat','project_churn','legitimate_capacity')),
 opened_by TEXT NOT NULL CHECK(length(opened_by) BETWEEN 1 AND 100),
 context TEXT NOT NULL CHECK(length(context) BETWEEN 1 AND 2000),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
 outcome TEXT CHECK(outcome IN ('legitimate_use','insufficient_evidence','confirmed_pattern')),
 resolution TEXT CHECK(length(resolution) BETWEEN 1 AND 2000),
 resolved_by TEXT CHECK(length(resolved_by) BETWEEN 1 AND 100),
 resolved_at TEXT, observation_json TEXT
 CHECK(observation_json IS NULL OR (length(observation_json)<=8192 AND json_valid(observation_json) AND json_type(observation_json)='object')),
 CHECK((state='open' AND outcome IS NULL AND resolution IS NULL AND resolved_by IS NULL AND resolved_at IS NULL AND revision=0) OR
       (state='resolved' AND outcome IS NOT NULL AND resolution IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND revision=1))
);

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

CREATE TABLE standard_ai_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','dispatched','uncertain','completed','released')),
 input_tokens INTEGER,
 output_tokens INTEGER,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((state='completed' AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND input_tokens>=0 AND output_tokens>=0)
 OR (state!='completed' AND input_tokens IS NULL AND output_tokens IS NULL))
);

CREATE TABLE usage_review_requests (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL DEFAULT 'usage_review' CHECK(kind IN ('usage_review','help')),
 source TEXT NOT NULL DEFAULT 'chat' CHECK(source IN ('chat','support','chat_form')),
 reference TEXT CHECK(reference IS NULL OR length(reference) BETWEEN 1 AND 200),
 statement TEXT NOT NULL CHECK(length(statement) BETWEEN 1 AND 950),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','answered')),
 public_response TEXT CHECK(length(public_response) BETWEEN 1 AND 2000),
 answered_by TEXT CHECK(length(answered_by) BETWEEN 1 AND 100),
 answered_at TEXT,
 customer_read_at TEXT,
 CHECK((state='open' AND public_response IS NULL AND answered_by IS NULL AND answered_at IS NULL AND customer_read_at IS NULL) OR
       (state='answered' AND public_response IS NOT NULL AND answered_by IS NOT NULL AND answered_at IS NOT NULL)),
 CHECK(source='support' OR (source='chat' AND kind='usage_review' AND reference IS NULL) OR (source='chat_form' AND kind='help' AND reference IS NULL))
);

-- WH-036: provider-neutral contact notification outbox. The inbox (contact_submissions) stays the source of truth;
-- nothing here carries a visitor name, email or message. Rows are created only when a selected, implemented and
-- reviewed provider is configured (src/contact-notifications.ts); no provider is implemented or enabled.
CREATE TABLE contact_notification_destinations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 address TEXT NOT NULL CHECK(length(address) BETWEEN 3 AND 254 AND address=lower(address)),
 state TEXT NOT NULL DEFAULT 'unverified' CHECK(state IN ('unverified','verified','suppressed')),
 verification_code TEXT CHECK(verification_code IS NULL OR length(verification_code)=8),
 verification_expires_at TEXT,
 verification_failures INTEGER NOT NULL DEFAULT 0 CHECK(verification_failures BETWEEN 0 AND 5),
 created_at TEXT NOT NULL,
 verified_at TEXT,
 CHECK(state!='unverified' OR verified_at IS NULL),
 CHECK(state!='verified' OR (verified_at IS NOT NULL AND verification_code IS NULL)),
 CHECK((verification_code IS NULL)=(verification_expires_at IS NULL))
);

-- Permanent per-account suppression of an address after a hard bounce, complaint or unsubscribe. It is never updated or
-- deleted (except with the account), so a suppressed address cannot be re-added to resume delivery.
CREATE TABLE contact_notification_suppressions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 address TEXT NOT NULL CHECK(length(address) BETWEEN 3 AND 254 AND address=lower(address)),
 reason TEXT NOT NULL CHECK(reason IN ('bounce','complaint','unsubscribe','provider')),
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,address)
);

-- WH-036 exact Chat review of the owner's notification address (owner decision, October 4, 2026). The review id is the
-- preparing chat turn; confirmation by a later turn replaces the project's destination atomically (contact_destination_review_apply).
CREATE TABLE contact_destination_reviews (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 address TEXT NOT NULL CHECK(length(address) BETWEEN 3 AND 254 AND address=lower(address)),
 expires_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied')),
 confirmed_by TEXT UNIQUE
);

-- WH-036 operator-reviewed reset of one permanent suppression (owner decision, October 4, 2026). Inserted only by the
-- local operator CLI (tools/contact-suppression-reset.mjs) after a digest-pinned preview; the audit row is immutable.
CREATE TABLE contact_notification_suppression_resets (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 address TEXT NOT NULL CHECK(length(address) BETWEEN 3 AND 254 AND address=lower(address)),
 suppression_reason TEXT NOT NULL CHECK(suppression_reason IN ('bounce','complaint','unsubscribe','provider')),
 suppressed_at TEXT NOT NULL,
 operator_ref TEXT NOT NULL CHECK(length(operator_ref) BETWEEN 1 AND 128),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(user_id,address,suppressed_at)
);

CREATE TABLE backend_imports (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(length(CAST(source AS BLOB)) BETWEEN 1 AND 8192),
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','requires_review','blocked')),
 reason TEXT CHECK(reason IN ('scanner_required','integrity','credential','dynamic_code','remote_dependency')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 scanned_at TEXT,
 CHECK((state='pending' AND reason IS NULL AND scanned_at IS NULL) OR
       (state='requires_review' AND reason='scanner_required' AND scanned_at IS NOT NULL) OR
       (state='blocked' AND reason IN ('integrity','credential','dynamic_code','remote_dependency') AND scanned_at IS NOT NULL))
);

CREATE TABLE profile_photo_safety (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 photo_revision INTEGER NOT NULL CHECK(photo_revision>=0),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','blocked')),
 csam_check TEXT NOT NULL DEFAULT 'unknown' CHECK(csam_check IN ('unknown','clear','matched')),
 sexual_check TEXT NOT NULL DEFAULT 'unknown' CHECK(sexual_check IN ('unknown','clear','matched')),
 scanner_reference TEXT,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state!='approved' OR (csam_check='clear' AND sexual_check='clear' AND length(scanner_reference) BETWEEN 1 AND 200 AND scanner_reference IS NOT NULL AND expires_at IS NOT NULL))
);

CREATE TABLE project_photo_safety (
 file_id TEXT PRIMARY KEY REFERENCES project_files(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','blocked')),
 csam_check TEXT NOT NULL DEFAULT 'unknown' CHECK(csam_check IN ('unknown','clear','matched')),
 sexual_check TEXT NOT NULL DEFAULT 'unknown' CHECK(sexual_check IN ('unknown','clear','matched')),
 scanner_reference TEXT,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state!='approved' OR (csam_check='clear' AND sexual_check='clear' AND scanner_reference IS NOT NULL AND length(scanner_reference) BETWEEN 1 AND 200 AND expires_at IS NOT NULL AND julianday(expires_at) IS NOT NULL))
);

-- WH-013: exact CMS upload receipt clearance. Reuses the photo coverage contract and photo_scan_tickets.
CREATE TABLE cms_media_safety (
 upload_id TEXT PRIMARY KEY REFERENCES cms_media_uploads(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','blocked')),
 csam_check TEXT NOT NULL DEFAULT 'unknown' CHECK(csam_check IN ('unknown','clear','matched')),
 sexual_check TEXT NOT NULL DEFAULT 'unknown' CHECK(sexual_check IN ('unknown','clear','matched')),
 scanner_reference TEXT,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(state!='approved' OR (csam_check='clear' AND sexual_check='clear' AND scanner_reference IS NOT NULL AND length(scanner_reference) BETWEEN 1 AND 200 AND expires_at IS NOT NULL AND julianday(expires_at) IS NOT NULL))
);

CREATE TABLE "photo_scan_tickets" (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK(kind IN ('profile','project','cms')),
 subject_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 digest TEXT NOT NULL CHECK(length(digest)=64),
 policy_version TEXT NOT NULL CHECK(policy_version='2026-09-30'),
 authority_hash TEXT NOT NULL CHECK(length(authority_hash)=64),
 state TEXT NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','completed','stale')),
 result_hash TEXT,
 outcome TEXT CHECK(outcome IN ('approved','blocked','held')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 expires_at TEXT NOT NULL,
 completed_at TEXT,
 CHECK((state='reserved' AND result_hash IS NULL AND outcome IS NULL AND completed_at IS NULL) OR
 (state IN ('completed','stale') AND length(result_hash)=64 AND result_hash IS NOT NULL AND outcome IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE content_screening_decisions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('chat_text','generated_artifact','media','imported_code')),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 policy_version TEXT NOT NULL,
 first_required INTEGER NOT NULL CHECK(first_required IN (0,1)),
 required INTEGER NOT NULL CHECK(required IN (0,1)),
 first_reason TEXT NOT NULL CHECK(first_reason IN ('mandatory_format','risk_or_missing_history','sample_selected','not_sampled','sampling_unavailable')),
 first_percent INTEGER NOT NULL CHECK(first_percent BETWEEN 0 AND 100),
 first_risk_score INTEGER NOT NULL CHECK(first_risk_score BETWEEN 0 AND 100),
 escalation_reason TEXT CHECK(escalation_reason IN ('mandatory_format','risk_or_missing_history','sample_selected','sampling_unavailable')),
 escalated_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,kind,digest,policy_version),
 CHECK(required>=first_required),
 CHECK((first_required=required AND escalation_reason IS NULL AND escalated_at IS NULL) OR (first_required=0 AND required=1 AND escalation_reason IS NOT NULL AND escalated_at IS NOT NULL)),
 CHECK((first_required=0 AND first_reason='not_sampled') OR (first_required=1 AND first_reason!='not_sampled')),
 CHECK(kind NOT IN ('media','imported_code') OR first_required=1)
);

CREATE TABLE content_risk_evidence (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 incident_id TEXT NOT NULL CHECK(length(incident_id) BETWEEN 1 AND 128),
 kind TEXT NOT NULL CHECK(kind IN ('verified_benign','uncertain_flag','confirmed_violation','confirmed_evasion','critical_incident')),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>=0),
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 128),
 reviewer_ref TEXT NOT NULL CHECK(length(reviewer_ref) BETWEEN 1 AND 128),
 recorded_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE content_risk_reversals (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 incident_id TEXT NOT NULL,
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 128),
 reviewer_ref TEXT NOT NULL CHECK(length(reviewer_ref) BETWEEN 1 AND 128),
 recorded_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,incident_id)
);

CREATE TABLE maintenance_health (
 job TEXT PRIMARY KEY CHECK(job IN ('identity','chat_drafts','imports','hosting','health','fair_use','traffic','funnel','guest_previews','email_changes','reviews','applications','contacts','photos','github','cloudflare','jobs','job_dispatch')),
 run_id TEXT NOT NULL,
 started_at INTEGER NOT NULL CHECK(started_at>=0),
 finished_at INTEGER,
 last_success_at INTEGER,
 duration_ms INTEGER CHECK(duration_ms>=0),
 status TEXT NOT NULL CHECK(status IN ('running','completed','failed','skipped')),
 failure_category TEXT CHECK(failure_category IS NULL OR failure_category='job_failed')
);

CREATE TABLE github_revocation_health (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 requested_at TEXT
);

CREATE TABLE cloudflare_revocation_health (
 token_id TEXT PRIMARY KEY REFERENCES cloudflare_token_vault(id) ON DELETE CASCADE,
 requested_at TEXT
);

CREATE TABLE chat_review_receipts (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('githubGrant','application','appPage','appRestore','backendPublication','backendForm','directory','contactNotification','backendState','cmsImport','cmsDiscard','cmsUnpublish','cmsPublish','cmsSetup','backup','dns','hosting','backendNomination','notificationConfiguration')),
 review_id TEXT NOT NULL,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);

CREATE TABLE composition_plans (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 catalog_digest TEXT NOT NULL CHECK(length(catalog_digest)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(CAST(plan_json AS BLOB))<=16000),
 details_revision INTEGER NOT NULL CHECK(details_revision>=0),
 backend_count INTEGER NOT NULL CHECK(backend_count>=0),
 backend_revision INTEGER NOT NULL CHECK(backend_revision>=0),
 extension_scope TEXT NOT NULL CHECK(extension_scope IN ('none','pure-function','visitor-transition')),
 expires_at INTEGER NOT NULL
);

CREATE TABLE backend_extension_uses (
 version_id TEXT PRIMARY KEY REFERENCES backend_versions(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL UNIQUE REFERENCES composition_plans(id)
);

CREATE TABLE project_spec_proposals (
 id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 operation TEXT NOT NULL CHECK(operation IN ('import','change','restore')),
 expected_revision INTEGER NOT NULL CHECK(expected_revision>=0), draft_revision INTEGER NOT NULL,
 base_version_id TEXT, target_version_id TEXT,
 base_digest TEXT, request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64), manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 policy_version TEXT NOT NULL, expires_at TEXT NOT NULL,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=32768),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384),
 config_json TEXT NOT NULL CHECK(json_valid(config_json) AND length(CAST(config_json AS BLOB))<=8192),
 html TEXT NOT NULL CHECK(length(CAST(html AS BLOB))<=32768), html_digest TEXT NOT NULL CHECK(length(html_digest)=64),
 diff_json TEXT NOT NULL CHECK(json_valid(diff_json) AND length(CAST(diff_json AS BLOB))<=65536),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND length(CAST(envelope_json AS BLOB))<=16384)
);

CREATE TABLE project_spec_versions (
 version_id TEXT PRIMARY KEY REFERENCES site_versions(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), proposal_id TEXT NOT NULL,
 spec_json TEXT NOT NULL CHECK(json_valid(spec_json) AND length(CAST(spec_json AS BLOB))<=32768),
 spec_digest TEXT NOT NULL CHECK(length(spec_digest)=64),
 lock_json TEXT NOT NULL CHECK(json_valid(lock_json) AND length(CAST(lock_json AS BLOB))<=4096),
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json) AND length(CAST(manifest_json AS BLOB))<=16384),
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64),
 UNIQUE(project_id,revision)
);

CREATE TABLE project_spec_applies (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL UNIQUE, proposal_digest TEXT NOT NULL CHECK(length(proposal_digest)=64),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 version_id TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL CHECK(revision>0),
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(project_id,revision)
);

CREATE TABLE project_spec_heads (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0), version_id TEXT NOT NULL,
 draft_revision INTEGER NOT NULL
);

CREATE TABLE project_spec_chat_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 proposal_id TEXT NOT NULL REFERENCES project_spec_proposals(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);

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

CREATE TABLE service_client_activation_links (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 review_id TEXT NOT NULL REFERENCES service_client_activation_reviews(id) ON DELETE CASCADE,
 reply_digest TEXT NOT NULL CHECK(length(reply_digest)=64)
);

CREATE TABLE stripe_customers (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 customer_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 lease TEXT,
 lease_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stripe_subscription_orders (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plan_catalog(id),
 interval TEXT NOT NULL CHECK(interval IN ('month','year')),
 price_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 created_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','expired')),
 session_id TEXT UNIQUE,
 subscription_id TEXT UNIQUE
);

CREATE TABLE stripe_subscriptions (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL UNIQUE REFERENCES stripe_subscription_orders(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 cancel_at_period_end INTEGER NOT NULL CHECK(cancel_at_period_end IN (0,1)),
 period_end INTEGER NOT NULL,
 latest_invoice_id TEXT,
 payment_status TEXT,
 updated_at INTEGER NOT NULL
);

CREATE TABLE stripe_paid_invoices (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id TEXT NOT NULL REFERENCES stripe_subscriptions(id) ON DELETE CASCADE,
 plan_id TEXT NOT NULL REFERENCES plan_catalog(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 interval TEXT NOT NULL CHECK(interval IN ('month','year')),
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 hosted_url TEXT,
 created_at INTEGER NOT NULL
);

CREATE TABLE github_token_staging (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 state_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

CREATE TABLE github_revocation_claims (
 token_id TEXT PRIMARY KEY REFERENCES github_token_vault(id) ON DELETE CASCADE,
 claim_id TEXT NOT NULL,
 expires_at TEXT NOT NULL
);

CREATE TABLE app_deletion_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL UNIQUE REFERENCES app_sessions(token_hash) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>=0),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))
);

CREATE TABLE project_spec_creations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 version_id TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feature_preview_grants (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 contract_version INTEGER NOT NULL CHECK(contract_version=1),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 feature_id TEXT NOT NULL CHECK(length(feature_id) BETWEEN 1 AND 80),
 operation TEXT NOT NULL CHECK(operation IN ('connect','read','prepare','confirm','dispatch')),
 purpose TEXT NOT NULL CHECK(purpose='private-test-acceptance'),
 review_reference TEXT NOT NULL CHECK(length(review_reference) BETWEEN 1 AND 200),
 starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer'),
 ends_at INTEGER NOT NULL CHECK(typeof(ends_at)='integer' AND ends_at>starts_at AND ends_at-starts_at<=604800),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer'),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>=created_at))
);

CREATE INDEX projects_owner_updated ON projects(owner_user_id, updated_at DESC);

CREATE INDEX activity_user_created ON activity_events(user_id, created_at DESC);

CREATE INDEX chat_turns_user_revision ON chat_turns(user_id, revision DESC);

CREATE INDEX chat_turns_pending ON chat_turns(user_id, status, created_at);

CREATE INDEX site_versions_project ON site_versions(project_id, created_at DESC);

CREATE INDEX publication_actions_owner ON publication_actions(user_id,project_id);

CREATE INDEX project_files_project ON project_files(project_id,created_at);

CREATE INDEX github_tokens_cleanup ON github_token_vault(state,expires_at);

CREATE INDEX github_backups_user ON github_backups(user_id,created_at DESC);

CREATE UNIQUE INDEX domain_connection_hostname ON domain_connections(hostname) WHERE state NOT IN ('review','disconnected');

CREATE UNIQUE INDEX domain_connection_provider ON domain_connections(zone_id,provider_id) WHERE provider_id IS NOT NULL;

CREATE INDEX domain_connection_owner ON domain_connections(user_id,created_at DESC);

CREATE INDEX photo_removals_file ON photo_removals(file_id,status);

CREATE UNIQUE INDEX cloudflare_one_active ON cloudflare_token_vault(user_id) WHERE state='active';

CREATE INDEX cloudflare_dns_owner ON cloudflare_dns_actions(user_id,created_at);

CREATE UNIQUE INDEX cloudflare_dns_pending ON cloudflare_dns_actions(zone_id,record_name) WHERE state IN ('sending','uncertain');

CREATE UNIQUE INDEX cloudflare_dns_attempt ON cloudflare_dns_actions(zone_id,record_name,content) WHERE state IN ('sending','uncertain','applied','observed');

CREATE INDEX version_removals_version ON version_removals(version_id,status);

CREATE INDEX contact_reviews_owner ON contact_reviews(user_id,project_id);

CREATE INDEX contact_receipts_project ON contact_receipts(project_id,created_at);

CREATE INDEX contact_receipts_expiry ON contact_receipts(expires_at);

CREATE INDEX contact_submissions_project ON contact_submissions(project_id,created_at DESC,id);

CREATE INDEX contact_submissions_expiry ON contact_submissions(expires_at);

CREATE INDEX site_health_project ON site_health_checks(project_id,started_at DESC,id DESC);

CREATE INDEX directory_reviews_project ON directory_reviews(project_id);

CREATE INDEX backend_versions_project ON backend_versions(project_id,created_at);

CREATE INDEX backend_runs_user_day ON backend_runs(user_id,day);

CREATE INDEX backend_runs_project_day ON backend_runs(project_id,day);

CREATE INDEX backend_runs_day ON backend_runs(day);

CREATE INDEX backend_state_reviews_project ON backend_state_reviews(project_id,created_at);

CREATE INDEX cms_setup_reviews_owner ON cms_setup_reviews(user_id,created_at);

CREATE INDEX cms_instances_owner ON cms_instances(user_id);

CREATE UNIQUE INDEX cms_publication_live_item ON cms_publication_reviews(project_id,collection,item_id) WHERE status='published' AND withdrawn=0;

CREATE UNIQUE INDEX cms_unpublish_once ON cms_unpublish_reviews(publication_id) WHERE status IN ('approved','complete');

CREATE UNIQUE INDEX cms_publication_one_pending_native ON cms_publication_reviews(project_id,collection,item_id) WHERE status='approved';

CREATE UNIQUE INDEX cms_discard_pending ON cms_discard_reviews(publication_id) WHERE status='approved';

CREATE INDEX backend_publication_reviews_project ON backend_publication_reviews(project_id);

CREATE INDEX backend_public_usage_day ON backend_public_usage(day);
CREATE INDEX public_client_usage_day ON public_client_usage(day);
CREATE INDEX storage_project_usage_period ON storage_project_usage(period);
CREATE INDEX operator_containments_subject ON operator_containments(subject_id) WHERE resolved_at IS NULL;
CREATE INDEX operator_containments_resolved ON operator_containments(resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX operator_session_revocations_account ON operator_session_revocations(account_id,created_at);

CREATE INDEX backend_form_reviews_project ON backend_form_reviews(project_id);

CREATE INDEX app_visitors_project ON app_visitors(project_id);
CREATE INDEX app_visitors_access ON app_visitors(access_id);

CREATE INDEX app_sessions_visitor ON app_sessions(visitor_id);

CREATE INDEX app_runs_visitor_day ON app_runs(visitor_id,day);

CREATE INDEX app_runs_project_day ON app_runs(project_id,day);

CREATE INDEX app_runs_day ON app_runs(day);

CREATE UNIQUE INDEX app_runs_applied_revision ON app_runs(visitor_id,base_revision) WHERE state='complete';

CREATE INDEX app_activation_project ON app_activation_reviews(project_id);

CREATE INDEX inference_calls_owner_time ON inference_calls(user_id,created_at,role);

CREATE INDEX app_invitation_project ON app_invitations(project_id);
CREATE INDEX app_invitation_access ON app_invitations(access_id);
CREATE INDEX app_challenge_access ON app_auth_challenges(access_id);

CREATE INDEX app_passkeys_visitor ON app_passkeys(visitor_id);

CREATE INDEX app_challenge_project ON app_auth_challenges(project_id);

CREATE INDEX app_page_reviews_project ON app_page_reviews(project_id);

CREATE INDEX site_traffic_retention ON site_traffic_daily(day);
CREATE INDEX site_traffic_quality_retention ON site_traffic_quality(day);

CREATE INDEX gateway_attempts_owner_task ON gateway_spend_attempts(user_id,task_id);

CREATE INDEX fair_use_lifecycle_owner_created ON fair_use_project_lifecycle(user_id,created_at);

CREATE INDEX cms_media_uploads_owner ON cms_media_uploads(user_id,created_at);

CREATE UNIQUE INDEX cms_import_source_current ON cms_import_reviews(project_id,source_digest,source_id) WHERE status<>'superseded';

CREATE INDEX domain_proof_removal_claim ON domain_proof_removals(claim_id,status);

CREATE INDEX application_builds_owner ON application_builds(user_id,project_id);
CREATE INDEX build_jobs_project_active ON build_jobs(project_id) WHERE state='running' OR cleanup<>'released';
CREATE INDEX build_jobs_user_active ON build_jobs(user_id) WHERE state='running' OR cleanup<>'released';
CREATE INDEX build_jobs_active ON build_jobs(state,cleanup) WHERE state='running' OR cleanup<>'released';

CREATE INDEX app_owner_erasures_expiry ON app_owner_erasures(expires_at);

CREATE INDEX app_recovery_project ON app_recovery_points(project_id,created_at);

CREATE INDEX app_migration_checks_project ON app_migration_checks(project_id);

CREATE INDEX fair_use_reviews_owner ON fair_use_reviews(user_id,created_at,id);

CREATE INDEX backend_nominations_owner ON backend_nominations(user_id,created_at,id);

CREATE INDEX standard_ai_owner_time ON standard_ai_requests(user_id,created_at,id);

CREATE UNIQUE INDEX usage_review_one_open ON usage_review_requests(user_id,kind) WHERE state='open';

CREATE INDEX usage_review_queue ON usage_review_requests(state,created_at,id);

CREATE INDEX contact_notification_destinations_address ON contact_notification_destinations(user_id,address);
CREATE INDEX contact_destination_reviews_owner ON contact_destination_reviews(user_id,project_id);

CREATE INDEX usage_review_owner_time ON usage_review_requests(user_id,created_at,id);

CREATE INDEX backend_imports_pending ON backend_imports(state,created_at,id);

CREATE INDEX backend_imports_owner ON backend_imports(user_id,project_id,created_at);

CREATE UNIQUE INDEX photo_scan_one_reserved ON photo_scan_tickets(kind,subject_id,digest,policy_version) WHERE state='reserved';

CREATE INDEX content_risk_evidence_owner ON content_risk_evidence(user_id,incident_id);

CREATE INDEX chat_review_receipts_owner ON chat_review_receipts(user_id,turn_id);

CREATE INDEX composition_plans_owner ON composition_plans(user_id,project_id);

CREATE INDEX project_spec_proposals_project ON project_spec_proposals(project_id,expires_at);

CREATE INDEX project_spec_proposals_expiry ON project_spec_proposals(expires_at);

CREATE INDEX service_client_proposals_project ON service_client_proposals(project_id,expires_at);

CREATE INDEX service_client_proposals_expiry ON service_client_proposals(expires_at);

CREATE INDEX service_client_versions_website ON service_client_versions(website_version_id);

CREATE INDEX service_client_activation_project ON service_client_activation_reviews(project_id,created_at);

CREATE INDEX service_client_activation_version ON service_client_activation_reviews(version_id);

CREATE UNIQUE INDEX stripe_pending_order ON stripe_subscription_orders(user_id) WHERE state='pending';

CREATE INDEX stripe_invoice_coverage ON stripe_paid_invoices(user_id,starts_at,ends_at);

CREATE INDEX github_staging_expiry ON github_token_staging(expires_at);

CREATE INDEX app_deletion_review_expiry ON app_deletion_reviews(expires_at);

CREATE INDEX feature_preview_scope ON feature_preview_grants(user_id,project_id,feature_id,operation,ends_at);

CREATE VIEW cms_live_articles AS
 SELECT r.id AS publication_id,r.project_id,r.user_id,r.collection,r.item_id,r.public_html,r.digest,json_extract(r.snapshot,'$.item.data.title') AS title,r.created_at
 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id JOIN cms_instances c ON c.project_id=r.project_id
 WHERE r.status='published' AND r.withdrawn=0 AND p.owner_user_id=r.user_id AND c.state='ready'
 AND NOT EXISTS(SELECT 1 FROM blocked_cms_publications b WHERE b.review_id=r.id);

CREATE VIEW project_service_status AS
 SELECT service.*,CASE WHEN site_live=1 OR cms_articles>0 OR backend_live=1 THEN 'live' WHEN status='live' THEN 'draft' ELSE status END AS service_status
 FROM (SELECT p.*,
 EXISTS(SELECT 1 FROM publications s WHERE s.project_id=p.id AND s.version_id IS NOT NULL) AS site_live,
 (SELECT count(*) FROM cms_live_articles c WHERE c.project_id=p.id) AS cms_articles,
 EXISTS(SELECT 1 FROM backend_publications b JOIN backend_publication_reviews r ON r.id=b.review_id AND r.status='applied' WHERE b.project_id=p.id AND b.version_id IS NOT NULL AND r.user_id=p.owner_user_id) AS backend_live
 FROM projects p) service;

CREATE VIEW app_live_pages AS
 SELECT r.id,r.project_id,r.config_json,r.program_revision,s.revision
 FROM app_page_settings s JOIN app_page_reviews r ON r.id=s.review_id JOIN app_spaces a ON a.project_id=s.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id
 WHERE r.status='applied' AND r.config_json IS NOT NULL AND a.enabled=1 AND a.owner_user_id=r.user_id AND a.revision=r.program_revision;

CREATE VIEW app_recovery_rosters AS SELECT a.project_id,coalesce((SELECT json_group_array(json(row_json)) FROM (SELECT json_object('visitor',v.id,'revision',d.revision) row_json FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id WHERE v.project_id=a.project_id AND v.revoked=0 ORDER BY v.id)),'[]') roster_json FROM app_spaces a;

CREATE VIEW app_migration_current AS SELECT m.id FROM app_migration_checks m
 JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id
 JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id
 JOIN app_recovery_points b ON b.id=m.id AND b.project_id=m.project_id AND b.user_id=m.user_id AND b.version_id=m.from_version AND b.removed=0 AND b.sealed=1
 JOIN app_recovery_rosters roster ON roster.project_id=m.project_id
 WHERE a.enabled=0 AND a.version_id=m.from_version AND a.revision=m.base_revision AND roster.roster_json=m.roster_json AND m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND NOT EXISTS(SELECT 1 FROM json_each(m.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=m.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.revision=json_extract(entry.value,'$.revision'))) AND NOT EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=m.id);

CREATE VIEW approved_project_photos AS
 SELECT f.id,f.project_id,f.digest FROM project_files f JOIN projects p ON p.id=f.project_id
 JOIN project_photo_safety s ON s.file_id=f.id AND s.user_id=p.owner_user_id AND s.digest=f.digest
 WHERE f.status='ready' AND s.policy_version='2026-09-30' AND s.state='approved'
 AND s.csam_check='clear' AND s.sexual_check='clear' AND length(s.scanner_reference)>0
 AND julianday(s.expires_at)>julianday('now');

-- One exact confirmed receipt per native media ID; ambiguous native identity is held, never approved.
CREATE VIEW approved_cms_media AS
 SELECT u.id AS upload_id,u.user_id,u.project_id,json_extract(u.result,'$.mediaId') AS media_id,u.digest,u.size,u.width,u.height
 FROM cms_media_uploads u JOIN projects p ON p.id=u.project_id AND p.owner_user_id=u.user_id
 JOIN cms_media_safety s ON s.upload_id=u.id AND s.user_id=u.user_id AND s.project_id=u.project_id AND s.digest=u.digest
 WHERE u.result IS NOT NULL AND s.policy_version='2026-09-30' AND s.state='approved'
 AND s.csam_check='clear' AND s.sexual_check='clear' AND length(s.scanner_reference)>0
 AND julianday(s.expires_at)>julianday('now')
 AND NOT EXISTS(SELECT 1 FROM cms_media_uploads o WHERE o.project_id=u.project_id AND o.id<>u.id AND json_extract(o.result,'$.mediaId')=json_extract(u.result,'$.mediaId'));

-- A blocked receipt revokes every publication that froze the same native media ID.
CREATE VIEW blocked_cms_publications AS
 SELECT DISTINCT m.review_id FROM cms_publication_media m JOIN cms_media_uploads u ON u.project_id=m.project_id AND json_extract(u.result,'$.mediaId')=m.media_id
 JOIN cms_media_safety s ON s.upload_id=u.id WHERE s.state='blocked';

CREATE VIEW project_spec_held AS SELECT v.version_id FROM project_spec_versions v JOIN projects p ON p.id=v.project_id JOIN site_versions s ON s.id=v.version_id
 WHERE EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=p.owner_user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(v.spec_digest,v.manifest_digest,s.digest));

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

CREATE VIEW service_client_activation_held AS SELECT a.id FROM service_client_activation_reviews a
 WHERE NOT EXISTS(SELECT 1 FROM service_client_versions WHERE id=a.version_id AND project_id=a.project_id)
 OR EXISTS(SELECT 1 FROM service_client_held WHERE id=a.version_id)
 OR EXISTS(SELECT 1 FROM content_screening_decisions d WHERE d.user_id=a.user_id AND d.kind='generated_artifact' AND d.required=1 AND d.digest IN(a.spec_digest,a.manifest_digest,a.preview_digest,a.candidate_digest,json_extract(a.target_json,'$.website.digest'),json_extract(a.target_json,'$.backend.digest')));

CREATE VIEW service_client_blocked_contacts AS SELECT c.project_id FROM contact_settings c
 JOIN contact_reviews r ON r.project_id=c.project_id AND r.expected_revision+1=c.revision AND r.status='applied' AND r.enabled=1 AND r.publication_revision=c.publication_revision
 JOIN service_client_activation_held a ON a.id=r.id;

CREATE VIEW backend_live_forms AS
 SELECT r.id,r.project_id,r.config_json,r.backend_publication_id,r.site_revision
 FROM backend_form_settings f JOIN backend_form_reviews r ON r.id=f.review_id JOIN projects p ON p.id=f.project_id AND p.owner_user_id=r.user_id JOIN publications s ON s.project_id=f.project_id JOIN backend_publications b ON b.project_id=f.project_id
 WHERE r.status='applied' AND r.enabled=1 AND s.version_id IS NOT NULL AND s.revision=r.site_revision AND b.review_id=r.backend_publication_id AND b.version_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM service_client_activation_held WHERE id=r.id);

-- Active operator containment per project and public scope (account subjects cover every project they own).
-- An active serving stop also reads as a freeze of the four public admission scopes, so the existing admission
-- triggers refuse public backend calls, visitor transitions, contact submissions and photo reads for that project.
CREATE VIEW operator_contained_projects AS
 SELECT c.subject_id AS project_id,c.scope,c.allowance,c.created_at,c.id FROM operator_containments c
 WHERE c.subject_kind='project' AND c.resolved_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 UNION ALL
 SELECT p.id AS project_id,c.scope,c.allowance,c.created_at,c.id FROM operator_containments c JOIN projects p ON p.owner_user_id=c.subject_id
 WHERE c.subject_kind='account' AND c.resolved_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 UNION ALL
 SELECT c.subject_id AS project_id,s.scope,NULL AS allowance,c.created_at,c.id FROM operator_containments c
 JOIN (SELECT 'backend' AS scope UNION ALL SELECT 'transition' UNION ALL SELECT 'contact' UNION ALL SELECT 'photo') s
 WHERE c.scope='serving' AND c.subject_kind='project' AND c.resolved_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now');
-- The one serving-stop predicate read by every public serving path (site host, visitor host, contact page, guest preview).
CREATE VIEW operator_serving_stopped AS SELECT DISTINCT project_id FROM operator_contained_projects WHERE scope='serving';

CREATE VIEW plan_entitlements AS SELECT user_id,plan_id,starts_at,ends_at FROM stripe_paid_invoices;

INSERT INTO cms_platform_deploy_lock("id","token","expires_at") VALUES(1,'','2000-01-01T00:00:00.000Z');

INSERT INTO plan_catalog("id","tier","published_sites") VALUES('explore',0,1);

INSERT INTO plan_catalog("id","tier","published_sites") VALUES('starter',1,1);

INSERT INTO plan_catalog("id","tier","published_sites") VALUES('personal',2,5);

INSERT INTO plan_catalog("id","tier","published_sites") VALUES('business',3,10);

INSERT INTO plan_catalog("id","tier","published_sites") VALUES('business-pro',4,25);

INSERT INTO site_traffic_metadata("id","enabled_at") VALUES(1,'2026-10-02T00:10:41.297Z');

INSERT INTO fair_use_control("id","requested_mode","updated_at") VALUES(1,'monitor','2026-10-02T00:10:41.311Z');

CREATE TRIGGER project_quota BEFORE INSERT ON projects
WHEN (SELECT COUNT(*) FROM projects WHERE owner_user_id = NEW.owner_user_id) >= 20
BEGIN SELECT RAISE(ABORT, 'project_quota'); END;

CREATE TRIGGER site_versions_quota BEFORE INSERT ON site_versions
WHEN (SELECT COUNT(*) FROM site_versions WHERE project_id = NEW.project_id) >= 25
BEGIN SELECT RAISE(ABORT, 'site_version_quota'); END;

CREATE TRIGGER site_versions_immutable BEFORE UPDATE ON site_versions
BEGIN SELECT RAISE(ABORT, 'site_version_immutable'); END;

CREATE TRIGGER publication_action_identity BEFORE UPDATE ON publication_actions
WHEN NEW.id != OLD.id OR NEW.user_id != OLD.user_id OR NEW.project_id != OLD.project_id OR NEW.kind != OLD.kind OR NEW.version_id IS NOT OLD.version_id OR NEW.expected_revision != OLD.expected_revision OR NEW.expires_at != OLD.expires_at OR OLD.status != 'pending' OR NEW.status != 'applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'publication_action_immutable'); END;

CREATE TRIGGER publication_apply AFTER UPDATE ON publication_actions
BEGIN
 UPDATE publications SET version_id=NEW.version_id,revision=revision+1 WHERE project_id=NEW.project_id;
 UPDATE projects SET status=CASE WHEN NEW.version_id IS NULL THEN 'draft' ELSE 'live' END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('publication:'||NEW.id,NEW.user_id,NEW.project_id,'site.'||NEW.kind,CASE WHEN NEW.kind='unpublish' THEN 'Unpublished site' WHEN NEW.kind='restore' THEN 'Restored published site version' ELSE 'Published site version' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER chat_export_owner BEFORE INSERT ON chat_exports
BEGIN
 SELECT RAISE(ABORT, 'export_owner') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN site_versions v ON v.id=NEW.version_id
  JOIN projects p ON p.id=v.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id
 );
END;

CREATE TRIGGER chat_export_immutable BEFORE UPDATE ON chat_exports
BEGIN SELECT RAISE(ABORT, 'export_immutable'); END;

CREATE TRIGGER project_file_quota BEFORE INSERT ON project_files
WHEN NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'file_project_quota') WHERE (SELECT COUNT(*) FROM project_files WHERE project_id=NEW.project_id)>=20;
 SELECT RAISE(ABORT,'file_account_quota') WHERE (SELECT COUNT(*) FROM project_files f JOIN projects p ON p.id=f.project_id WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=50;
 SELECT RAISE(ABORT,'file_platform_quota') WHERE (SELECT COUNT(*) FROM project_files)>=500;
END;

CREATE TRIGGER project_file_immutable BEFORE UPDATE ON project_files
BEGIN
 SELECT RAISE(ABORT,'file_immutable') WHERE NEW.id!=OLD.id OR NEW.project_id!=OLD.project_id OR NEW.name!=OLD.name OR NEW.object_key!=OLD.object_key OR NEW.handoff_json!=OLD.handoff_json OR NEW.digest!=OLD.digest OR NEW.size!=OLD.size OR NEW.width!=OLD.width OR NEW.height!=OLD.height OR NEW.created_at!=OLD.created_at OR (OLD.status='ready' AND NEW.status!='ready');
END;

CREATE TRIGGER project_file_handoff BEFORE INSERT ON project_files
WHEN NEW.handoff_json!='null' AND NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'photo_handoff_changed') WHERE (SELECT count(*) FROM json_each(NEW.handoff_json))!=2;
 SELECT RAISE(ABORT,'photo_handoff_changed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_interactions i JOIN projects p ON p.id=i.project_id AND p.owner_user_id=i.user_id
  WHERE i.id=json_extract(NEW.handoff_json,'$.interactionId') AND i.project_id=NEW.project_id
   AND i.definition_digest=json_extract(NEW.handoff_json,'$.definitionDigest')
   AND i.state='open' AND i.removed_at IS NULL AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND json_extract(i.envelope_json,'$.definition.cards[0].id')='photo-upload'
   AND json_extract(i.envelope_json,'$.definition.cards[0].binding')='project.photos@1'
   AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id));
END;

CREATE TRIGGER project_file_cleanup AFTER DELETE ON project_files
BEGIN
 INSERT OR IGNORE INTO file_cleanup(object_key,created_at,project_id,owner_user_id)
 VALUES(OLD.object_key,strftime('%Y-%m-%dT%H:%M:%fZ','now'),OLD.project_id,(SELECT owner_user_id FROM projects WHERE id=OLD.project_id));
END;
-- A cascading file delete no longer sees its project, so project deletion queues its objects with the owner first.
CREATE TRIGGER project_file_cleanup_owner BEFORE DELETE ON projects
BEGIN
 INSERT OR IGNORE INTO file_cleanup(object_key,created_at,project_id,owner_user_id)
 SELECT object_key,strftime('%Y-%m-%dT%H:%M:%fZ','now'),project_id,OLD.owner_user_id FROM project_files WHERE project_id=OLD.id;
END;

CREATE TRIGGER version_photo_owner BEFORE INSERT ON version_photos
BEGIN
 SELECT RAISE(ABORT,'version_photo_owner') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN project_files f ON f.project_id=v.project_id WHERE v.id=NEW.version_id AND f.id=NEW.file_id AND f.status='ready');
END;

CREATE TRIGGER version_photo_immutable BEFORE UPDATE ON version_photos
BEGIN SELECT RAISE(ABORT,'version_photo_immutable'); END;

CREATE TRIGGER domain_claim_quota BEFORE INSERT ON domain_claims BEGIN
 SELECT RAISE(ABORT,'domain_claim_quota') WHERE
 (SELECT COUNT(*) FROM domain_claims WHERE project_id=NEW.project_id)>=3 OR
 (SELECT COUNT(*) FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=10 OR
 (SELECT COUNT(*) FROM domain_claims)>=80;
END;

CREATE TRIGGER domain_claim_identity BEFORE UPDATE OF id,project_id,hostname,created_at ON domain_claims BEGIN
 SELECT RAISE(ABORT,'domain_claim_identity');
END;

CREATE TRIGGER github_connection_owner_insert BEFORE INSERT ON github_connections
WHEN NEW.active_token_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'github_token_owner') WHERE NOT EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.active_token_id AND user_id=NEW.user_id AND state='active'); END;

CREATE TRIGGER github_connection_owner_update BEFORE UPDATE ON github_connections
WHEN NEW.active_token_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'github_token_owner') WHERE NOT EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.active_token_id AND user_id=NEW.user_id AND state='active'); END;

CREATE TRIGGER github_token_quota BEFORE INSERT ON github_token_vault
WHEN (SELECT COUNT(*) FROM github_token_vault WHERE user_id=NEW.user_id)>=10
BEGIN SELECT RAISE(ABORT,'github_token_quota'); END;

CREATE TRIGGER github_backup_owner BEFORE INSERT ON github_backups
BEGIN
 SELECT RAISE(ABORT,'github_backup_owner') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'github_backup_quota') WHERE ((SELECT count(*) FROM github_backups t WHERE t.project_id=NEW.project_id AND ((t.state='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('dispatching','uncertain')))>=25
  OR (SELECT count(*) FROM github_backups t WHERE t.user_id=NEW.user_id AND ((t.state='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('dispatching','uncertain')))>=100
  OR (SELECT count(*) FROM github_backups t WHERE ((t.state='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('dispatching','uncertain')))>=5000
  OR ((SELECT count(*) FROM github_backups t WHERE ((t.state='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('dispatching','uncertain')))>=2500 AND (SELECT count(*) FROM github_backups t WHERE t.user_id=NEW.user_id AND ((t.state='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('dispatching','uncertain')))>=25));
END;

CREATE TRIGGER github_backup_identity BEFORE UPDATE ON github_backups
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.request_hash!=OLD.request_hash OR NEW.github_user_id!=OLD.github_user_id OR NEW.repo_id!=OLD.repo_id OR NEW.repo_owner!=OLD.repo_owner OR NEW.repo_name!=OLD.repo_name OR NEW.repo_private!=OLD.repo_private OR NEW.branch!=OLD.branch OR NEW.path!=OLD.path OR NEW.sha256!=OLD.sha256 OR NEW.tree_sha!=OLD.tree_sha OR NEW.base_head!=OLD.base_head OR NEW.files_json!=OLD.files_json OR NEW.byte_length!=OLD.byte_length OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR (NEW.token_id IS NOT OLD.token_id AND NEW.token_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'github_backup_immutable'); END;

CREATE TRIGGER domain_connection_owner BEFORE INSERT ON domain_connections BEGIN
 SELECT RAISE(ABORT,'domain_connection_initial') WHERE NEW.state!='review' OR NEW.provider_id IS NOT NULL OR NEW.serve_until IS NOT NULL;
 SELECT RAISE(ABORT,'domain_connection_owner') WHERE NOT EXISTS(SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND d.hostname=NEW.hostname AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'domain_connection_reviews') WHERE ((SELECT count(*) FROM domain_connections t WHERE t.project_id=NEW.project_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('creating','uncertain','provisioning','active','disconnecting')))>=25
  OR (SELECT count(*) FROM domain_connections t WHERE t.user_id=NEW.user_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('creating','uncertain','provisioning','active','disconnecting')))>=100
  OR (SELECT count(*) FROM domain_connections t WHERE ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('creating','uncertain','provisioning','active','disconnecting')))>=5000
  OR ((SELECT count(*) FROM domain_connections t WHERE ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('creating','uncertain','provisioning','active','disconnecting')))>=2500 AND (SELECT count(*) FROM domain_connections t WHERE t.user_id=NEW.user_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('creating','uncertain','provisioning','active','disconnecting')))>=25));
END;

CREATE TRIGGER domain_connection_capacity BEFORE UPDATE OF state ON domain_connections
WHEN OLD.state='review' AND NEW.state='creating'
BEGIN SELECT RAISE(ABORT,'domain_connection_capacity') WHERE (SELECT COUNT(*) FROM domain_connections WHERE state NOT IN ('review','disconnected'))>=80; END;

CREATE TRIGGER domain_connection_identity BEFORE UPDATE ON domain_connections
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.claim_id!=OLD.claim_id OR NEW.project_id!=OLD.project_id OR NEW.hostname!=OLD.hostname OR NEW.zone_id!=OLD.zone_id OR NEW.target!=OLD.target OR NEW.proof_hash!=OLD.proof_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS NOT OLD.provider_id)
BEGIN SELECT RAISE(ABORT,'domain_connection_immutable'); END;

CREATE TRIGGER domain_reconciliation_audit AFTER UPDATE OF reconciliation_id ON domain_connections
WHEN NEW.reconciliation_id IS NOT NULL AND NEW.reconciliation_id IS NOT OLD.reconciliation_id
BEGIN
 SELECT RAISE(ABORT,'domain_reconciliation_state') WHERE OLD.provider_id IS NOT NULL OR OLD.state NOT IN ('uncertain','disconnecting') OR NEW.provider_id IS NULL OR NEW.state NOT IN ('provisioning','disconnecting') OR NEW.serve_until IS NOT NULL OR (OLD.state='disconnecting' AND NEW.state!='disconnecting');
 INSERT INTO domain_reconciliations(id,connection_id,user_id,hostname,zone_id,provider_id,old_state,new_state,evidence,operator,created_at) VALUES(NEW.reconciliation_id,NEW.id,NEW.user_id,NEW.hostname,NEW.zone_id,NEW.provider_id,OLD.state,NEW.state,NEW.reconciliation_evidence,NEW.reconciliation_operator,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('hosting-recovery:'||NEW.reconciliation_id,NEW.user_id,NEW.project_id,'domain.reconciled','Operator reconciled an uncertain hostname; routing remains disabled',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER domain_reconciliation_no_update BEFORE UPDATE ON domain_reconciliations BEGIN SELECT RAISE(ABORT,'domain_reconciliation_immutable'); END;

CREATE TRIGGER domain_reconciliation_no_delete BEFORE DELETE ON domain_reconciliations BEGIN SELECT RAISE(ABORT,'domain_reconciliation_immutable'); END;

CREATE TRIGGER photo_removal_identity BEFORE UPDATE ON photo_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.file_id!=OLD.file_id OR NEW.name!=OLD.name OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'photo_removal_immutable'); END;

CREATE TRIGGER photo_removal_guard BEFORE UPDATE ON photo_removals
BEGIN
 SELECT RAISE(ABORT,'photo_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'photo_removal_changed') WHERE NOT EXISTS(SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by WHERE f.id=NEW.file_id AND f.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='confirm' AND json_extract(t.action_json,'$.kind')='photo' AND json_extract(t.action_json,'$.reviewId')=NEW.id);
END;

CREATE TRIGGER photo_removal_apply AFTER UPDATE ON photo_removals
BEGIN
 DELETE FROM project_files WHERE id=NEW.file_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('photo-removal:'||NEW.file_id,NEW.user_id,NEW.project_id,'file.removed','Removed an unused private project photo',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER project_file_retained BEFORE DELETE ON project_files
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM version_photos WHERE file_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'photo_removal_referenced'); END;

CREATE TRIGGER project_file_removed BEFORE INSERT ON project_files
WHEN EXISTS(SELECT 1 FROM photo_removals WHERE file_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'photo_removal_replay'); END;

CREATE TRIGGER project_file_cleanup_capacity BEFORE INSERT ON project_files
WHEN NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.id)
 AND (SELECT COUNT(*) FROM project_files)+(SELECT COUNT(*) FROM file_cleanup)>=500
BEGIN SELECT RAISE(ABORT,'file_cleanup_quota'); END;

CREATE TRIGGER cloudflare_vault_quota BEFORE INSERT ON cloudflare_token_vault
WHEN (SELECT COUNT(*) FROM cloudflare_token_vault WHERE user_id=NEW.user_id)>=10
BEGIN SELECT RAISE(ABORT,'cloudflare_vault_quota'); END;

CREATE TRIGGER cloudflare_vault_identity BEFORE UPDATE ON cloudflare_token_vault
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.expires_at!=OLD.expires_at OR NEW.created_at!=OLD.created_at
BEGIN SELECT RAISE(ABORT,'cloudflare_vault_immutable'); END;

CREATE TRIGGER cloudflare_dns_quota BEFORE INSERT ON cloudflare_dns_actions
WHEN (((SELECT count(*) FROM cloudflare_dns_actions t WHERE t.project_id=NEW.project_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('sending','uncertain')))>=25
  OR (SELECT count(*) FROM cloudflare_dns_actions t WHERE t.user_id=NEW.user_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('sending','uncertain')))>=100
  OR (SELECT count(*) FROM cloudflare_dns_actions t WHERE ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('sending','uncertain')))>=5000
  OR ((SELECT count(*) FROM cloudflare_dns_actions t WHERE ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('sending','uncertain')))>=2500 AND (SELECT count(*) FROM cloudflare_dns_actions t WHERE t.user_id=NEW.user_id AND ((t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.state IN ('sending','uncertain')))>=25)))
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_quota'); END;

CREATE TRIGGER cloudflare_dns_identity BEFORE UPDATE ON cloudflare_dns_actions
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.claim_id!=OLD.claim_id OR NEW.project_id!=OLD.project_id OR NEW.token_id!=OLD.token_id OR NEW.zone_id!=OLD.zone_id OR NEW.zone_name!=OLD.zone_name OR NEW.record_name!=OLD.record_name OR NEW.content!=OLD.content OR NEW.inventory_hash!=OLD.inventory_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_immutable'); END;

CREATE TRIGGER version_removal_identity BEFORE UPDATE ON version_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.digest!=OLD.digest OR NEW.component_id!=OLD.component_id OR NEW.version_created_at!=OLD.version_created_at OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'version_removal_immutable'); END;

CREATE TRIGGER version_removal_guard BEFORE UPDATE ON version_removals
BEGIN
 SELECT RAISE(ABORT,'version_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'version_removal_changed') WHERE NOT EXISTS(SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by WHERE v.id=NEW.version_id AND v.project_id=NEW.project_id AND v.digest=NEW.digest AND v.component_id=NEW.component_id AND v.created_at=NEW.version_created_at AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='confirm' AND json_extract(t.action_json,'$.kind')='version' AND json_extract(t.action_json,'$.reviewId')=NEW.id);
END;

CREATE TRIGGER version_removal_apply AFTER UPDATE ON version_removals
BEGIN
 DELETE FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('version-removal:'||NEW.version_id,NEW.user_id,NEW.project_id,'site.version.removed','Removed saved version '||NEW.version_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER site_version_retained BEFORE DELETE ON site_versions
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN
 SELECT RAISE(ABORT,'version_removal_live') WHERE EXISTS(SELECT 1 FROM publications WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_publication') WHERE EXISTS(SELECT 1 FROM publication_actions WHERE version_id=OLD.id AND status='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'version_removal_backup') WHERE EXISTS(SELECT 1 FROM github_backups WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_unreviewed') WHERE NOT EXISTS(SELECT 1 FROM version_removals WHERE version_id=OLD.id AND project_id=OLD.project_id AND digest=OLD.digest AND status='applied');
END;

CREATE TRIGGER site_version_removed BEFORE INSERT ON site_versions
WHEN EXISTS(SELECT 1 FROM version_removals WHERE version_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'version_removal_replay'); END;

CREATE TRIGGER contact_review_identity BEFORE UPDATE ON contact_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.enabled!=OLD.enabled OR NEW.expected_revision!=OLD.expected_revision OR NEW.publication_revision!=OLD.publication_revision OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'contact_review_changed'); END;

CREATE TRIGGER contact_review_confirm BEFORE UPDATE ON contact_reviews
BEGIN
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM contact_settings c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND c.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL AND revision=NEW.publication_revision);
 SELECT RAISE(ABORT,'contact_review_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='contact' AND json_extract(action_json,'$.reviewId')=NEW.id);
END;

CREATE TRIGGER contact_review_apply AFTER UPDATE ON contact_reviews
BEGIN
 UPDATE contact_settings SET revision=revision+1,enabled=NEW.enabled,publication_revision=NEW.publication_revision WHERE project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('contact:'||NEW.id,NEW.user_id,NEW.project_id,'contact.settings',CASE WHEN NEW.enabled=1 THEN 'Enabled contact form for reviewed publication' ELSE 'Disabled contact form' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER contact_receipt_immutable BEFORE UPDATE ON contact_receipts
BEGIN SELECT RAISE(ABORT,'contact_receipt_immutable'); END;

CREATE TRIGGER contact_submission_guard BEFORE INSERT ON contact_submissions
WHEN NOT EXISTS(SELECT 1 FROM contact_submissions WHERE id=NEW.id)
BEGIN
 SELECT RAISE(ABORT,'contact_received') WHERE EXISTS(SELECT 1 FROM contact_receipts WHERE id=NEW.id);
 SELECT RAISE(ABORT,'contact_unavailable') WHERE NOT EXISTS(SELECT 1 FROM contact_settings c JOIN publications s ON s.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.revision=NEW.settings_revision AND c.enabled=1 AND s.version_id IS NOT NULL AND s.revision=c.publication_revision);
 SELECT RAISE(ABORT,'contact_capacity') WHERE (SELECT COUNT(*) FROM contact_receipts WHERE project_id=NEW.project_id)>=100 OR (SELECT COUNT(*) FROM contact_receipts)>=1000 OR
 -- Fair share: once 500 receipts are retained platform-wide, only accounts retaining fewer than 100 are admitted.
 ((SELECT COUNT(*) FROM contact_receipts)>=500 AND (SELECT COUNT(*) FROM contact_receipts r JOIN projects p ON p.id=r.project_id WHERE p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))>=100);
 -- Hourly submissions: 20 unless an active operator containment freezes intake (0) or sets a temporary allowance.
 SELECT RAISE(ABORT,'contact_rate') WHERE (SELECT COUNT(*) FROM contact_receipts WHERE project_id=NEW.project_id AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))>=coalesce((SELECT coalesce(allowance,0) FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='contact' ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1),20);
END;

CREATE TRIGGER contact_submission_immutable BEFORE UPDATE ON contact_submissions
BEGIN SELECT RAISE(ABORT,'contact_submission_immutable'); END;

CREATE TRIGGER contact_submission_receipt AFTER INSERT ON contact_submissions
BEGIN
 INSERT INTO contact_receipts(id,project_id,request_hash,created_at,expires_at) VALUES(NEW.id,NEW.project_id,NEW.request_hash,NEW.created_at,NEW.expires_at);
END;

CREATE TRIGGER chat_comparison_owner BEFORE INSERT ON chat_comparisons
BEGIN
 SELECT RAISE(ABORT,'comparison_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN site_versions v ON v.id=NEW.version_id JOIN projects p ON p.id=v.project_id WHERE t.id=NEW.turn_id AND t.user_id=p.owner_user_id AND (NEW.baseline_id IS NULL OR EXISTS(SELECT 1 FROM site_versions b WHERE b.id=NEW.baseline_id AND b.project_id=v.project_id)));
END;

CREATE TRIGGER chat_comparison_immutable BEFORE UPDATE ON chat_comparisons
BEGIN SELECT RAISE(ABORT,'comparison_immutable'); END;

CREATE TRIGGER cloudflare_dns_routing_identity BEFORE UPDATE ON cloudflare_dns_actions
WHEN NEW.record_type!=OLD.record_type OR NEW.connection_id IS NOT OLD.connection_id OR NEW.proof_token IS NOT OLD.proof_token
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_immutable'); END;

CREATE TRIGGER cloudflare_dns_receipt AFTER UPDATE OF state ON cloudflare_dns_actions
WHEN NEW.state IN ('applied','unchanged','observed') AND OLD.state NOT IN ('applied','unchanged','observed')
BEGIN
 INSERT OR IGNORE INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('cf-dns:'||NEW.id,NEW.user_id,NEW.project_id,'domain.dns.receipt','Recorded Cloudflare '||NEW.record_type||' result; public DNS and hosting verification remain separate',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER site_health_claim BEFORE INSERT ON site_health_checks
BEGIN
 SELECT RAISE(ABORT,'health_publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id LEFT JOIN contact_settings c ON c.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.version_id=NEW.version_id AND s.revision=NEW.publication_revision AND COALESCE(c.revision,-1)=NEW.contact_revision);
 SELECT RAISE(ABORT,'health_cooldown') WHERE EXISTS(SELECT 1 FROM site_health_checks h WHERE h.project_id=NEW.project_id AND h.publication_revision=NEW.publication_revision AND h.contact_revision=NEW.contact_revision AND h.started_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;

CREATE TRIGGER site_health_budget_claim AFTER INSERT ON site_health_checks
BEGIN
 INSERT INTO site_health_budget(day,checks) VALUES(substr(NEW.started_at,1,10),1) ON CONFLICT(day) DO UPDATE SET checks=checks+1;
END;

CREATE TRIGGER directory_review_identity BEFORE UPDATE ON directory_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.kind!=OLD.kind OR NEW.snapshot_json!=OLD.snapshot_json OR NEW.digest!=OLD.digest OR NEW.expected_revision!=OLD.expected_revision OR NEW.publication_revision!=OLD.publication_revision OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;

-- Listing slots (draft plus live) are bounded per owner (250) under a platform ceiling (2000). Once the platform holds
-- 1000 slots, an owner already holding 62 may not add more. Only growth is refused, so edits that remove listings and
-- withdrawals (which only clear the live copy) are never refused for capacity.
CREATE TRIGGER directory_capacity BEFORE UPDATE ON directories
WHEN json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>json_array_length(OLD.draft_json)+COALESCE(json_array_length(OLD.live_json),0)
BEGIN
 SELECT RAISE(ABORT,'directory_capacity') WHERE
  (SELECT COALESCE(SUM(json_array_length(d.draft_json)+COALESCE(json_array_length(d.live_json),0)),0) FROM directories d JOIN projects p ON p.id=d.project_id WHERE d.project_id!=NEW.project_id AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))+json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>250
  OR (SELECT COALESCE(SUM(json_array_length(draft_json)+COALESCE(json_array_length(live_json),0)),0) FROM directories WHERE project_id!=NEW.project_id)+json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>2000
  OR ((SELECT COALESCE(SUM(json_array_length(draft_json)+COALESCE(json_array_length(live_json),0)),0) FROM directories WHERE project_id!=NEW.project_id)+json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>1000
   AND (SELECT COALESCE(SUM(json_array_length(d.draft_json)+COALESCE(json_array_length(d.live_json),0)),0) FROM directories d JOIN projects p ON p.id=d.project_id WHERE d.project_id!=NEW.project_id AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id))+json_array_length(NEW.draft_json)+COALESCE(json_array_length(NEW.live_json),0)>62);
END;

CREATE TRIGGER directory_review_apply AFTER UPDATE ON directory_reviews
BEGIN
 UPDATE directories SET revision=revision+1,draft_json=CASE WHEN NEW.kind='edit' THEN NEW.snapshot_json ELSE draft_json END,live_json=CASE NEW.kind WHEN 'publish' THEN NEW.snapshot_json WHEN 'unpublish' THEN NULL ELSE live_json END,live_review_id=CASE NEW.kind WHEN 'publish' THEN NEW.id WHEN 'unpublish' THEN NULL ELSE live_review_id END,live_digest=CASE NEW.kind WHEN 'publish' THEN NEW.digest WHEN 'unpublish' THEN NULL ELSE live_digest END,publication_revision=CASE WHEN NEW.kind='publish' THEN NEW.publication_revision ELSE publication_revision END,published_at=CASE WHEN NEW.kind='publish' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE published_at END WHERE project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('directory:'||NEW.id,NEW.user_id,NEW.project_id,'directory.'||NEW.kind,CASE NEW.kind WHEN 'edit' THEN 'Updated private directory draft' WHEN 'publish' THEN 'Published reviewed directory snapshot' ELSE 'Took directory offline' END,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER directory_restore_source BEFORE INSERT ON directory_reviews
WHEN NEW.source_review_id IS NOT NULL
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.kind!='edit' OR NOT EXISTS(SELECT 1 FROM directory_reviews r WHERE r.id=NEW.source_review_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.status='applied' AND r.kind IN ('edit','publish') AND r.snapshot_json=NEW.snapshot_json AND r.digest=NEW.digest);
END;

CREATE TRIGGER directory_restore_identity BEFORE UPDATE ON directory_reviews
WHEN NEW.source_review_id IS NOT OLD.source_review_id
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;

CREATE TRIGGER directory_export_owner BEFORE INSERT ON directory_exports
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN directory_reviews r ON r.id=NEW.review_id AND r.user_id=t.user_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND r.status='applied' AND r.kind IN ('edit','publish'));
END;

CREATE TRIGGER directory_export_immutable BEFORE UPDATE ON directory_exports
BEGIN SELECT RAISE(ABORT,'directory_changed'); END;

CREATE TRIGGER directory_review_insert BEFORE INSERT ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'directory_capacity') WHERE NOT (NEW.kind='unpublish') AND ((SELECT count(*) FROM directory_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.kind='unpublish'))>=25
  OR (SELECT count(*) FROM directory_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.kind='unpublish'))>=100
  OR (SELECT count(*) FROM directory_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.kind='unpublish'))>=5000
  OR ((SELECT count(*) FROM directory_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.kind='unpublish'))>=2500 AND (SELECT count(*) FROM directory_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.kind='unpublish'))>=25));
END;

CREATE TRIGGER directory_review_retained BEFORE DELETE ON directory_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'directory_retained') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (OLD.kind='unpublish' AND NOT (OLD.status='applied') AND EXISTS(SELECT 1 FROM directory_reviews x WHERE x.expires_at>OLD.expires_at AND x.kind='unpublish' AND x.project_id=OLD.project_id)))
  OR (EXISTS(SELECT 1 FROM directories WHERE live_review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM directory_exports WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR (OLD.kind='unpublish') OR OLD.id NOT IN (SELECT t.id FROM directory_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' AND NOT (t.kind='unpublish') ORDER BY t.expected_revision DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='directory_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER backend_versions_immutable BEFORE UPDATE ON backend_versions BEGIN SELECT RAISE(ABORT,'backend_immutable'); END;

CREATE TRIGGER backend_versions_quota BEFORE INSERT ON backend_versions WHEN
 (SELECT count(*) FROM backend_versions WHERE project_id=NEW.project_id)>=25 OR (SELECT count(*) FROM backend_versions)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_version_quota'); END;

CREATE TRIGGER backend_runs_authority BEFORE INSERT ON backend_runs WHEN NOT EXISTS (
 SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id
) BEGIN SELECT RAISE(ABORT,'backend_owner'); END;

CREATE TRIGGER backend_runs_quota BEFORE INSERT ON backend_runs WHEN
 NEW.day<>strftime('%Y-%m-%d','now') OR (SELECT count(*) FROM backend_runs)>=5000 OR
 (SELECT count(*) FROM backend_runs WHERE project_id=NEW.project_id AND day=NEW.day)>=20 OR
 (SELECT count(*) FROM backend_runs WHERE user_id=NEW.user_id AND day=NEW.day)>=100 OR
 (SELECT count(*) FROM backend_runs WHERE day=NEW.day)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_run_quota'); END;

CREATE TRIGGER backend_runs_identity BEFORE UPDATE ON backend_runs WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.request_hash<>OLD.request_hash OR NEW.day<>OLD.day OR NEW.created_at<>OLD.created_at OR OLD.state='complete'
 BEGIN SELECT RAISE(ABORT,'backend_run_immutable'); END;

CREATE TRIGGER backend_state_review_insert BEFORE INSERT ON backend_state_reviews WHEN
 NEW.status<>'preparing' OR NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id JOIN backend_state s ON s.project_id=p.id WHERE v.id=NEW.version_id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision AND s.state_json=NEW.before_json) OR
 (((SELECT count(*) FROM backend_state_reviews t WHERE t.project_id=NEW.project_id AND t.status IN ('preparing','ready') AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25
  OR (SELECT count(*) FROM backend_state_reviews t WHERE t.user_id=NEW.user_id AND t.status IN ('preparing','ready') AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=100
  OR (SELECT count(*) FROM backend_state_reviews t WHERE t.status IN ('preparing','ready') AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=5000
  OR ((SELECT count(*) FROM backend_state_reviews t WHERE t.status IN ('preparing','ready') AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=2500 AND (SELECT count(*) FROM backend_state_reviews t WHERE t.user_id=NEW.user_id AND t.status IN ('preparing','ready') AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25)))
 BEGIN SELECT RAISE(ABORT,'backend_state_review_unavailable'); END;

CREATE TRIGGER backend_state_review_identity BEFORE UPDATE ON backend_state_reviews WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.base_revision<>OLD.base_revision OR NEW.before_json<>OLD.before_json OR NEW.input_json<>OLD.input_json OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR
 NOT ((OLD.status='preparing' AND NEW.status IN ('ready','failed')) OR (OLD.status='ready' AND NEW.status='applied' AND NEW.after_json IS OLD.after_json AND NEW.result_json IS OLD.result_json))
 BEGIN SELECT RAISE(ABORT,'backend_state_review_immutable'); END;

CREATE TRIGGER backend_state_confirm_guard BEFORE UPDATE OF status ON backend_state_reviews WHEN NEW.status='applied' AND (
 NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM backend_state s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision AND s.state_json=NEW.before_json))
 BEGIN SELECT RAISE(ABORT,'backend_state_review_stale'); END;

CREATE TRIGGER backend_state_apply AFTER UPDATE OF status ON backend_state_reviews WHEN NEW.status='applied' BEGIN
 UPDATE backend_state SET state_json=NEW.after_json,revision=NEW.base_revision+1 WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER backend_state_initial BEFORE INSERT ON backend_state WHEN NEW.revision<>0 OR NEW.state_json<>'{}' BEGIN SELECT RAISE(ABORT,'backend_state_initial'); END;

CREATE TRIGGER backend_state_guard BEFORE UPDATE ON backend_state WHEN NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(
 SELECT 1 FROM backend_state_reviews WHERE project_id=OLD.project_id AND status='applied' AND base_revision=OLD.revision AND before_json=OLD.state_json AND after_json=NEW.state_json
) BEGIN SELECT RAISE(ABORT,'backend_state_review_required'); END;

CREATE TRIGGER backend_state_restore_source BEFORE INSERT ON backend_state_reviews WHEN
 (NEW.restore_review_id IS NULL)<>(NEW.restore_side IS NULL) OR
 (NEW.restore_review_id IS NOT NULL AND (NEW.input_json<>'null' OR NOT EXISTS(
 SELECT 1 FROM backend_state_reviews r WHERE r.id=NEW.restore_review_id AND r.status='applied' AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id
 ))) BEGIN SELECT RAISE(ABORT,'backend_state_restore_source'); END;

CREATE TRIGGER backend_state_restore_identity BEFORE UPDATE ON backend_state_reviews WHEN
 NEW.restore_review_id IS NOT OLD.restore_review_id OR NEW.restore_side IS NOT OLD.restore_side OR
 (NEW.restore_review_id IS NOT NULL AND NEW.status='ready' AND NOT EXISTS(
 SELECT 1 FROM backend_state_reviews r WHERE r.id=NEW.restore_review_id AND r.status='applied' AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND
 NEW.after_json=CASE NEW.restore_side WHEN 'before' THEN r.before_json ELSE r.after_json END
 )) BEGIN SELECT RAISE(ABORT,'backend_state_restore_immutable'); END;

CREATE TRIGGER backend_state_links_authority BEFORE INSERT ON backend_state_links WHEN NOT EXISTS(
 SELECT 1 FROM chat_turns t JOIN backend_state_reviews r ON r.id=NEW.review_id JOIN projects p ON p.id=r.project_id WHERE t.id=NEW.turn_id AND t.user_id=r.user_id AND p.owner_user_id=t.user_id AND (NEW.kind='review' OR r.status='applied')
) BEGIN SELECT RAISE(ABORT,'backend_state_link_owner'); END;

CREATE TRIGGER backend_state_links_immutable BEFORE UPDATE ON backend_state_links BEGIN SELECT RAISE(ABORT,'backend_state_link_immutable'); END;

CREATE TRIGGER cms_setup_review_guard BEFORE INSERT ON cms_setup_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id) OR
 EXISTS(SELECT 1 FROM cms_instances WHERE project_id=NEW.project_id) OR (((SELECT count(*) FROM cms_setup_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25
  OR (SELECT count(*) FROM cms_setup_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=100
  OR (SELECT count(*) FROM cms_setup_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=5000
  OR ((SELECT count(*) FROM cms_setup_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=2500 AND (SELECT count(*) FROM cms_setup_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25)))
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_unavailable'); END;

CREATE TRIGGER cms_instances_insert BEFORE INSERT ON cms_instances WHEN
 NEW.state<>'queued' OR NEW.database_id IS NOT NULL OR NEW.session_namespace_id IS NOT NULL OR NEW.deployed_version_id IS NOT NULL OR
 NEW.worker_name<>'whumpo-cms-'||replace(NEW.project_id,'-','') OR NEW.database_name<>NEW.worker_name OR NEW.bucket_name<>NEW.worker_name||'-media' OR
 NOT EXISTS(SELECT 1 FROM cms_setup_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND r.status='approved') OR
 (SELECT count(*) FROM cms_instances)>=5 OR (SELECT count(*) FROM cms_instances WHERE user_id=NEW.user_id)>=2
 BEGIN SELECT RAISE(ABORT,'cms_instance_unavailable'); END;

CREATE TRIGGER cms_setup_review_identity BEFORE UPDATE ON cms_setup_reviews WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.title<>OLD.title OR NEW.tagline<>OLD.tagline OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'approved'
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_immutable'); END;

CREATE TRIGGER cms_setup_confirm_guard BEFORE UPDATE OF status ON cms_setup_reviews WHEN NEW.status='approved' AND (
 NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id) OR EXISTS(SELECT 1 FROM cms_instances WHERE project_id=NEW.project_id))
 BEGIN SELECT RAISE(ABORT,'cms_setup_review_stale'); END;

CREATE TRIGGER cms_setup_enqueue AFTER UPDATE OF status ON cms_setup_reviews WHEN NEW.status='approved' BEGIN
 INSERT INTO cms_instances(project_id,user_id,review_id,worker_name,database_name,bucket_name) VALUES(NEW.project_id,NEW.user_id,NEW.id,'whumpo-cms-'||replace(NEW.project_id,'-',''),'whumpo-cms-'||replace(NEW.project_id,'-',''),'whumpo-cms-'||replace(NEW.project_id,'-','')||'-media');
END;

CREATE TRIGGER cms_instance_identity BEFORE UPDATE ON cms_instances WHEN NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.review_id<>OLD.review_id OR NEW.worker_name<>OLD.worker_name OR NEW.database_name<>OLD.database_name OR NEW.bucket_name<>OLD.bucket_name OR NEW.created_at<>OLD.created_at OR (OLD.database_id IS NOT NULL AND NEW.database_id IS NOT OLD.database_id) OR (OLD.session_namespace_id IS NOT NULL AND NEW.session_namespace_id IS NOT OLD.session_namespace_id)
 BEGIN SELECT RAISE(ABORT,'cms_instance_immutable'); END;

CREATE TRIGGER cms_resource_job_insert BEFORE INSERT ON cms_resource_jobs WHEN NEW.state<>'pending' OR NOT EXISTS(
 SELECT 1 FROM cms_instances c JOIN cms_setup_reviews r ON r.id=c.review_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND r.status='approved' AND p.owner_user_id=c.user_id AND c.state<>'ready' AND NEW.resource_name=CASE NEW.kind WHEN 'database' THEN c.database_name WHEN 'media' THEN c.bucket_name WHEN 'session' THEN c.worker_name||'-session' END
) BEGIN SELECT RAISE(ABORT,'cms_resource_not_approved'); END;

CREATE TRIGGER cms_resource_job_immutable BEFORE UPDATE ON cms_resource_jobs WHEN NEW.project_id<>OLD.project_id OR NEW.kind<>OLD.kind OR NEW.account_id<>OLD.account_id OR NEW.resource_name<>OLD.resource_name OR NEW.created_at<>OLD.created_at OR OLD.state<>'pending' OR NEW.state<>'complete'
 BEGIN SELECT RAISE(ABORT,'cms_resource_immutable'); END;

CREATE TRIGGER cms_resource_record AFTER UPDATE OF state ON cms_resource_jobs WHEN NEW.state='complete' BEGIN
 UPDATE cms_instances SET database_id=CASE WHEN NEW.kind='database' THEN NEW.provider_id ELSE database_id END,session_namespace_id=CASE WHEN NEW.kind='session' THEN NEW.provider_id ELSE session_namespace_id END WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER cms_deployment_identity BEFORE UPDATE ON cms_deployments WHEN NEW.project_id<>OLD.project_id OR NEW.account_id<>OLD.account_id OR NEW.source_digest<>OLD.source_digest OR NEW.secret_digest<>OLD.secret_digest OR NEW.origin<>OLD.origin OR NEW.tag<>OLD.tag OR NEW.created_at<>OLD.created_at OR (OLD.worker_version_id IS NOT NULL AND NEW.worker_version_id IS NOT OLD.worker_version_id) OR NOT ((OLD.state='reserved' AND NEW.state='uploaded') OR (OLD.state='uploaded' AND NEW.state='verified') OR (OLD.state='verified' AND NEW.state='connected'))
 BEGIN SELECT RAISE(ABORT,'cms_deployment_immutable'); END;

CREATE TRIGGER cms_deployment_connected AFTER UPDATE OF state ON cms_deployments WHEN NEW.state='connected' BEGIN
 UPDATE cms_instances SET state='ready',deployed_version_id=NEW.worker_version_id WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER cms_ready_guard BEFORE UPDATE OF state ON cms_instances WHEN NEW.state='ready' AND NOT EXISTS(SELECT 1 FROM cms_deployments d WHERE d.project_id=NEW.project_id AND d.state='connected' AND d.worker_version_id=NEW.deployed_version_id)
 BEGIN SELECT RAISE(ABORT,'cms_readiness_not_verified'); END;

CREATE TRIGGER cms_draft_admission BEFORE INSERT ON cms_draft_requests WHEN NEW.item_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready') OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=NEW.project_id)>=90 OR (SELECT count(*) FROM cms_draft_requests)>=450
 BEGIN SELECT RAISE(ABORT,'cms_draft_not_available'); END;

CREATE TRIGGER cms_draft_immutable BEFORE UPDATE ON cms_draft_requests WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.collection<>OLD.collection OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at OR OLD.item_id IS NOT NULL OR NEW.item_id IS NULL
 BEGIN SELECT RAISE(ABORT,'cms_draft_immutable'); END;

CREATE TRIGGER cms_edit_admission BEFORE INSERT ON cms_edit_requests WHEN NEW.result IS NOT NULL OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN cms_instances c ON c.project_id=d.project_id JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.draft_request_id AND d.item_id IS NOT NULL AND c.state='ready' AND p.owner_user_id=d.user_id) OR (SELECT count(*) FROM cms_draft_requests)+(SELECT count(*) FROM cms_edit_requests)>=450 OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=(SELECT project_id FROM cms_draft_requests WHERE id=NEW.draft_request_id))+(SELECT count(*) FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id WHERE d.project_id=(SELECT project_id FROM cms_draft_requests WHERE id=NEW.draft_request_id))>=90
 BEGIN SELECT RAISE(ABORT,'cms_edit_not_available'); END;

CREATE TRIGGER cms_edit_immutable BEFORE UPDATE ON cms_edit_requests WHEN NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.body<>OLD.body OR NEW.created_at<>OLD.created_at OR OLD.result IS NOT NULL OR NEW.result IS NULL
 BEGIN SELECT RAISE(ABORT,'cms_edit_immutable'); END;

CREATE TRIGGER cms_draft_edit_capacity BEFORE INSERT ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR (SELECT count(*) FROM cms_draft_requests)+(SELECT count(*) FROM cms_edit_requests)>=450 OR (SELECT count(*) FROM cms_draft_requests WHERE project_id=NEW.project_id)+(SELECT count(*) FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id WHERE d.project_id=NEW.project_id)>=90
 BEGIN SELECT RAISE(ABORT,'cms_content_capacity'); END;

CREATE TRIGGER cms_preview_admission BEFORE INSERT ON cms_preview_links WHEN NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id WHERE d.id=NEW.draft_request_id AND d.project_id=NEW.project_id AND d.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND d.item_id IS NOT NULL) OR (SELECT count(*) FROM cms_preview_links WHERE user_id=NEW.user_id)>=100 OR (SELECT count(*) FROM cms_preview_links)>=1000
 BEGIN SELECT RAISE(ABORT,'cms_preview_not_available'); END;

CREATE TRIGGER cms_preview_immutable BEFORE UPDATE ON cms_preview_links BEGIN SELECT RAISE(ABORT,'cms_preview_immutable'); END;

CREATE TRIGGER cms_publication_admission BEFORE INSERT ON cms_publication_reviews WHEN NEW.status<>'pending' OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id JOIN cms_instances c ON c.project_id=d.project_id WHERE d.id=NEW.draft_request_id AND d.user_id=NEW.user_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.collection=NEW.collection AND d.item_id=NEW.item_id AND c.state='ready') OR (((SELECT count(*) FROM cms_publication_reviews t WHERE t.project_id=NEW.project_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=25
  OR (SELECT count(*) FROM cms_publication_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=100
  OR (SELECT count(*) FROM cms_publication_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=5000
  OR ((SELECT count(*) FROM cms_publication_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=2500 AND (SELECT count(*) FROM cms_publication_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=25)))
 BEGIN SELECT RAISE(ABORT,'cms_publication_not_available'); END;

CREATE TRIGGER cms_unpublish_admission BEFORE INSERT ON cms_unpublish_reviews WHEN NEW.status<>'pending' OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR NOT EXISTS(SELECT 1 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.publication_id AND r.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND r.status='published' AND r.withdrawn=0)
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_not_available'); END;

CREATE TRIGGER cms_unpublish_immutable BEFORE UPDATE ON cms_unpublish_reviews WHEN NEW.id<>OLD.id OR NEW.publication_id<>OLD.publication_id OR NEW.user_id<>OLD.user_id OR NEW.revision<>OLD.revision OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM cms_publication_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=NEW.publication_id AND r.withdrawn=0 AND r.status='published' AND p.owner_user_id=NEW.user_id)) OR (OLD.status='approved' AND NEW.status='complete'))
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_immutable_or_expired'); END;

CREATE TRIGGER cms_unpublish_hide AFTER UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' BEGIN
 UPDATE cms_publication_reviews SET withdrawn=1 WHERE id=NEW.publication_id;
END;

CREATE TRIGGER cms_publication_unpublish_guard BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status IN ('approved','published') AND EXISTS(SELECT 1 FROM cms_unpublish_reviews u JOIN cms_publication_reviews r ON r.id=u.publication_id WHERE r.project_id=NEW.project_id AND r.collection=NEW.collection AND r.item_id=NEW.item_id AND u.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_unpublish_pending'); END;

CREATE TRIGGER cms_publication_withdrawn_insert BEFORE INSERT ON cms_publication_reviews WHEN NEW.withdrawn<>0 BEGIN SELECT RAISE(ABORT,'cms_publication_invalid_state'); END;

CREATE TRIGGER cms_publication_immutable BEFORE UPDATE ON cms_publication_reviews WHEN NEW.replaces_publication_id IS NOT OLD.replaces_publication_id OR NEW.id<>OLD.id OR NEW.draft_request_id<>OLD.draft_request_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.collection<>OLD.collection OR NEW.item_id<>OLD.item_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.preview_html<>OLD.preview_html OR NEW.public_html<>OLD.public_html OR NEW.digest<>OLD.digest OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.withdrawn=0 AND NEW.withdrawn=0 AND ((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='published'))) OR (OLD.status='published' AND NEW.status='published' AND OLD.withdrawn=0 AND NEW.withdrawn=1 AND (EXISTS(SELECT 1 FROM cms_unpublish_reviews u WHERE u.publication_id=OLD.id AND u.status='approved') OR EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=OLD.id AND replacement.status='approved'))))
 BEGIN SELECT RAISE(ABORT,'cms_publication_immutable_or_expired'); END;

CREATE TRIGGER cms_replacement_admission BEFORE INSERT ON cms_publication_reviews WHEN NEW.replaces_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.project_id=NEW.project_id AND base.collection=NEW.collection AND base.item_id=NEW.item_id AND base.user_id=NEW.user_id AND base.status='published' AND base.withdrawn=0)
 BEGIN SELECT RAISE(ABORT,'cms_replacement_base_unavailable'); END;

CREATE TRIGGER cms_replacement_current BEFORE UPDATE OF status ON cms_publication_reviews WHEN OLD.status='pending' AND NEW.status='approved' AND (
 (NEW.replaces_publication_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.status='published' AND base.withdrawn=0)) OR
 (NEW.replaces_publication_id IS NULL AND EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.project_id=NEW.project_id AND base.collection=NEW.collection AND base.item_id=NEW.item_id AND base.status='published' AND base.withdrawn=0))
 ) BEGIN SELECT RAISE(ABORT,'cms_publication_base_changed'); END;

CREATE TRIGGER cms_replacement_swap BEFORE UPDATE OF status ON cms_publication_reviews WHEN OLD.status='approved' AND NEW.status='published' AND NEW.replaces_publication_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'cms_publication_base_changed') WHERE NOT EXISTS(SELECT 1 FROM cms_publication_reviews base WHERE base.id=NEW.replaces_publication_id AND base.status='published' AND base.withdrawn=0);
 UPDATE cms_publication_reviews SET withdrawn=1 WHERE id=NEW.replaces_publication_id AND withdrawn=0;
END;

CREATE TRIGGER cms_unpublish_replacement_guard BEFORE UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=NEW.publication_id AND replacement.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_replacement_pending'); END;

CREATE TRIGGER cms_discard_admission BEFORE INSERT ON cms_discard_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_publication_reviews p JOIN projects project ON project.id=p.project_id WHERE p.id=NEW.publication_id AND p.user_id=NEW.user_id AND project.owner_user_id=NEW.user_id AND p.status='published' AND p.withdrawn=0) OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR (((SELECT count(*) FROM cms_discard_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=100
  OR (SELECT count(*) FROM cms_discard_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=5000
  OR ((SELECT count(*) FROM cms_discard_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=2500 AND (SELECT count(*) FROM cms_discard_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=25)))
 BEGIN SELECT RAISE(ABORT,'cms_discard_unavailable'); END;

CREATE TRIGGER cms_discard_immutable BEFORE UPDATE ON cms_discard_reviews WHEN NEW.id<>OLD.id OR NEW.publication_id<>OLD.publication_id OR NEW.user_id<>OLD.user_id OR NEW.revision<>OLD.revision OR NEW.snapshot<>OLD.snapshot OR NEW.expires_at<>OLD.expires_at OR NEW.created_at<>OLD.created_at OR NOT((OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM cms_publication_reviews p JOIN projects project ON project.id=p.project_id WHERE p.id=NEW.publication_id AND project.owner_user_id=NEW.user_id AND p.status='published' AND p.withdrawn=0)) OR (OLD.status='approved' AND NEW.status='complete'))
 BEGIN SELECT RAISE(ABORT,'cms_discard_immutable_or_expired'); END;

CREATE TRIGGER cms_discard_publication_guard BEFORE UPDATE OF status ON cms_discard_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_publication_reviews replacement WHERE replacement.replaces_publication_id=NEW.publication_id AND replacement.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_replacement_pending'); END;

CREATE TRIGGER cms_publication_discard_guard BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_discard_reviews d WHERE d.publication_id=NEW.replaces_publication_id AND d.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_discard_pending'); END;

CREATE TRIGGER cms_unpublish_discard_guard BEFORE UPDATE OF status ON cms_unpublish_reviews WHEN NEW.status='approved' AND EXISTS(SELECT 1 FROM cms_discard_reviews d WHERE d.publication_id=NEW.publication_id AND d.status='approved')
 BEGIN SELECT RAISE(ABORT,'cms_discard_pending'); END;

CREATE TRIGGER backend_publication_review_admit BEFORE INSERT ON backend_publication_reviews BEGIN
 SELECT RAISE(ABORT,'backend_publication_owner') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN backend_versions v ON v.project_id=p.id JOIN backend_publications b ON b.project_id=p.id
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND v.id=NEW.version_id AND b.revision=NEW.base_revision
  AND (NEW.operation='publish' OR b.version_id=NEW.version_id)
 );
 SELECT RAISE(ABORT,'backend_publication_test') WHERE NEW.operation='publish' AND NOT EXISTS(
  SELECT 1 FROM backend_runs r WHERE r.id=NEW.run_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id
  AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1
 );
 SELECT RAISE(ABORT,'backend_publication_capacity') WHERE NOT (NEW.operation='unpublish') AND ((SELECT count(*) FROM backend_publication_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.operation='unpublish'))>=25
  OR (SELECT count(*) FROM backend_publication_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.operation='unpublish'))>=100
  OR (SELECT count(*) FROM backend_publication_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.operation='unpublish'))>=5000
  OR ((SELECT count(*) FROM backend_publication_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.operation='unpublish'))>=2500 AND (SELECT count(*) FROM backend_publication_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.operation='unpublish'))>=25));
 SELECT RAISE(ABORT,'backend_publication_initial') WHERE NEW.status<>'pending';
END;

CREATE TRIGGER backend_publication_review_immutable BEFORE UPDATE ON backend_publication_reviews WHEN
 NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.operation<>OLD.operation OR NEW.version_id<>OLD.version_id OR NEW.run_id IS NOT OLD.run_id OR NEW.base_revision<>OLD.base_revision OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'backend_publication_immutable'); END;

CREATE TRIGGER backend_publication_apply BEFORE UPDATE OF status ON backend_publication_reviews BEGIN
 SELECT RAISE(ABORT,'backend_publication_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM backend_publications b JOIN projects p ON p.id=b.project_id WHERE b.project_id=NEW.project_id AND b.revision=NEW.base_revision AND p.owner_user_id=NEW.user_id);
 UPDATE backend_publications SET revision=revision+1,review_id=NEW.id,version_id=NEW.version_id WHERE project_id=NEW.project_id AND NEW.operation='publish';
 UPDATE backend_publications SET revision=revision+1,review_id=NULL,version_id=NULL WHERE project_id=NEW.project_id AND NEW.operation='unpublish';
END;

CREATE TRIGGER backend_public_usage_insert BEFORE INSERT ON backend_public_usage BEGIN
 SELECT RAISE(ABORT,'backend_public_unavailable') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR NOT EXISTS(SELECT 1 FROM backend_publications b JOIN backend_publication_reviews r ON r.id=b.review_id AND r.status='applied' JOIN projects p ON p.id=b.project_id AND p.owner_user_id=r.user_id WHERE b.project_id=NEW.project_id AND b.review_id=NEW.publication_id AND b.version_id IS NOT NULL);
 -- The project allowance is 100 unless an active operator containment freezes it (0) or sets a temporary allowance.
 SELECT RAISE(ABORT,'backend_public_quota') WHERE
 coalesce((SELECT calls FROM backend_public_usage WHERE project_id=NEW.project_id AND day=NEW.day),0)>=coalesce((SELECT coalesce(allowance,0) FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='backend' ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1),100) OR
 coalesce((SELECT sum(u.calls) FROM backend_public_usage u JOIN projects p ON p.id=u.project_id WHERE u.day=NEW.day AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id)),0)>=500 OR
 coalesce((SELECT sum(calls) FROM backend_public_usage WHERE day=NEW.day),0)>=1000 OR
 -- Fair share: once half the platform pool is used, only accounts under 100 calls today are admitted.
 (coalesce((SELECT sum(calls) FROM backend_public_usage WHERE day=NEW.day),0)>=500 AND
  coalesce((SELECT sum(u.calls) FROM backend_public_usage u JOIN projects p ON p.id=u.project_id WHERE u.day=NEW.day AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id)),0)>=100);
END;

-- Increment by reservation, or refund exactly one call of the same day after the runtime reported busy/unavailable.
CREATE TRIGGER backend_public_usage_update BEFORE UPDATE ON backend_public_usage BEGIN
 SELECT RAISE(ABORT,'backend_public_counter') WHERE NEW.project_id<>OLD.project_id OR NOT (
  (NEW.day=strftime('%Y-%m-%d','now') AND NEW.calls=OLD.calls*(NEW.day=OLD.day)+1) OR
  (NEW.day=OLD.day AND NEW.calls=OLD.calls-1 AND NEW.publication_id=OLD.publication_id));
END;

CREATE TRIGGER public_client_usage_insert BEFORE INSERT ON public_client_usage BEGIN
 SELECT RAISE(ABORT,'public_client_counter') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR NEW.uses<>1;
 SELECT RAISE(ABORT,'public_client_quota') WHERE coalesce((SELECT uses FROM public_client_usage WHERE scope=NEW.scope AND project_id=NEW.project_id AND client_key=NEW.client_key AND day=NEW.day),0)>=CASE NEW.scope WHEN 'backend' THEN 20 WHEN 'contact' THEN 10 ELSE 400 END;
END;

CREATE TRIGGER public_client_usage_update BEFORE UPDATE ON public_client_usage BEGIN
 SELECT RAISE(ABORT,'public_client_counter') WHERE NEW.scope<>OLD.scope OR NEW.project_id<>OLD.project_id OR NEW.client_key<>OLD.client_key OR NEW.day<>OLD.day OR NEW.uses<>OLD.uses+1;
END;

CREATE TRIGGER storage_project_usage_insert BEFORE INSERT ON storage_project_usage BEGIN
 SELECT RAISE(ABORT,'storage_project_counter') WHERE NEW.period<>strftime('%Y-%m','now') OR NEW.read_ops<>1;
 SELECT RAISE(ABORT,'storage_project_quota') WHERE
 coalesce((SELECT read_ops FROM storage_project_usage WHERE project_id=NEW.project_id AND period=NEW.period),0)>=coalesce((SELECT coalesce(allowance,0) FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='photo' ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1),10000) OR
 -- Fair share: once half the platform read ceiling is used, only accounts under 10,000 reads this month are admitted.
 (coalesce((SELECT read_ops FROM storage_usage WHERE period=NEW.period),0)>=50000 AND
  coalesce((SELECT sum(u.read_ops) FROM storage_project_usage u JOIN projects p ON p.id=u.project_id WHERE u.period=NEW.period AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id)),0)>=10000);
END;

CREATE TRIGGER storage_project_usage_update BEFORE UPDATE ON storage_project_usage BEGIN
 SELECT RAISE(ABORT,'storage_project_counter') WHERE NEW.project_id<>OLD.project_id OR NEW.period<>OLD.period OR NEW.read_ops<>OLD.read_ops+1;
END;

-- A serving stop is its own action (never mixed with other scopes), and a project has at most one active serving stop.
CREATE TRIGGER operator_containment_admit BEFORE INSERT ON operator_containments BEGIN
 SELECT RAISE(ABORT,'operator_containment_invalid') WHERE NEW.resolved_at IS NOT NULL
  OR NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) OR abs(julianday(NEW.created_at)-julianday('now'))>1.0/1440
  OR NEW.expires_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at)
  OR NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days')
  OR (NEW.subject_kind='account' AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.subject_id))
  OR (NEW.subject_kind='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.subject_id))
  OR EXISTS(SELECT 1 FROM operator_containments WHERE id=NEW.id AND (subject_kind<>NEW.subject_kind OR subject_id<>NEW.subject_id OR request_digest<>NEW.request_digest OR expires_at<>NEW.expires_at
   OR (scope='serving')<>(NEW.scope='serving')))
  OR (NEW.scope='serving' AND EXISTS(SELECT 1 FROM operator_containments WHERE scope='serving' AND subject_id=NEW.subject_id AND id<>NEW.id AND resolved_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')));
 SELECT RAISE(ABORT,'operator_containment_capacity') WHERE (SELECT count(*) FROM operator_containments)>=10000;
END;

-- Only a single explicit resolution: 'lifted' while still active, 'closed' after expiry. Everything else is immutable.
CREATE TRIGGER operator_containment_resolve BEFORE UPDATE ON operator_containments
WHEN OLD.resolved_at IS NOT NULL OR NEW.resolved_at IS NULL OR NEW.id<>OLD.id OR NEW.scope<>OLD.scope OR NEW.subject_kind<>OLD.subject_kind OR NEW.subject_id<>OLD.subject_id
 OR NEW.allowance IS NOT OLD.allowance OR NEW.operator_ref<>OLD.operator_ref OR NEW.reason<>OLD.reason OR NEW.request_digest<>OLD.request_digest
 OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR NEW.resolved_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.resolved_at) OR abs(julianday(NEW.resolved_at)-julianday('now'))>1.0/1440
 OR (NEW.resolution='lifted' AND NEW.resolved_at>=OLD.expires_at) OR (NEW.resolution='closed' AND NEW.resolved_at<OLD.expires_at)
BEGIN SELECT RAISE(ABORT,'operator_containment_immutable'); END;

-- Retention (owner decision October 8, 2026): only a resolved row, at least 90 days after its resolution, outside any
-- unreleased safety hold on its subject, its owner or its projects. Active, expired-but-unresolved and held rows stay.
CREATE TRIGGER operator_containment_retained BEFORE DELETE ON operator_containments
WHEN OLD.resolved_at IS NULL OR OLD.resolved_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')
 OR EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL AND (h.subject_user_id=OLD.subject_id OR h.project_id=OLD.subject_id
  OR h.subject_user_id=(SELECT owner_user_id FROM projects WHERE id=OLD.subject_id)))
BEGIN SELECT RAISE(ABORT,'operator_containment_immutable'); END;

-- WH-074 build freeze: cancel the frozen scope's running and succeeded-but-unpublished jobs in the same write, exactly as
-- owner cancellation does. A test already sent is not recalled; cleanup is recorded by the deterministic reconciler.
CREATE TRIGGER operator_containment_build_cancel AFTER INSERT ON operator_containments WHEN NEW.scope='build'
BEGIN UPDATE build_jobs SET state='cancelled',finished_at=coalesce(finished_at,strftime('%Y-%m-%dT%H:%M:%fZ','now'))
 WHERE state IN ('running','succeeded') AND project_id IN (SELECT project_id FROM operator_contained_projects WHERE id=NEW.id AND scope='build'); END;

-- Session revocation applies only to the exact reviewed identity state: same epoch and credential revision, and the same
-- complete set of the account's session rows. Any sign-in, sign-out, passkey or recovery change in between is stale.
CREATE TRIGGER operator_session_revocation_admit BEFORE INSERT ON operator_session_revocations BEGIN
 SELECT RAISE(ABORT,'operator_revocation_invalid') WHERE NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) OR abs(julianday(NEW.created_at)-julianday('now'))>1.0/1440;
 SELECT RAISE(ABORT,'operator_revocation_stale') WHERE NOT EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=NEW.account_id AND auth_epoch=NEW.auth_epoch AND credential_revision=NEW.credential_revision)
  OR NEW.sessions IS NOT (SELECT json_group_array(id) FROM (SELECT id FROM identity_sessions WHERE account_id=NEW.account_id ORDER BY id));
 SELECT RAISE(ABORT,'operator_revocation_capacity') WHERE (SELECT count(*) FROM operator_session_revocations)>=10000;
END;
CREATE TRIGGER operator_session_revocation_apply AFTER INSERT ON operator_session_revocations
BEGIN DELETE FROM identity_sessions WHERE account_id=NEW.account_id AND id IN (SELECT value FROM json_each(NEW.sessions)); END;
CREATE TRIGGER operator_session_revocation_immutable BEFORE UPDATE ON operator_session_revocations BEGIN SELECT RAISE(ABORT,'operator_revocation_immutable'); END;
CREATE TRIGGER operator_session_revocation_retained BEFORE DELETE ON operator_session_revocations
WHEN OLD.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')
 OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND subject_user_id=OLD.account_id)
BEGIN SELECT RAISE(ABORT,'operator_revocation_immutable'); END;

-- A cleanup receipt names only records that still exist and were resolved (or completed) at or before a cutoff at least
-- 90 days old; it then deletes exactly those records in the same statement. Each record's own delete trigger still applies.
CREATE TRIGGER operator_retention_admit BEFORE INSERT ON operator_retention_receipts BEGIN
 SELECT RAISE(ABORT,'operator_retention_invalid') WHERE NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) OR abs(julianday(NEW.created_at)-julianday('now'))>1.0/1440
  OR NEW.cutoff IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.cutoff) OR NEW.cutoff>strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days');
 SELECT RAISE(ABORT,'operator_retention_stale') WHERE
  (SELECT count(*) FROM operator_containments WHERE id||':'||scope IN (SELECT value FROM json_each(NEW.containments)) AND resolved_at<=NEW.cutoff)<>json_array_length(NEW.containments)
  OR (SELECT count(*) FROM operator_session_revocations WHERE id IN (SELECT value FROM json_each(NEW.revocations)) AND created_at<=NEW.cutoff)<>json_array_length(NEW.revocations)
  OR (SELECT count(*) FROM operator_retention_receipts WHERE id IN (SELECT value FROM json_each(NEW.receipts)) AND created_at<=NEW.cutoff)<>json_array_length(NEW.receipts);
END;
-- Capacity is checked after the listed deletions, in the same statement: a full table can still record a cleanup that
-- removes at least as many old receipts as it adds, and a cleanup that would leave more than 10000 receipts aborts
-- whole (no receipt, nothing deleted).
CREATE TRIGGER operator_retention_apply AFTER INSERT ON operator_retention_receipts BEGIN
 DELETE FROM operator_containments WHERE id||':'||scope IN (SELECT value FROM json_each(NEW.containments));
 DELETE FROM operator_session_revocations WHERE id IN (SELECT value FROM json_each(NEW.revocations));
 DELETE FROM operator_retention_receipts WHERE id IN (SELECT value FROM json_each(NEW.receipts));
 SELECT RAISE(ABORT,'operator_retention_capacity') WHERE (SELECT count(*) FROM operator_retention_receipts)>10000;
END;
CREATE TRIGGER operator_retention_immutable BEFORE UPDATE ON operator_retention_receipts BEGIN SELECT RAISE(ABORT,'operator_retention_immutable'); END;
CREATE TRIGGER operator_retention_retained BEFORE DELETE ON operator_retention_receipts
WHEN OLD.created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')
BEGIN SELECT RAISE(ABORT,'operator_retention_immutable'); END;

CREATE TRIGGER backend_form_admit BEFORE INSERT ON backend_form_reviews BEGIN
 SELECT RAISE(ABORT,'backend_form_owner') WHERE NOT EXISTS(SELECT 1 FROM projects p JOIN backend_form_settings s ON s.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.base_revision);
 SELECT RAISE(ABORT,'backend_form_targets') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM publications s JOIN backend_publications b ON b.project_id=s.project_id JOIN backend_publication_reviews r ON r.id=b.review_id WHERE s.project_id=NEW.project_id AND s.version_id IS NOT NULL AND s.revision=NEW.site_revision AND b.review_id=NEW.backend_publication_id AND r.user_id=NEW.user_id AND r.status='applied');
 SELECT RAISE(ABORT,'backend_form_capacity') WHERE NOT (NEW.enabled=0) AND ((SELECT count(*) FROM backend_form_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=25
  OR (SELECT count(*) FROM backend_form_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=100
  OR (SELECT count(*) FROM backend_form_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=5000
  OR ((SELECT count(*) FROM backend_form_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=2500 AND (SELECT count(*) FROM backend_form_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=25));
 SELECT RAISE(ABORT,'backend_form_initial') WHERE NEW.status<>'pending';
END;

CREATE TRIGGER backend_form_review_retained BEFORE DELETE ON backend_form_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'backend_form_retained') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (OLD.enabled=0 AND NOT (OLD.status='applied') AND EXISTS(SELECT 1 FROM backend_form_reviews x WHERE x.expires_at>OLD.expires_at AND x.enabled=0 AND x.project_id=OLD.project_id)))
  OR (EXISTS(SELECT 1 FROM backend_form_settings WHERE review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM site_health_checks WHERE form_review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM service_client_activation_reviews WHERE id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR (OLD.enabled=0) OR OLD.id NOT IN (SELECT t.id FROM backend_form_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' AND NOT (t.enabled=0) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='backend_form_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER backend_form_immutable BEFORE UPDATE ON backend_form_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.enabled<>OLD.enabled OR NEW.config_json IS NOT OLD.config_json OR NEW.site_revision<>OLD.site_revision OR NEW.backend_publication_id IS NOT OLD.backend_publication_id OR NEW.base_revision<>OLD.base_revision OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'backend_form_immutable'); END;

CREATE TRIGGER health_form_snapshot BEFORE INSERT ON site_health_checks WHEN NEW.form_review_id IS NOT (SELECT id FROM backend_live_forms WHERE project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'health_publication_changed'); END;

CREATE TRIGGER health_form_immutable BEFORE UPDATE ON site_health_checks WHEN NEW.form_review_id IS NOT OLD.form_review_id
 BEGIN SELECT RAISE(ABORT,'health_form_immutable'); END;

-- The application consumes the project's access instance; that dependency and the resource id never change.
CREATE TRIGGER app_space_owner BEFORE INSERT ON app_spaces WHEN NOT EXISTS(SELECT 1 FROM projects p JOIN backend_versions v ON v.project_id=p.id JOIN module_instances i ON i.project_id=p.id AND i.kind='access' WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.owner_user_id AND v.id=NEW.version_id AND i.id=NEW.access_id)
 BEGIN SELECT RAISE(ABORT,'app_space_owner'); END;

CREATE TRIGGER app_space_update BEFORE UPDATE ON app_spaces WHEN NEW.project_id<>OLD.project_id OR NEW.owner_user_id<>OLD.owner_user_id OR NEW.access_id<>OLD.access_id OR NEW.resource_id<>OLD.resource_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.version_id AND project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'app_space_identity'); END;

-- WH-126: enrollment needs the project's active access instance, not a visitor application.
CREATE TRIGGER app_visitor_admit BEFORE INSERT ON app_visitors BEGIN
 SELECT RAISE(ABORT,'app_unavailable') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.id=NEW.access_id AND i.project_id=NEW.project_id AND i.kind='access' AND ac.state='active');
 SELECT RAISE(ABORT,'app_visitor_capacity') WHERE (SELECT count(*) FROM app_visitors WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_visitors)>=1000;
END;

CREATE TRIGGER app_visitor_identity BEFORE UPDATE ON app_visitors WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.access_id<>OLD.access_id OR NEW.created_at<>OLD.created_at OR OLD.revoked=1 AND NEW.revoked<>1
 BEGIN SELECT RAISE(ABORT,'app_visitor_identity'); END;

CREATE TRIGGER app_session_admit BEFORE INSERT ON app_sessions BEGIN
 SELECT RAISE(ABORT,'app_session_identity') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN module_activations ac ON ac.instance_id=v.access_id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=v.project_id AND p.owner_user_id=ar.user_id WHERE v.id=NEW.visitor_id AND v.revoked=0 AND ac.state='active');
 SELECT RAISE(ABORT,'app_session_capacity') WHERE (SELECT count(*) FROM app_sessions WHERE visitor_id=NEW.visitor_id)>=5 OR (SELECT count(*) FROM app_sessions)>=5000;
END;

CREATE TRIGGER app_session_immutable BEFORE UPDATE ON app_sessions BEGIN SELECT RAISE(ABORT,'app_session_immutable'); END;

CREATE TRIGGER app_document_revision BEFORE UPDATE ON app_documents WHEN NEW.visitor_id<>OLD.visitor_id OR NEW.revision<>OLD.revision+1 BEGIN SELECT RAISE(ABORT,'app_document_revision'); END;

CREATE TRIGGER app_visitor_document AFTER INSERT ON app_visitors BEGIN INSERT INTO app_documents(visitor_id) VALUES(NEW.id); END;

CREATE TRIGGER app_run_immutable BEFORE UPDATE ON app_runs WHEN NEW.id<>OLD.id OR NEW.visitor_id<>OLD.visitor_id OR NEW.project_id<>OLD.project_id OR NEW.version_id<>OLD.version_id OR NEW.session_hash<>OLD.session_hash OR NEW.request_hash<>OLD.request_hash OR NEW.base_revision<>OLD.base_revision OR NEW.program_revision<>OLD.program_revision OR NEW.page_review_id<>OLD.page_review_id OR NEW.day<>OLD.day OR OLD.state<>'running' OR NEW.state='running'
 BEGIN SELECT RAISE(ABORT,'app_run_immutable'); END;

CREATE TRIGGER app_run_apply BEFORE UPDATE OF state ON app_runs WHEN NEW.state='complete' BEGIN
 SELECT RAISE(ABORT,'app_state_changed') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN module_activations ac ON ac.instance_id=v.access_id AND ac.state='active' JOIN app_spaces a ON a.project_id=v.project_id AND a.access_id=v.access_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE NEW.page_review_id IS (SELECT id FROM app_live_pages WHERE project_id=a.project_id) AND v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=0 AND a.enabled=1 AND a.version_id=NEW.version_id AND a.revision=NEW.program_revision AND d.revision=NEW.base_revision AND s.token_hash=NEW.session_hash AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 UPDATE app_documents SET state_json=NEW.next_json,revision=revision+1 WHERE visitor_id=NEW.visitor_id;
END;

CREATE TRIGGER app_activation_admit BEFORE INSERT ON app_activation_reviews BEGIN
 SELECT RAISE(ABORT,'app_activation_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN backend_versions v ON v.project_id=p.id WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND a.revision=NEW.base_revision AND v.id=NEW.version_id);
 SELECT RAISE(ABORT,'app_activation_test') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM backend_runs r WHERE r.id=NEW.run_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.version_id AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1 AND json_type(r.result_json,'$.value')='object' AND (SELECT count(*) FROM json_each(r.result_json,'$.value'))=2 AND json_type(r.result_json,'$.value.state') IS NOT NULL AND json_type(r.result_json,'$.value.result') IS NOT NULL AND length(CAST(json_quote(json_extract(r.result_json,'$.value.state')) AS BLOB))<=4096 AND length(CAST(json_quote(json_extract(r.result_json,'$.value.result')) AS BLOB))<=4096);
 SELECT RAISE(ABORT,'app_activation_capacity') WHERE NOT (NEW.enabled=0) AND ((SELECT count(*) FROM app_activation_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=25
  OR (SELECT count(*) FROM app_activation_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=100
  OR (SELECT count(*) FROM app_activation_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=5000
  OR ((SELECT count(*) FROM app_activation_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=2500 AND (SELECT count(*) FROM app_activation_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.enabled=0))>=25));
 SELECT RAISE(ABORT,'app_activation_initial') WHERE NEW.status<>'pending';
END;

CREATE TRIGGER app_activation_immutable BEFORE UPDATE ON app_activation_reviews WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.version_id<>OLD.version_id OR NEW.run_id IS NOT OLD.run_id OR NEW.enabled<>OLD.enabled OR NEW.base_revision<>OLD.base_revision OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'app_activation_immutable'); END;

CREATE TRIGGER app_space_initial_review BEFORE INSERT ON app_spaces WHEN NEW.enabled<>0 OR NEW.review_id IS NOT NULL OR NEW.revision<>0
 BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;

CREATE TRIGGER app_activation_apply BEFORE UPDATE OF status ON app_activation_reviews BEGIN
 SELECT RAISE(ABORT,'app_activation_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.base_revision);
 -- A program has touched visitor documents only once the application was authorized (revision>0); before that the
 -- access instance's visitors hold untouched empty documents, so choosing the first program needs no migration.
 SELECT RAISE(ABORT,'app_migration_required') WHERE NEW.enabled=1 AND EXISTS(SELECT 1 FROM app_spaces a JOIN app_visitors v ON v.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.revision>0 AND a.version_id<>NEW.version_id);
 SELECT RAISE(ABORT,'app_disable_version') WHERE NEW.enabled=0 AND NOT EXISTS(SELECT 1 FROM app_spaces WHERE project_id=NEW.project_id AND version_id=NEW.version_id);
 -- WH-126: the application serves only the identities of its active access instance.
 SELECT RAISE(ABORT,'app_access_required') WHERE NEW.enabled=1 AND NOT EXISTS(SELECT 1 FROM app_spaces a JOIN module_activations ac ON ac.instance_id=a.access_id WHERE a.project_id=NEW.project_id AND ac.state='active');
 UPDATE app_spaces SET enabled=NEW.enabled,version_id=NEW.version_id,revision=revision+1,review_id=NEW.id WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER app_activation_delete_guard BEFORE DELETE ON app_activation_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'app_activation_immutable') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (OLD.enabled=0 AND NOT (OLD.status='applied') AND EXISTS(SELECT 1 FROM app_activation_reviews x WHERE x.expires_at>OLD.expires_at AND x.enabled=0 AND x.project_id=OLD.project_id)))
  OR (EXISTS(SELECT 1 FROM app_spaces WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR (OLD.enabled=0) OR OLD.id NOT IN (SELECT t.id FROM app_activation_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' AND NOT (t.enabled=0) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='app_activation_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER plan_catalog_immutable BEFORE UPDATE ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;

CREATE TRIGGER inference_reserved AFTER INSERT ON inference_calls BEGIN
 UPDATE inference_budgets SET reserved_micros=reserved_micros+NEW.reserved_micros WHERE user_id=NEW.user_id AND period=NEW.period;
END;

CREATE TRIGGER inference_immutable BEFORE UPDATE ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_immutable') WHERE NEW.id!=OLD.id OR NEW.turn_id!=OLD.turn_id OR NEW.user_id!=OLD.user_id OR NEW.period!=OLD.period OR NEW.role!=OLD.role OR NEW.model!=OLD.model OR NEW.provider_origin!=OLD.provider_origin OR NEW.protocol!=OLD.protocol OR NEW.policy!=OLD.policy OR NEW.cost_basis!=OLD.cost_basis OR NEW.rate_id!=OLD.rate_id OR NEW.input_rate!=OLD.input_rate OR NEW.output_rate!=OLD.output_rate OR NEW.reserved_micros!=OLD.reserved_micros OR NEW.created_at!=OLD.created_at;
 SELECT RAISE(ABORT,'inference_transition') WHERE NOT (
  (OLD.status='reserved' AND NEW.status IN ('dispatched','released')) OR
  (OLD.status IN ('dispatched','uncertain') AND NEW.status='observed') OR
  (OLD.status='dispatched' AND NEW.status='uncertain'));
 SELECT RAISE(ABORT,'inference_cost_mismatch') WHERE NEW.status='observed' AND (NEW.estimated_micros>OLD.reserved_micros OR NEW.estimated_micros!=CAST((NEW.input_tokens*OLD.input_rate+NEW.output_tokens*OLD.output_rate+999999)/1000000 AS INTEGER));
END;

CREATE TRIGGER inference_finished AFTER UPDATE ON inference_calls WHEN NEW.status IN ('observed','released') BEGIN
 UPDATE inference_budgets SET reserved_micros=reserved_micros-OLD.reserved_micros,spent_micros=spent_micros+COALESCE(NEW.estimated_micros,0) WHERE user_id=NEW.user_id AND period=NEW.period;
END;

CREATE TRIGGER inference_delete_guard BEFORE DELETE ON inference_calls WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'inference_immutable'); END;

CREATE TRIGGER capacity_preferences_revision BEFORE UPDATE ON capacity_preferences
WHEN NEW.user_id != OLD.user_id OR NEW.revision != OLD.revision+1
BEGIN SELECT RAISE(ABORT,'capacity_revision'); END;

CREATE TRIGGER user_profiles_revision BEFORE UPDATE ON user_profiles
WHEN NEW.user_id!=OLD.user_id OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'profile_revision'); END;

-- Invitations and sign-in challenges bind the project's active access instance at its current activation revision.
CREATE TRIGGER app_invitation_admit BEFORE INSERT ON app_invitations BEGIN
 SELECT RAISE(ABORT,'app_invitation_authority') WHERE NEW.used_by IS NOT NULL OR NEW.revoked<>0 OR NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.id=NEW.access_id AND i.project_id=NEW.project_id AND i.kind='access' AND ac.state='active' AND ac.revision=NEW.activation_revision);
 SELECT RAISE(ABORT,'app_invitation_capacity') WHERE (SELECT count(*) FROM app_invitations WHERE project_id=NEW.project_id)>=100 OR (SELECT count(*) FROM app_invitations)>=1000;
END;

CREATE TRIGGER app_invitation_identity BEFORE UPDATE ON app_invitations WHEN NEW.code_hash<>OLD.code_hash OR NEW.project_id<>OLD.project_id OR NEW.access_id<>OLD.access_id OR NEW.activation_revision<>OLD.activation_revision OR NEW.expires_at<>OLD.expires_at OR OLD.revoked=1 AND NEW.revoked<>1 OR OLD.used_by IS NOT NULL AND NEW.used_by IS NOT OLD.used_by OR NEW.used_by IS NOT NULL AND NOT EXISTS(SELECT 1 FROM app_visitors WHERE id=NEW.used_by AND project_id=NEW.project_id AND access_id=NEW.access_id)
 BEGIN SELECT RAISE(ABORT,'app_invitation_identity'); END;

CREATE TRIGGER app_passkey_admit BEFORE INSERT ON app_passkeys BEGIN
 SELECT RAISE(ABORT,'app_passkey_authority') WHERE NOT EXISTS(SELECT 1 FROM app_visitors v JOIN module_activations ac ON ac.instance_id=v.access_id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=v.project_id AND p.owner_user_id=ar.user_id WHERE v.id=NEW.visitor_id AND v.revoked=0 AND ac.state='active');
 SELECT RAISE(ABORT,'app_passkey_capacity') WHERE (SELECT count(*) FROM app_passkeys WHERE visitor_id=NEW.visitor_id)>=5;
END;

CREATE TRIGGER app_passkey_identity BEFORE UPDATE ON app_passkeys WHEN NEW.id<>OLD.id OR NEW.visitor_id<>OLD.visitor_id OR NEW.public_key<>OLD.public_key OR NEW.counter<OLD.counter OR NEW.revision<>OLD.revision+1
 BEGIN SELECT RAISE(ABORT,'app_passkey_identity'); END;

CREATE TRIGGER app_challenge_admit BEFORE INSERT ON app_auth_challenges BEGIN
 SELECT RAISE(ABORT,'app_challenge_authority') WHERE NOT EXISTS(SELECT 1 FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.id=NEW.access_id AND i.project_id=NEW.project_id AND i.kind='access' AND ac.state='active' AND ac.revision=NEW.activation_revision);
 SELECT RAISE(ABORT,'app_challenge_client_capacity') WHERE (SELECT count(*) FROM app_auth_challenges WHERE project_id=NEW.project_id AND client_hash=NEW.client_hash AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=5;
 SELECT RAISE(ABORT,'app_challenge_capacity') WHERE (SELECT count(*) FROM app_auth_challenges WHERE project_id=NEW.project_id)>=50 OR (SELECT count(*) FROM app_auth_challenges)>=1000;
END;

CREATE TRIGGER app_challenge_immutable BEFORE UPDATE ON app_auth_challenges BEGIN SELECT RAISE(ABORT,'app_challenge_immutable'); END;

CREATE TRIGGER app_recovery_identity BEFORE UPDATE ON app_recovery_codes WHEN NEW.visitor_id<>OLD.visitor_id
 BEGIN SELECT RAISE(ABORT,'app_recovery_identity'); END;

CREATE TRIGGER app_visitor_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN
 DELETE FROM app_sessions WHERE visitor_id=NEW.id;
 DELETE FROM app_passkeys WHERE visitor_id=NEW.id;
 DELETE FROM app_recovery_codes WHERE visitor_id=NEW.id;
 DELETE FROM app_auth_challenges WHERE visitor_id=NEW.id;
END;

CREATE TRIGGER app_page_admit BEFORE INSERT ON app_page_reviews BEGIN
 SELECT RAISE(ABORT,'app_page_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_page_settings s ON s.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.program_revision AND s.revision=NEW.base_revision AND (NEW.config_json IS NULL OR a.enabled=1));
 SELECT RAISE(ABORT,'app_page_capacity') WHERE NOT (NEW.config_json IS NULL) AND ((SELECT count(*) FROM app_page_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.config_json IS NULL))>=25
  OR (SELECT count(*) FROM app_page_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.config_json IS NULL))>=100
  OR (SELECT count(*) FROM app_page_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.config_json IS NULL))>=5000
  OR ((SELECT count(*) FROM app_page_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.config_json IS NULL))>=2500 AND (SELECT count(*) FROM app_page_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT (t.config_json IS NULL))>=25));
 SELECT RAISE(ABORT,'app_page_initial') WHERE NEW.status<>'pending';
END;

CREATE TRIGGER app_page_immutable BEFORE UPDATE ON app_page_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.program_revision<>OLD.program_revision OR NEW.base_revision<>OLD.base_revision OR NEW.config_json IS NOT OLD.config_json OR NEW.expires_at<>OLD.expires_at OR OLD.status<>'pending' OR NEW.status<>'applied'
 BEGIN SELECT RAISE(ABORT,'app_page_immutable'); END;

CREATE TRIGGER app_page_apply AFTER UPDATE OF status ON app_page_reviews BEGIN
 SELECT RAISE(ABORT,'app_page_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_page_settings s ON s.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.revision=NEW.program_revision AND s.revision=NEW.base_revision AND (NEW.config_json IS NULL OR a.enabled=1));
 -- WH-126: visitor sign-in belongs to the access instance and survives page changes; in-flight document changes
 -- bind the page they were sent through (app_runs.page_review_id), so they fail instead.
 UPDATE app_page_settings SET revision=revision+1,review_id=NEW.id WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER app_page_settings_initial BEFORE INSERT ON app_page_settings WHEN NEW.revision<>0 OR NEW.review_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'app_page_initial'); END;

CREATE TRIGGER app_page_settings_guard BEFORE UPDATE ON app_page_settings WHEN NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM app_page_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.base_revision=OLD.revision AND r.status='applied')
 BEGIN SELECT RAISE(ABORT,'app_page_settings'); END;

CREATE TRIGGER app_run_admit BEFORE INSERT ON app_runs BEGIN
 SELECT RAISE(ABORT,'app_run_identity') WHERE NEW.state<>'running' OR NOT EXISTS(SELECT 1 FROM app_visitors v JOIN module_activations ac ON ac.instance_id=v.access_id AND ac.state='active' JOIN app_spaces a ON a.project_id=v.project_id AND a.access_id=v.access_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE NEW.page_review_id IS (SELECT id FROM app_live_pages WHERE project_id=a.project_id) AND v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=0 AND a.enabled=1 AND a.version_id=NEW.version_id AND a.revision=NEW.program_revision AND d.revision=NEW.base_revision AND s.token_hash=NEW.session_hash AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
 SELECT RAISE(ABORT,'app_run_quota') WHERE NEW.day<>strftime('%Y-%m-%d','now') OR (SELECT count(*) FROM app_runs)>=10000 OR (SELECT count(*) FROM app_runs WHERE visitor_id=NEW.visitor_id AND day=NEW.day)>=20 OR coalesce((SELECT attempts FROM app_daily_usage WHERE project_id=NEW.project_id AND day=NEW.day),0)>=coalesce((SELECT coalesce(allowance,0) FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='transition' ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1),100) OR coalesce((SELECT sum(attempts) FROM app_daily_usage WHERE day=NEW.day),0)>=1000
 -- Fair share: once half the platform pool is used, only accounts under 100 transitions today are admitted.
 OR (coalesce((SELECT sum(attempts) FROM app_daily_usage WHERE day=NEW.day),0)>=500 AND coalesce((SELECT sum(u.attempts) FROM app_daily_usage u JOIN projects p ON p.id=u.project_id WHERE u.day=NEW.day AND p.owner_user_id=(SELECT owner_user_id FROM projects WHERE id=NEW.project_id)),0)>=100);
END;

CREATE TRIGGER app_run_meter AFTER INSERT ON app_runs BEGIN
 INSERT INTO app_daily_usage(project_id,day,attempts) VALUES(NEW.project_id,NEW.day,1) ON CONFLICT(project_id,day) DO UPDATE SET attempts=attempts+1;
END;

-- A run the runtime refused (busy) or never answered (unavailable) returns its project allowance exactly once.
-- The run row and its per-visitor daily count remain, so attempts stay bounded per visitor.
CREATE TRIGGER app_run_refund AFTER UPDATE OF state ON app_runs WHEN OLD.state='running' AND NEW.state='failed' AND json_extract(NEW.result_json,'$.error') IN ('busy','unavailable') BEGIN
 UPDATE app_daily_usage SET attempts=attempts-1 WHERE project_id=NEW.project_id AND day=NEW.day AND attempts>0;
END;

CREATE TRIGGER app_deletion_receipt_immutable BEFORE UPDATE ON app_deletion_receipts BEGIN SELECT RAISE(ABORT,'app_deletion_receipt_immutable'); END;

CREATE TRIGGER app_deletion_receipt_capacity BEFORE INSERT ON app_deletion_receipts WHEN (SELECT count(*) FROM app_deletion_receipts)>=1000
 BEGIN SELECT RAISE(ABORT,'app_deletion_receipt_capacity'); END;

CREATE TRIGGER app_visitor_erase BEFORE DELETE ON app_visitors BEGIN
 DELETE FROM app_auth_challenges WHERE visitor_id=OLD.id;
 DELETE FROM app_invitations WHERE used_by=OLD.id;
 DELETE FROM app_passkeys WHERE visitor_id=OLD.id;
 DELETE FROM app_recovery_codes WHERE visitor_id=OLD.id;
 DELETE FROM app_sessions WHERE visitor_id=OLD.id;
 DELETE FROM app_runs WHERE visitor_id=OLD.id;
 DELETE FROM app_documents WHERE visitor_id=OLD.id;
END;

CREATE TRIGGER agent_inspection_immutable BEFORE UPDATE ON agent_inspections BEGIN SELECT RAISE(ABORT,'agent_inspection_immutable'); END;

CREATE TRIGGER cms_deployment_insert BEFORE INSERT ON cms_deployments WHEN NEW.state<>'reserved' OR NOT EXISTS(
 SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_setup_reviews r ON r.id=c.review_id WHERE c.project_id=NEW.project_id AND p.owner_user_id=c.user_id AND r.status='approved' AND c.state<>'ready' AND NEW.origin='https://'||c.worker_name||'.whumpo.site' AND (SELECT count(*) FROM cms_resource_jobs j WHERE j.project_id=c.project_id AND j.account_id=NEW.account_id AND j.state='complete')=3
) BEGIN SELECT RAISE(ABORT,'cms_deployment_not_approved'); END;

CREATE TRIGGER cloudflare_dns_routing_insert BEFORE INSERT ON cloudflare_dns_actions
WHEN (NEW.record_type='TXT' AND (NEW.connection_id IS NOT NULL OR NEW.proof_token IS NOT NULL)) OR
(NEW.record_type='CNAME' AND (NEW.content!='hosting.whumpo.site' OR NEW.record_name=NEW.zone_name OR NEW.connection_id IS NULL OR NEW.proof_token IS NULL OR NOT EXISTS(
 SELECT 1 FROM domain_connections c JOIN domain_claims d ON d.id=c.claim_id JOIN projects p ON p.id=c.project_id
 WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.claim_id=NEW.claim_id AND c.project_id=NEW.project_id AND d.project_id=c.project_id AND d.hostname=c.hostname AND c.hostname=NEW.record_name AND c.target=NEW.content AND c.zone_id='8d46ee4e394514402479acf16579f7b5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL AND d.token=NEW.proof_token AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))
BEGIN SELECT RAISE(ABORT,'cloudflare_dns_stale'); END;

CREATE TRIGGER cloudflare_dns_dispatch BEFORE UPDATE OF state ON cloudflare_dns_actions
WHEN OLD.state='review' AND NEW.state IN ('sending','unchanged')
BEGIN
 SELECT RAISE(ABORT,'cloudflare_dns_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(
 SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN cloudflare_token_vault t ON t.user_id=p.owner_user_id
 WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND t.id=NEW.token_id AND t.state='active' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (
 (NEW.record_type='TXT' AND '_whumpo.'||d.hostname=NEW.record_name AND 'whumpo-verification='||d.token=NEW.content)
 OR (NEW.record_type='CNAME' AND d.hostname=NEW.record_name AND d.token=NEW.proof_token AND NEW.content='hosting.whumpo.site' AND NEW.record_name!=NEW.zone_name AND EXISTS(
 SELECT 1 FROM domain_connections c WHERE c.id=NEW.connection_id AND c.user_id=NEW.user_id AND c.claim_id=d.id AND c.project_id=d.project_id AND c.hostname=d.hostname AND c.target=NEW.content AND c.zone_id='8d46ee4e394514402479acf16579f7b5' AND c.state IN ('provisioning','active') AND c.provider_id IS NOT NULL))));
END;

CREATE TRIGGER project_details_revision AFTER UPDATE OF name,purpose,audience,style_notes,preferred_theme ON projects
WHEN NEW.name<>OLD.name OR NEW.purpose<>OLD.purpose OR NEW.audience<>OLD.audience OR NEW.style_notes<>OLD.style_notes OR NEW.preferred_theme<>OLD.preferred_theme
BEGIN
 UPDATE projects SET details_revision=OLD.details_revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES(lower(hex(randomblob(16))),NEW.owner_user_id,NEW.id,'project.details.updated','Updated project details',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER cms_export_link_owner BEFORE INSERT ON cms_export_links
WHEN (SELECT COUNT(*) FROM cms_export_links)>=5000 OR (SELECT COUNT(*) FROM cms_export_links WHERE user_id=NEW.user_id)>=1000 OR NOT EXISTS(SELECT 1 FROM cms_draft_requests d JOIN projects p ON p.id=d.project_id JOIN chat_turns t ON t.id=NEW.turn_id WHERE d.id=NEW.draft_request_id AND d.project_id=NEW.project_id AND d.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND t.user_id=NEW.user_id AND t.status IN ('pending','completed'))
BEGIN SELECT RAISE(ABORT,'cms_export_owner'); END;

CREATE TRIGGER cms_export_link_immutable BEFORE UPDATE ON cms_export_links
BEGIN SELECT RAISE(ABORT,'cms_export_immutable'); END;

CREATE TRIGGER cms_draft_format_immutable BEFORE UPDATE OF content_format ON cms_draft_requests WHEN NEW.content_format<>OLD.content_format
 BEGIN SELECT RAISE(ABORT,'cms_draft_format_immutable'); END;

CREATE TRIGGER cms_edit_format_immutable BEFORE UPDATE OF content_format ON cms_edit_requests WHEN NEW.content_format<>OLD.content_format
 BEGIN SELECT RAISE(ABORT,'cms_edit_format_immutable'); END;

CREATE TRIGGER gateway_bucket_identity BEFORE UPDATE ON gateway_spend_buckets BEGIN
 SELECT RAISE(ABORT,'gateway_bucket_identity') WHERE NEW.id!=OLD.id OR NEW.scope!=OLD.scope OR NEW.user_id IS NOT OLD.user_id OR NEW.task_id IS NOT OLD.task_id OR NEW.terms_json!=OLD.terms_json;
 -- Approval caps cannot be raised by changing a balance. A new approval is required.
 SELECT RAISE(ABORT,'gateway_approval_immutable') WHERE OLD.scope='approval' AND NEW.limit_micros!=OLD.limit_micros;
END;

CREATE TRIGGER gateway_attempt_admit BEFORE INSERT ON gateway_spend_attempts BEGIN
 SELECT RAISE(ABORT,'gateway_initial_state') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'gateway_snapshot') WHERE json_extract(NEW.snapshot,'$.ownerId') IS NOT NEW.user_id OR json_extract(NEW.snapshot,'$.taskId') IS NOT NEW.task_id OR json_extract(NEW.snapshot,'$.providerReservationMicros') IS NOT NEW.provider_reserved OR json_extract(NEW.snapshot,'$.customerReservationMicros') IS NOT NEW.customer_reserved OR json_extract(NEW.snapshot,'$.role') NOT IN ('ack','orchestrator') OR json_extract(NEW.snapshot,'$.role') IS NULL;
 SELECT RAISE(ABORT,'gateway_rate_bounds') WHERE
 typeof(json_extract(NEW.snapshot,'$.inputBound'))!='integer' OR json_extract(NEW.snapshot,'$.inputBound') NOT BETWEEN 1 AND 10000000 OR
 typeof(json_extract(NEW.snapshot,'$.outputBound'))!='integer' OR json_extract(NEW.snapshot,'$.outputBound') NOT BETWEEN 1 AND 10000000 OR
 typeof(json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion'))!='integer' OR json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion'))!='integer' OR json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.extraMicrosPerCall'))!='integer' OR json_extract(NEW.snapshot,'$.extraMicrosPerCall') NOT BETWEEN 0 AND 1000000000 OR
 typeof(json_extract(NEW.snapshot,'$.rateValidUntil'))!='integer';
 SELECT RAISE(ABORT,'gateway_quote') WHERE NEW.provider_reserved!=CAST((json_extract(NEW.snapshot,'$.inputBound')*json_extract(NEW.snapshot,'$.rate.inputMicrosPerMillion')+json_extract(NEW.snapshot,'$.outputBound')*json_extract(NEW.snapshot,'$.rate.outputMicrosPerMillion')+999999)/1000000 AS INTEGER)+json_extract(NEW.snapshot,'$.extraMicrosPerCall');
 SELECT RAISE(ABORT,'gateway_retail_quote') WHERE json_extract(NEW.snapshot,'$.tier')='premium' AND (
 typeof(json_extract(NEW.snapshot,'$.retailMultiplierBps'))!='integer' OR json_extract(NEW.snapshot,'$.retailMultiplierBps') NOT BETWEEN 10000 AND 100000 OR
 NEW.customer_reserved!=CAST((NEW.provider_reserved*json_extract(NEW.snapshot,'$.retailMultiplierBps')+9999)/10000 AS INTEGER));
 SELECT RAISE(ABORT,'gateway_rate_expired') WHERE json_extract(NEW.snapshot,'$.rateValidUntil') IS NULL OR json_extract(NEW.snapshot,'$.rateValidUntil')<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER));
 SELECT RAISE(ABORT,'gateway_task_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.task_bucket AND scope='task' AND user_id=NEW.user_id AND task_id=NEW.task_id AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_account_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.account_bucket AND scope='account' AND user_id=NEW.user_id AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_platform_budget') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.platform_bucket AND scope='platform' AND limit_micros-held_micros-spent_micros>=NEW.provider_reserved);
 SELECT RAISE(ABORT,'gateway_tier') WHERE NOT (
  (json_extract(NEW.snapshot,'$.tier')='standard' AND NEW.customer_reserved=0 AND NEW.premium_bucket IS NULL AND NEW.approval_bucket IS NULL) OR
  (json_extract(NEW.snapshot,'$.tier')='premium' AND NEW.premium_bucket IS NOT NULL AND NEW.approval_bucket IS NOT NULL)
 ) OR json_extract(NEW.snapshot,'$.tier') IS NULL;
 SELECT RAISE(ABORT,'gateway_premium_balance') WHERE NEW.premium_bucket IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=NEW.premium_bucket AND scope='premium' AND user_id=NEW.user_id AND limit_micros-held_micros-spent_micros>=NEW.customer_reserved);
 SELECT RAISE(ABORT,'gateway_premium_approval') WHERE NEW.approval_bucket IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM gateway_spend_buckets b WHERE b.id=NEW.approval_bucket AND b.scope='approval' AND b.user_id=NEW.user_id AND b.task_id=NEW.task_id
  AND b.id=json_extract(NEW.snapshot,'$.approvalId') AND json_extract(b.terms_json,'$.catalogVersion')=json_extract(NEW.snapshot,'$.catalogVersion')
  AND json_extract(b.terms_json,'$.policy')='gateway-cost-routing-v1' AND json_extract(b.terms_json,'$.tariffId')=json_extract(NEW.snapshot,'$.tariffId')
  AND json_extract(b.terms_json,'$.retailMultiplierBps')=json_extract(NEW.snapshot,'$.retailMultiplierBps')
  AND json_extract(b.terms_json,'$.expiresAt')>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
  AND EXISTS(SELECT 1 FROM json_each(b.terms_json,'$.candidateIds') WHERE value=json_extract(NEW.snapshot,'$.candidateId'))
  AND b.limit_micros-b.held_micros-b.spent_micros>=NEW.customer_reserved
 );
END;

CREATE TRIGGER gateway_attempt_hold AFTER INSERT ON gateway_spend_attempts BEGIN
 UPDATE gateway_spend_buckets SET held_micros=held_micros+NEW.provider_reserved WHERE id IN (NEW.task_bucket,NEW.account_bucket,NEW.platform_bucket);
 UPDATE gateway_spend_buckets SET held_micros=held_micros+NEW.customer_reserved WHERE id IN (NEW.premium_bucket,NEW.approval_bucket);
END;

CREATE TRIGGER gateway_attempt_immutable BEFORE UPDATE ON gateway_spend_attempts BEGIN
 SELECT RAISE(ABORT,'gateway_attempt_immutable') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.task_id!=OLD.task_id OR NEW.snapshot!=OLD.snapshot OR NEW.task_bucket!=OLD.task_bucket OR NEW.account_bucket!=OLD.account_bucket OR NEW.platform_bucket!=OLD.platform_bucket OR NEW.premium_bucket IS NOT OLD.premium_bucket OR NEW.approval_bucket IS NOT OLD.approval_bucket OR NEW.provider_reserved!=OLD.provider_reserved OR NEW.customer_reserved!=OLD.customer_reserved;
 SELECT RAISE(ABORT,'gateway_dispatch_expired') WHERE NEW.status='dispatched' AND (json_extract(OLD.snapshot,'$.rateValidUntil')<=(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) OR (OLD.approval_bucket IS NOT NULL AND NOT EXISTS(SELECT 1 FROM gateway_spend_buckets WHERE id=OLD.approval_bucket AND json_extract(terms_json,'$.expiresAt')>(CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))));
 SELECT RAISE(ABORT,'gateway_settlement_cost') WHERE NEW.status='settled' AND (
 NEW.input_tokens>json_extract(OLD.snapshot,'$.inputBound') OR NEW.output_tokens>json_extract(OLD.snapshot,'$.outputBound') OR
 NEW.provider_actual!=CAST((NEW.input_tokens*json_extract(OLD.snapshot,'$.rate.inputMicrosPerMillion')+NEW.output_tokens*json_extract(OLD.snapshot,'$.rate.outputMicrosPerMillion')+999999)/1000000 AS INTEGER)+json_extract(OLD.snapshot,'$.extraMicrosPerCall') OR
 NEW.customer_actual!=CASE WHEN json_extract(OLD.snapshot,'$.tier')='standard' THEN 0 ELSE CAST((NEW.provider_actual*json_extract(OLD.snapshot,'$.retailMultiplierBps')+9999)/10000 AS INTEGER) END);
 SELECT RAISE(ABORT,'gateway_transition') WHERE NOT ((OLD.status='reserved' AND NEW.status IN ('dispatched','released')) OR (OLD.status='dispatched' AND NEW.status IN ('uncertain','settled')) OR (OLD.status='uncertain' AND NEW.status='settled'));
END;

CREATE TRIGGER gateway_attempt_finish AFTER UPDATE ON gateway_spend_attempts WHEN NEW.status IN ('settled','released') BEGIN
 UPDATE gateway_spend_buckets SET held_micros=held_micros-OLD.provider_reserved,spent_micros=spent_micros+COALESCE(NEW.provider_actual,0) WHERE id IN (NEW.task_bucket,NEW.account_bucket,NEW.platform_bucket);
 UPDATE gateway_spend_buckets SET held_micros=held_micros-OLD.customer_reserved,spent_micros=spent_micros+COALESCE(NEW.customer_actual,0) WHERE id IN (NEW.premium_bucket,NEW.approval_bucket);
END;

CREATE TRIGGER gateway_attempt_no_delete BEFORE DELETE ON gateway_spend_attempts BEGIN SELECT RAISE(ABORT,'gateway_attempt_immutable'); END;

CREATE TRIGGER fair_use_project_created AFTER INSERT ON projects BEGIN
 INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at) VALUES(NEW.id,NEW.owner_user_id,NEW.created_at);
END;

CREATE TRIGGER fair_use_ai_version AFTER INSERT ON site_versions WHEN EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.id AND t.mode='ai' AND t.status='completed') BEGIN
 UPDATE fair_use_project_lifecycle SET ai_saved_at=COALESCE(ai_saved_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=NEW.project_id;
END;

CREATE TRIGGER fair_use_ai_completed AFTER UPDATE OF status ON chat_turns WHEN NEW.mode='ai' AND NEW.status='completed' AND OLD.status!='completed' BEGIN
 UPDATE fair_use_project_lifecycle SET ai_saved_at=COALESCE(ai_saved_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE user_id=NEW.user_id AND project_id IN (SELECT project_id FROM site_versions WHERE id=NEW.id);
END;

CREATE TRIGGER fair_use_project_removed AFTER DELETE ON projects BEGIN
 UPDATE fair_use_project_lifecycle SET removed_at=COALESCE(removed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE project_id=OLD.id AND user_id=OLD.owner_user_id;
END;

CREATE TRIGGER fair_use_lifecycle_immutable BEFORE UPDATE ON fair_use_project_lifecycle BEGIN
 SELECT RAISE(ABORT,'fair_use_identity') WHERE NEW.project_id!=OLD.project_id OR NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR NEW.observed_since!=OLD.observed_since;
 SELECT RAISE(ABORT,'fair_use_history') WHERE (OLD.ai_saved_at IS NOT NULL AND NEW.ai_saved_at IS NOT OLD.ai_saved_at) OR (OLD.export_prepared_at IS NOT NULL AND NEW.export_prepared_at IS NOT OLD.export_prepared_at) OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NOT OLD.removed_at);
END;

CREATE TRIGGER cms_media_upload_admit BEFORE INSERT ON cms_media_uploads BEGIN
 SELECT RAISE(ABORT,'cms_upload_owner') WHERE NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected' AND d.origin=NEW.origin);
 SELECT RAISE(ABORT,'cms_upload_initial') WHERE NEW.result IS NOT NULL;
 SELECT RAISE(ABORT,'cms_upload_quota') WHERE (SELECT count(*) FROM cms_media_uploads WHERE project_id=NEW.project_id)>=20 OR (SELECT count(*) FROM cms_media_uploads WHERE user_id=NEW.user_id)>=50 OR (SELECT count(*) FROM cms_media_uploads)>=500;
END;

CREATE TRIGGER cms_media_upload_storage AFTER INSERT ON cms_media_uploads BEGIN
 INSERT INTO storage_usage(period,write_ops) VALUES(strftime('%Y-%m','now'),2) ON CONFLICT(period) DO UPDATE SET write_ops=write_ops+2 WHERE write_ops+2<=10000;
 SELECT RAISE(ABORT,'cms_upload_storage') WHERE changes()=0;
END;

CREATE TRIGGER cms_media_upload_immutable BEFORE UPDATE ON cms_media_uploads BEGIN
 SELECT RAISE(ABORT,'cms_upload_identity') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.origin!=OLD.origin OR NEW.filename!=OLD.filename OR NEW.digest!=OLD.digest OR NEW.size!=OLD.size OR NEW.width!=OLD.width OR NEW.height!=OLD.height OR NEW.created_at!=OLD.created_at OR OLD.result IS NOT NULL OR NEW.result IS NULL;
END;

CREATE TRIGGER cms_media_upload_retained BEFORE DELETE ON cms_media_uploads WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_upload_retained'); END;

CREATE TRIGGER cms_publication_manifest_immutable BEFORE UPDATE OF media_manifest ON cms_publication_reviews WHEN NEW.media_manifest<>OLD.media_manifest BEGIN SELECT RAISE(ABORT,'cms_media_manifest_immutable'); END;

CREATE TRIGGER cms_publication_media_create AFTER INSERT ON cms_publication_reviews BEGIN
 SELECT RAISE(ABORT,'cms_media_manifest_content') WHERE (SELECT count(DISTINCT json_extract(value,'$.asset._ref')) FROM json_each(NEW.snapshot,'$.item.data.content') WHERE json_extract(value,'$._type')='image')<>json_array_length(NEW.media_manifest) OR EXISTS(SELECT 1 FROM json_each(NEW.media_manifest) m WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.snapshot,'$.item.data.content') b WHERE json_extract(b.value,'$._type')='image' AND json_extract(b.value,'$.asset._ref')=json_extract(m.value,'$.mediaId')));
 SELECT RAISE(ABORT,'cms_media_capacity') WHERE (SELECT count(*) FROM cms_publication_media)+json_array_length(NEW.media_manifest)>500;
 INSERT INTO cms_publication_media(review_id,media_id,user_id,project_id,digest,size,width,height)
 SELECT NEW.id,json_extract(value,'$.mediaId'),NEW.user_id,NEW.project_id,json_extract(value,'$.digest'),json_extract(value,'$.size'),json_extract(value,'$.width'),json_extract(value,'$.height') FROM json_each(NEW.media_manifest);
END;

CREATE TRIGGER cms_publication_media_admit BEFORE INSERT ON cms_publication_media BEGIN
 SELECT RAISE(ABORT,'cms_media_receipt_required') WHERE NEW.state<>'pending' OR NOT EXISTS(
  SELECT 1 FROM cms_media_uploads u JOIN cms_deployments d ON d.project_id=u.project_id JOIN cms_publication_reviews r ON r.id=NEW.review_id
  WHERE u.user_id=NEW.user_id AND u.project_id=NEW.project_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.status='pending'
  AND u.origin=d.origin AND d.state='connected' AND json_extract(u.result,'$.mediaId')=NEW.media_id AND u.digest=NEW.digest AND u.size=NEW.size AND u.width=NEW.width AND u.height=NEW.height
  AND EXISTS(SELECT 1 FROM json_each(r.media_manifest) m WHERE json_extract(m.value,'$.mediaId')=NEW.media_id AND json_extract(m.value,'$.digest')=NEW.digest AND json_extract(m.value,'$.size')=NEW.size AND json_extract(m.value,'$.width')=NEW.width AND json_extract(m.value,'$.height')=NEW.height)
 );
 SELECT RAISE(ABORT,'cms_media_safety_required') WHERE NOT EXISTS(SELECT 1 FROM approved_cms_media a WHERE a.user_id=NEW.user_id AND a.project_id=NEW.project_id AND a.media_id=NEW.media_id AND a.digest=NEW.digest AND a.size=NEW.size AND a.width=NEW.width AND a.height=NEW.height);
END;

CREATE TRIGGER cms_publication_media_freeze_safety BEFORE UPDATE OF state ON cms_publication_media WHEN NEW.state='ready' AND NOT EXISTS(SELECT 1 FROM approved_cms_media a WHERE a.user_id=NEW.user_id AND a.project_id=NEW.project_id AND a.media_id=NEW.media_id AND a.digest=NEW.digest)
 BEGIN SELECT RAISE(ABORT,'cms_media_safety_required'); END;

CREATE TRIGGER cms_publication_media_immutable BEFORE UPDATE ON cms_publication_media WHEN NEW.review_id<>OLD.review_id OR NEW.media_id<>OLD.media_id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.digest<>OLD.digest OR NEW.size<>OLD.size OR NEW.width<>OLD.width OR NEW.height<>OLD.height OR OLD.state<>'pending' OR NEW.state<>'ready' BEGIN SELECT RAISE(ABORT,'cms_media_immutable'); END;

CREATE TRIGGER cms_publication_media_retained BEFORE DELETE ON cms_publication_media WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_media_retained'); END;

CREATE TRIGGER cms_publication_media_approval BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status IN ('approved','published') AND (
 (SELECT count(*) FROM cms_publication_media WHERE review_id=NEW.id AND state='ready')<>json_array_length(NEW.media_manifest)
) BEGIN SELECT RAISE(ABORT,'cms_media_not_frozen'); END;

CREATE TRIGGER cms_publication_media_safety BEFORE UPDATE OF status ON cms_publication_reviews WHEN NEW.status IN ('approved','published') AND EXISTS(
 SELECT 1 FROM cms_publication_media m WHERE m.review_id=NEW.id AND NOT EXISTS(SELECT 1 FROM approved_cms_media a WHERE a.user_id=m.user_id AND a.project_id=m.project_id AND a.media_id=m.media_id AND a.digest=m.digest)
) BEGIN SELECT RAISE(ABORT,'cms_media_safety_required'); END;

CREATE TRIGGER cms_import_admission BEFORE INSERT ON cms_import_reviews WHEN NEW.status<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected') OR EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_edit_requests WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM cms_discard_reviews WHERE id=NEW.id) OR (((SELECT count(*) FROM cms_import_reviews t WHERE t.project_id=NEW.project_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=25
  OR (SELECT count(*) FROM cms_import_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=100
  OR (SELECT count(*) FROM cms_import_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=5000
  OR ((SELECT count(*) FROM cms_import_reviews t WHERE ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=2500 AND (SELECT count(*) FROM cms_import_reviews t WHERE t.user_id=NEW.user_id AND ((t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR t.status='approved'))>=25)))
 BEGIN SELECT RAISE(ABORT,'cms_import_unavailable'); END;

CREATE TRIGGER cms_import_immutable BEFORE UPDATE ON cms_import_reviews WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.source_digest<>OLD.source_digest OR NEW.source_id<>OLD.source_id OR NEW.collection<>OLD.collection OR NEW.body<>OLD.body OR NEW.provenance<>OLD.provenance OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at OR NOT ((OLD.status='pending' AND NEW.status='superseded' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='pending' AND NEW.status='approved' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.status='approved' AND NEW.status='imported' AND EXISTS(SELECT 1 FROM cms_draft_requests d WHERE d.id=OLD.id AND d.user_id=OLD.user_id AND d.project_id=OLD.project_id AND d.collection=OLD.collection AND d.body=OLD.body AND d.content_format='structured' AND d.item_id IS NOT NULL)))
 BEGIN SELECT RAISE(ABORT,'cms_import_immutable'); END;

CREATE TRIGGER cms_import_approve AFTER UPDATE OF status ON cms_import_reviews WHEN OLD.status='pending' AND NEW.status='approved' BEGIN
 INSERT INTO cms_draft_requests(id,project_id,user_id,collection,body,content_format) VALUES(NEW.id,NEW.project_id,NEW.user_id,NEW.collection,NEW.body,'structured');
END;

CREATE TRIGGER cms_import_draft_guard BEFORE INSERT ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=NEW.id AND (r.status<>'approved' OR r.project_id<>NEW.project_id OR r.user_id<>NEW.user_id OR r.collection<>NEW.collection OR r.body<>NEW.body OR NEW.content_format<>'structured')) BEGIN SELECT RAISE(ABORT,'cms_import_review_required'); END;

CREATE TRIGGER cms_import_retained BEFORE DELETE ON cms_import_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cms_import_retained') WHERE NOT (OLD.status='imported' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0 OR OLD.status='superseded')
  OR (EXISTS(SELECT 1 FROM cms_import_taxonomy_jobs WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='imported') OR OLD.id NOT IN (SELECT t.id FROM cms_import_reviews t WHERE t.project_id=OLD.project_id AND t.status='imported' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cms_import_reviews' AND id=OLD.id AND (OLD.status='imported')=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER cms_import_publication_id BEFORE INSERT ON cms_publication_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;

CREATE TRIGGER cms_import_edit_id BEFORE INSERT ON cms_edit_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;

CREATE TRIGGER cms_import_unpublish_id BEFORE INSERT ON cms_unpublish_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;

CREATE TRIGGER cms_import_discard_id BEFORE INSERT ON cms_discard_reviews WHEN EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'cms_import_id_reserved'); END;

CREATE TRIGGER cms_import_renew BEFORE INSERT ON cms_import_reviews BEGIN
 UPDATE cms_import_reviews SET status='superseded' WHERE project_id=NEW.project_id AND user_id=NEW.user_id AND source_digest=NEW.source_digest AND source_id=NEW.source_id AND status='pending' AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER cms_wordpress_source_admit BEFORE INSERT ON cms_wordpress_sources WHEN NEW.state<>'pending' OR NOT EXISTS(SELECT 1 FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=NEW.project_id AND c.user_id=NEW.user_id AND p.owner_user_id=NEW.user_id AND c.state='ready' AND d.state='connected') OR (SELECT count(*) FROM cms_wordpress_sources WHERE project_id=NEW.project_id)>=5 OR (SELECT count(*) FROM cms_wordpress_sources WHERE user_id=NEW.user_id)>=10 OR (SELECT count(*) FROM cms_wordpress_sources)>=50
 BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_unavailable'); END;

CREATE TRIGGER cms_wordpress_source_immutable BEFORE UPDATE ON cms_wordpress_sources WHEN NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.filename<>OLD.filename OR NEW.digest<>OLD.digest OR NEW.size<>OLD.size OR NEW.created_at<>OLD.created_at OR OLD.state<>'pending' OR NEW.state<>'ready'
 BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_immutable'); END;

CREATE TRIGGER cms_wordpress_source_retained BEFORE DELETE ON cms_wordpress_sources WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_wordpress_source_retained'); END;

CREATE TRIGGER cms_import_source_admit BEFORE INSERT ON cms_import_reviews WHEN NEW.source_upload_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cms_wordpress_sources s WHERE s.id=NEW.source_upload_id AND s.user_id=NEW.user_id AND s.project_id=NEW.project_id AND s.digest=NEW.source_digest AND s.state='ready') BEGIN SELECT RAISE(ABORT,'cms_import_source_required'); END;

CREATE TRIGGER cms_import_source_immutable BEFORE UPDATE OF source_upload_id ON cms_import_reviews WHEN NEW.source_upload_id IS NOT OLD.source_upload_id BEGIN SELECT RAISE(ABORT,'cms_import_source_immutable'); END;

CREATE TRIGGER backend_component_integrity BEFORE INSERT ON backend_component_instances
 WHEN NOT EXISTS(SELECT 1 FROM backend_versions v WHERE v.id=NEW.version_id AND v.digest=NEW.artifact_digest)
 BEGIN SELECT RAISE(ABORT,'backend_component_digest_mismatch'); END;

CREATE TRIGGER backend_component_immutable BEFORE UPDATE ON backend_component_instances
 BEGIN SELECT RAISE(ABORT,'backend_component_immutable'); END;

CREATE TRIGGER backend_component_retained BEFORE DELETE ON backend_component_instances
 WHEN EXISTS(SELECT 1 FROM backend_versions WHERE id=OLD.version_id)
 BEGIN SELECT RAISE(ABORT,'backend_component_retained'); END;

CREATE TRIGGER welcome_revision BEFORE UPDATE ON welcome_onboarding
 WHEN NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR OLD.completed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'welcome_revision'); END;

CREATE TRIGGER welcome_complete_guard BEFORE UPDATE ON welcome_onboarding
 WHEN (NEW.stage='complete')<>(NEW.completed_at IS NOT NULL) OR
 (NEW.completed_at IS NOT NULL AND (OLD.stage<>'review' OR length(trim(NEW.project_name))=0 OR length(trim(NEW.idea))=0 OR NOT EXISTS(SELECT 1 FROM user_profiles WHERE user_id=NEW.user_id AND length(trim(name))>0)))
 BEGIN SELECT RAISE(ABORT,'welcome_incomplete'); END;

CREATE TRIGGER domain_proof_removal_identity BEFORE UPDATE ON domain_proof_removals
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.claim_id!=OLD.claim_id OR NEW.hostname!=OLD.hostname OR NEW.proof_token!=OLD.proof_token OR NEW.proof_expires_at!=OLD.proof_expires_at OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied'
BEGIN SELECT RAISE(ABORT,'domain_proof_removal_immutable'); END;

CREATE TRIGGER domain_proof_removal_apply AFTER UPDATE ON domain_proof_removals
BEGIN
 DELETE FROM domain_claims WHERE id=NEW.claim_id AND project_id=NEW.project_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('domain-proof-removal:'||NEW.claim_id,NEW.user_id,NEW.project_id,'domain.proof.removed','Removed unused domain ownership proof',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TRIGGER domain_proof_retained BEFORE DELETE ON domain_claims
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
BEGIN
 SELECT RAISE(ABORT,'domain_proof_removal_retained') WHERE EXISTS(SELECT 1 FROM domain_connections WHERE claim_id=OLD.id) OR EXISTS(SELECT 1 FROM cloudflare_dns_actions WHERE claim_id=OLD.id);
 SELECT RAISE(ABORT,'domain_proof_removal_unreviewed') WHERE NOT EXISTS(SELECT 1 FROM domain_proof_removals WHERE claim_id=OLD.id AND project_id=OLD.project_id AND proof_token=OLD.token AND status='applied');
END;

CREATE TRIGGER domain_proof_removed BEFORE INSERT ON domain_claims
WHEN EXISTS(SELECT 1 FROM domain_proof_removals WHERE claim_id=NEW.id AND status='applied')
BEGIN SELECT RAISE(ABORT,'domain_proof_removal_replay'); END;

CREATE TRIGGER gateway_request_admit BEFORE INSERT ON gateway_inference_requests BEGIN
 SELECT RAISE(ABORT,'gateway_request_state') WHERE NEW.result_json IS NOT NULL OR NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=NEW.attempt_id AND status='reserved');
END;

CREATE TRIGGER gateway_request_immutable BEFORE UPDATE ON gateway_inference_requests BEGIN
 SELECT RAISE(ABORT,'gateway_request_immutable') WHERE NEW.attempt_id!=OLD.attempt_id OR NEW.request_hash!=OLD.request_hash OR OLD.result_json IS NOT NULL OR NEW.result_json IS NULL;
 SELECT RAISE(ABORT,'gateway_request_state') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=OLD.attempt_id AND status='dispatched');
END;

CREATE TRIGGER gateway_request_no_delete BEFORE DELETE ON gateway_inference_requests BEGIN SELECT RAISE(ABORT,'gateway_request_immutable'); END;

CREATE TRIGGER gateway_provider_receipt_admit BEFORE INSERT ON gateway_provider_receipts BEGIN
 SELECT RAISE(ABORT,'gateway_provider_receipt_state') WHERE NOT EXISTS(SELECT 1 FROM gateway_spend_attempts WHERE id=NEW.attempt_id AND status='dispatched');
END;

CREATE TRIGGER gateway_provider_receipt_no_update BEFORE UPDATE ON gateway_provider_receipts BEGIN SELECT RAISE(ABORT,'gateway_provider_receipt_immutable'); END;

CREATE TRIGGER gateway_provider_receipt_no_delete BEFORE DELETE ON gateway_provider_receipts BEGIN SELECT RAISE(ABORT,'gateway_provider_receipt_immutable'); END;

CREATE TRIGGER welcome_first_draft_immutable BEFORE UPDATE ON welcome_first_drafts
 BEGIN SELECT RAISE(ABORT,'welcome_first_draft_immutable'); END;

CREATE TRIGGER welcome_first_draft_guard BEFORE INSERT ON site_versions
 WHEN EXISTS (
  SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND substr(t.user_text,1,13)='/first-draft '
  AND (t.user_text<>'/first-draft '||NEW.project_id OR t.mode<>'ai'
   OR NOT EXISTS(SELECT 1 FROM welcome_first_drafts f WHERE f.turn_id=t.id AND f.project_id=NEW.project_id AND f.user_id=t.user_id)
   OR NOT EXISTS(SELECT 1 FROM welcome_onboarding w JOIN projects p ON p.id=w.project_id AND p.owner_user_id=w.user_id
    WHERE w.user_id=t.user_id AND w.project_id=NEW.project_id AND w.completed_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM site_versions v WHERE v.project_id=NEW.project_id))
 )
 BEGIN SELECT RAISE(ABORT,'welcome_first_draft_changed'); END;

CREATE TRIGGER cms_import_taxonomy_admit BEFORE INSERT ON cms_import_reviews WHEN NEW.taxonomy_plan<>'[]' AND (
 NEW.collection<>'posts' OR NEW.source_upload_id IS NULL OR json_array_length(NEW.taxonomy_plan)=0 OR
 EXISTS(SELECT 1 FROM json_each(NEW.taxonomy_plan) t WHERE json_type(t.value)<>'object' OR (SELECT count(*) FROM json_each(t.value))<>3 OR json_extract(t.value,'$.taxonomy') NOT IN ('categories','tags') OR json_type(t.value,'$.taxonomy') IS NOT 'text' OR json_type(t.value,'$.slug') IS NOT 'text' OR json_type(t.value,'$.label') IS NOT 'text') OR
 (SELECT count(DISTINCT json_extract(value,'$.taxonomy')||':'||json_extract(value,'$.slug')) FROM json_each(NEW.taxonomy_plan))<>json_array_length(NEW.taxonomy_plan)
) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_plan_invalid'); END;

CREATE TRIGGER cms_import_taxonomy_immutable BEFORE UPDATE OF taxonomy_plan ON cms_import_reviews WHEN NEW.taxonomy_plan<>OLD.taxonomy_plan BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_immutable'); END;

CREATE TRIGGER cms_import_taxonomy_job_admit BEFORE INSERT ON cms_import_taxonomy_jobs WHEN NEW.state<>'prepared' OR NOT EXISTS(
 SELECT 1 FROM cms_import_reviews r JOIN projects p ON p.id=r.project_id JOIN cms_draft_requests d ON d.id=r.id
 WHERE r.id=NEW.review_id AND r.status='approved' AND r.taxonomy_plan<>'[]' AND r.user_id=p.owner_user_id AND d.item_id IS NULL AND d.user_id=r.user_id AND d.project_id=r.project_id AND d.body=r.body
 AND json_type(NEW.body)='object' AND (SELECT count(*) FROM json_each(NEW.body))=3
 AND json_extract(NEW.body,'$.draftRequestId')=r.id AND json_type(NEW.body,'$.itemId')='text' AND length(json_extract(NEW.body,'$.itemId'))=26
 AND json_extract(NEW.body,'$.itemId') NOT GLOB '*[^0-9A-HJKMNP-TV-Z]*'
 AND json_type(NEW.body,'$.terms')='array' AND json_array_length(NEW.body,'$.terms')=json_array_length(r.taxonomy_plan)
 AND (SELECT count(DISTINCT json_extract(value,'$.id')) FROM json_each(NEW.body,'$.terms'))=json_array_length(r.taxonomy_plan)
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.terms') n WHERE json_type(n.value)<>'object' OR (SELECT count(*) FROM json_each(n.value))<>4 OR json_extract(n.value,'$.id') GLOB '*[^0-9A-HJKMNP-TV-Z]*')
 AND NOT EXISTS(SELECT 1 FROM json_each(r.taxonomy_plan) t WHERE NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.terms') n WHERE json_extract(n.value,'$.taxonomy')=json_extract(t.value,'$.taxonomy') AND json_extract(n.value,'$.slug')=json_extract(t.value,'$.slug') AND json_extract(n.value,'$.label')=json_extract(t.value,'$.label') AND json_type(n.value,'$.id')='text' AND length(json_extract(n.value,'$.id'))=26))
) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_invalid'); END;

CREATE TRIGGER cms_import_taxonomy_job_immutable BEFORE UPDATE ON cms_import_taxonomy_jobs WHEN NEW.review_id<>OLD.review_id OR NEW.body<>OLD.body OR OLD.state<>'prepared' OR NEW.state<>'applied' BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_immutable'); END;

CREATE TRIGGER cms_import_taxonomy_job_retained BEFORE DELETE ON cms_import_taxonomy_jobs WHEN EXISTS(SELECT 1 FROM cms_import_reviews r JOIN users u ON u.id=r.user_id WHERE r.id=OLD.review_id) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomy_job_retained'); END;

CREATE TRIGGER cms_import_taxonomy_draft_receipt BEFORE UPDATE OF item_id ON cms_draft_requests WHEN EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=NEW.id AND r.taxonomy_plan<>'[]') AND NOT EXISTS(SELECT 1 FROM cms_import_taxonomy_jobs j WHERE j.review_id=NEW.id AND j.state='applied' AND json_extract(j.body,'$.itemId')=NEW.item_id) BEGIN SELECT RAISE(ABORT,'cms_import_taxonomies_incomplete'); END;

CREATE TRIGGER application_build_admit BEFORE INSERT ON application_builds BEGIN
 SELECT RAISE(ABORT,'application_build_owner') WHERE NOT EXISTS(
  SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.status='pending'
  WHERE v.id=NEW.id AND p.id=NEW.project_id AND p.owner_user_id=NEW.user_id
 );
 -- Visitor documents become program-owned once an application was authorized; visitors enrolled only in the access
 -- instance (WH-126) hold untouched empty documents and do not block a first application draft.
 SELECT RAISE(ABORT,'application_build_migration') WHERE EXISTS(SELECT 1 FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id WHERE v.project_id=NEW.project_id AND a.revision>0);
END;

CREATE TRIGGER application_build_immutable BEFORE UPDATE ON application_builds
 BEGIN SELECT RAISE(ABORT,'application_build_immutable'); END;

-- WH-074: a build job exists only for an owner's pending Chat request that already saved its build intent.
-- Visitor, public, webhook and scheduled paths have no such turn and cannot create, wake or extend a job.
-- Bounded shared pool: one active job per project, three per account and sixteen platform-wide, where a job stays
-- active until its cleanup is recorded as released. An active operator `build` freeze (WH-050) refuses admission with
-- the same generic capacity error, so containment is never disclosed.
CREATE TRIGGER build_job_admit BEFORE INSERT ON build_jobs BEGIN
 SELECT RAISE(ABORT,'build_job_owner') WHERE NOT EXISTS(
  SELECT 1 FROM application_builds b JOIN projects p ON p.id=b.project_id AND p.owner_user_id=b.user_id
  JOIN chat_turns t ON t.id=b.id AND t.user_id=b.user_id AND t.status='pending'
  WHERE b.id=NEW.id AND b.project_id=NEW.project_id AND b.user_id=NEW.user_id);
 SELECT RAISE(ABORT,'build_job_invalid') WHERE NEW.state<>'running' OR NEW.cleanup<>'pending' OR NEW.dispatched_at IS NOT NULL OR NEW.finished_at IS NOT NULL OR NEW.diagnostics_json IS NOT NULL
  OR NEW.created_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) OR abs(julianday(NEW.created_at)-julianday('now'))>1.0/1440
  OR NEW.expires_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.expires_at) OR NEW.expires_at<=NEW.created_at OR NEW.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+120 seconds')
  OR NOT EXISTS(SELECT 1 FROM backend_versions v WHERE v.id=NEW.id AND v.project_id=NEW.project_id AND NEW.artifact_key='private/'||v.project_id||'/'||v.id||'/'||v.digest);
 SELECT RAISE(ABORT,'build_job_capacity') WHERE (SELECT count(*) FROM build_jobs WHERE project_id=NEW.project_id AND (state='running' OR cleanup<>'released'))>=1
  OR (SELECT count(*) FROM build_jobs WHERE user_id=NEW.user_id AND (state='running' OR cleanup<>'released'))>=3
  OR (SELECT count(*) FROM build_jobs WHERE state='running' OR cleanup<>'released')>=16
  OR EXISTS(SELECT 1 FROM operator_contained_projects WHERE project_id=NEW.project_id AND scope='build');
END;

-- Identity, lease, inputs and keys are immutable. Dispatch (the only spend) happens once, while running and unexpired.
-- Success needs that dispatch and the job's own passing receipt. Cancellation and expiry are terminal for execution.
CREATE TRIGGER build_job_transition BEFORE UPDATE ON build_jobs BEGIN
 SELECT RAISE(ABORT,'build_job_immutable') WHERE NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id OR NEW.user_id<>OLD.user_id OR NEW.purpose<>OLD.purpose OR NEW.origin<>OLD.origin
  OR NEW.lease_digest<>OLD.lease_digest OR NEW.input_digest<>OLD.input_digest OR NEW.toolchain_key<>OLD.toolchain_key OR NEW.artifact_key<>OLD.artifact_key OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS NOT OLD.dispatched_at) OR (OLD.finished_at IS NOT NULL AND NEW.finished_at IS NOT OLD.finished_at)
  OR (OLD.diagnostics_json IS NOT NULL AND NEW.diagnostics_json IS NOT OLD.diagnostics_json);
 SELECT RAISE(ABORT,'build_job_inactive') WHERE OLD.dispatched_at IS NULL AND NEW.dispatched_at IS NOT NULL AND (OLD.state<>'running' OR NEW.state<>'running' OR OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  OR NEW.dispatched_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.dispatched_at) OR abs(julianday(NEW.dispatched_at)-julianday('now'))>1.0/1440);
 SELECT RAISE(ABORT,'build_job_transition') WHERE NEW.state<>OLD.state AND NOT (
  (OLD.state='running' AND NEW.state IN ('succeeded','failed') AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  OR (OLD.state='running' AND NEW.state='expired' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  OR (OLD.state IN ('running','succeeded') AND NEW.state='cancelled')
  OR (OLD.state='succeeded' AND NEW.state='published' AND OLD.cleanup='released'));
 SELECT RAISE(ABORT,'build_job_transition') WHERE NEW.state<>OLD.state AND OLD.state='running' AND (NEW.finished_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.finished_at) OR abs(julianday(NEW.finished_at)-julianday('now'))>1.0/1440);
 SELECT RAISE(ABORT,'build_job_success') WHERE NEW.state='succeeded' AND OLD.state='running' AND (OLD.dispatched_at IS NULL OR NOT EXISTS(
  SELECT 1 FROM backend_runs r WHERE r.id=OLD.id AND r.version_id=OLD.id AND r.project_id=OLD.project_id AND r.user_id=OLD.user_id AND r.state='complete'
  AND json_extract(r.result_json,'$.ok')=1 AND json_extract(r.result_json,'$.check.status')='passed'));
 SELECT RAISE(ABORT,'build_job_cleanup') WHERE NEW.cleanup<>OLD.cleanup AND (OLD.cleanup='released' OR NOT EXISTS(
  SELECT 1 FROM build_job_cleanups c WHERE c.job_id=OLD.id AND c.outcome=NEW.cleanup AND c.attempt=(SELECT max(attempt) FROM build_job_cleanups WHERE job_id=OLD.id)));
END;

-- The job's own test reservation is its only spend. A cancelled, expired, finished or undispatched job cannot reserve it,
-- and no job can reserve a run for another project, owner or version.
CREATE TRIGGER build_job_spend BEFORE INSERT ON backend_runs WHEN EXISTS(SELECT 1 FROM build_jobs j WHERE j.id=NEW.id AND NOT(
 j.state='running' AND j.dispatched_at IS NOT NULL AND j.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND j.project_id=NEW.project_id AND j.user_id=NEW.user_id AND NEW.version_id=j.id))
BEGIN SELECT RAISE(ABORT,'build_job_inactive'); END;

-- Output ownership before publication: a review citing a job's receipt needs that exact owner, project and version,
-- a succeeded (or already published) job whose cleanup was released, and source bytes matching the private artifact key.
CREATE TRIGGER build_job_publish BEFORE INSERT ON app_activation_reviews WHEN NEW.run_id IS NOT NULL AND EXISTS(SELECT 1 FROM build_jobs j WHERE j.id=NEW.run_id AND NOT(
 j.state IN ('succeeded','published') AND j.cleanup='released' AND j.project_id=NEW.project_id AND j.user_id=NEW.user_id AND NEW.version_id=j.id
 AND EXISTS(SELECT 1 FROM backend_versions v WHERE v.id=j.id AND j.artifact_key='private/'||v.project_id||'/'||v.id||'/'||v.digest)))
BEGIN SELECT RAISE(ABORT,'build_job_output'); END;

CREATE TRIGGER build_job_published AFTER INSERT ON app_activation_reviews WHEN NEW.run_id IS NOT NULL
BEGIN UPDATE build_jobs SET state='published' WHERE id=NEW.run_id AND state='succeeded'; END;

-- Cleanup attempts follow execution, are numbered without gaps and can only claim release when it is knowable:
-- never dispatched, or after the runtime's own per-call bound has elapsed since dispatch.
CREATE TRIGGER build_job_cleanup_admit BEFORE INSERT ON build_job_cleanups BEGIN
 SELECT RAISE(ABORT,'build_job_cleanup') WHERE NOT EXISTS(SELECT 1 FROM build_jobs j WHERE j.id=NEW.job_id AND j.state<>'running' AND j.cleanup<>'released')
  OR NEW.attempt<>1+(SELECT count(*) FROM build_job_cleanups WHERE job_id=NEW.job_id)
  OR NEW.recorded_at IS NOT strftime('%Y-%m-%dT%H:%M:%fZ',NEW.recorded_at) OR abs(julianday(NEW.recorded_at)-julianday('now'))>1.0/1440
  OR (NEW.reason='not-dispatched' AND EXISTS(SELECT 1 FROM build_jobs WHERE id=NEW.job_id AND dispatched_at IS NOT NULL))
  OR (NEW.reason IN ('runtime-returned','runtime-unconfirmed') AND EXISTS(SELECT 1 FROM build_jobs WHERE id=NEW.job_id AND dispatched_at IS NULL))
  OR (NEW.reason='runtime-bound-elapsed' AND NOT EXISTS(SELECT 1 FROM build_jobs WHERE id=NEW.job_id AND dispatched_at IS NOT NULL AND dispatched_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 seconds')));
END;

CREATE TRIGGER build_job_cleanup_recorded AFTER INSERT ON build_job_cleanups
BEGIN UPDATE build_jobs SET cleanup=NEW.outcome WHERE id=NEW.job_id; END;

CREATE TRIGGER build_job_cleanup_immutable BEFORE UPDATE ON build_job_cleanups
BEGIN SELECT RAISE(ABORT,'build_job_cleanup_immutable'); END;

CREATE TRIGGER welcome_first_draft_claim BEFORE INSERT ON welcome_first_drafts
 WHEN NOT EXISTS(SELECT 1 FROM chat_turns t JOIN welcome_onboarding w ON w.user_id=t.user_id
  JOIN projects p ON p.id=w.project_id AND p.owner_user_id=w.user_id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending'
   AND t.user_text IN('/first-draft '||NEW.project_id,'/first-app '||NEW.project_id)
   AND p.id=NEW.project_id AND w.completed_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM site_versions WHERE project_id=NEW.project_id)
 OR EXISTS(SELECT 1 FROM backend_versions WHERE project_id=NEW.project_id)
 OR EXISTS(SELECT 1 FROM cms_instances WHERE project_id=NEW.project_id)
 OR EXISTS(SELECT 1 FROM welcome_first_drafts WHERE project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'welcome_first_draft_changed'); END;

CREATE TRIGGER welcome_first_app_guard BEFORE INSERT ON backend_versions
 WHEN EXISTS (
  SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND substr(t.user_text,1,11)='/first-app '
  AND (t.user_text<>'/first-app '||NEW.project_id OR t.mode<>'ai'
   OR NOT EXISTS(SELECT 1 FROM welcome_first_drafts f WHERE f.turn_id=t.id AND f.project_id=NEW.project_id AND f.user_id=t.user_id)
   OR NOT EXISTS(SELECT 1 FROM welcome_onboarding w JOIN projects p ON p.id=w.project_id AND p.owner_user_id=w.user_id
    WHERE w.user_id=t.user_id AND w.project_id=NEW.project_id AND w.completed_at IS NOT NULL)
   OR EXISTS(SELECT 1 FROM backend_versions v WHERE v.project_id=NEW.project_id)
   OR EXISTS(SELECT 1 FROM site_versions v WHERE v.project_id=NEW.project_id)
   OR EXISTS(SELECT 1 FROM cms_instances c WHERE c.project_id=NEW.project_id))
 ) BEGIN SELECT RAISE(ABORT,'welcome_first_draft_changed'); END;

CREATE TRIGGER app_owner_erasure_admit BEFORE INSERT ON app_owner_erasures BEGIN
 SELECT RAISE(ABORT,'visitor_erasure_authority') WHERE NOT EXISTS(
  SELECT 1 FROM app_visitors v JOIN projects p ON p.id=v.project_id
  WHERE v.id=NEW.visitor_id AND v.project_id=NEW.project_id AND v.revoked=1 AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'visitor_erasure_capacity') WHERE (SELECT count(*) FROM app_owner_erasures)>=1000;
END;

CREATE TRIGGER app_owner_erasure_apply AFTER INSERT ON app_owner_erasures BEGIN
 DELETE FROM app_visitors WHERE id=NEW.visitor_id AND project_id=NEW.project_id AND revoked=1;
END;

CREATE TRIGGER app_owner_erasure_immutable BEFORE UPDATE ON app_owner_erasures
 BEGIN SELECT RAISE(ABORT,'visitor_erasure_immutable'); END;

CREATE TRIGGER app_owner_erasure_retention BEFORE DELETE ON app_owner_erasures
 WHEN OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 BEGIN SELECT RAISE(ABORT,'visitor_erasure_retention'); END;

CREATE TRIGGER app_recovery_capture AFTER INSERT ON app_recovery_points BEGIN
 INSERT INTO app_recovery_documents(point_id,visitor_id,revision,state_json) SELECT NEW.id,v.id,d.revision,d.state_json FROM app_visitors v JOIN app_documents d ON d.visitor_id=v.id WHERE v.project_id=NEW.project_id AND v.revoked=0;
 UPDATE app_recovery_points SET sealed=1 WHERE id=NEW.id;
END;

CREATE TRIGGER app_recovery_document_admit BEFORE INSERT ON app_recovery_documents BEGIN
 SELECT RAISE(ABORT,'recovery_document') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points r JOIN app_visitors v ON v.project_id=r.project_id JOIN app_documents d ON d.visitor_id=v.id WHERE r.id=NEW.point_id AND r.sealed=0 AND v.id=NEW.visitor_id AND v.revoked=0 AND d.revision=NEW.revision AND d.state_json=NEW.state_json);
END;

CREATE TRIGGER app_recovery_document_immutable BEFORE UPDATE ON app_recovery_documents BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;

CREATE TRIGGER app_recovery_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN DELETE FROM app_recovery_documents WHERE visitor_id=NEW.id; END;

CREATE TRIGGER app_restore_delete_guard BEFORE DELETE ON app_restore_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'restore_immutable') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR (EXISTS(SELECT 1 FROM app_spaces WHERE rollback_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR OLD.id NOT IN (SELECT t.id FROM app_restore_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='app_restore_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER app_recovery_admit BEFORE INSERT ON app_recovery_points BEGIN
 SELECT RAISE(ABORT,'recovery_initial') WHERE NEW.sealed!=0 OR NEW.removed!=0;
 SELECT RAISE(ABORT,'recovery_owner') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.version_id=NEW.version_id);
 SELECT RAISE(ABORT,'recovery_capacity') WHERE (SELECT count(*) FROM app_recovery_points WHERE project_id=NEW.project_id AND removed=0)>=10 OR (SELECT count(*) FROM app_recovery_points WHERE removed=0)>=100 OR (SELECT count(*) FROM app_recovery_points)>=1000;
END;

CREATE TRIGGER app_recovery_point_immutable BEFORE UPDATE ON app_recovery_points BEGIN
 SELECT RAISE(ABORT,'recovery_immutable') WHERE NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.version_id!=OLD.version_id OR NEW.created_at!=OLD.created_at OR NOT((OLD.sealed=0 AND NEW.sealed=1 AND OLD.removed=0 AND NEW.removed=0) OR (OLD.sealed=1 AND NEW.sealed=1 AND OLD.removed=0 AND NEW.removed=1));
END;

CREATE TRIGGER app_recovery_document_delete BEFORE DELETE ON app_recovery_documents WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=OLD.point_id AND removed=0) AND EXISTS(SELECT 1 FROM app_visitors WHERE id=OLD.visitor_id AND revoked=0) BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;

CREATE TRIGGER app_recovery_remove AFTER UPDATE OF removed ON app_recovery_points WHEN NEW.removed=1 BEGIN DELETE FROM app_recovery_documents WHERE point_id=NEW.id; END;

CREATE TRIGGER app_recovery_delete_guard BEFORE DELETE ON app_recovery_points BEGIN SELECT RAISE(ABORT,'recovery_immutable'); END;

CREATE TRIGGER app_restore_removed_admit BEFORE INSERT ON app_restore_reviews WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=NEW.point_id AND removed=1) BEGIN SELECT RAISE(ABORT,'recovery_removed'); END;

CREATE TRIGGER app_restore_removed_confirm BEFORE UPDATE ON app_restore_reviews WHEN EXISTS(SELECT 1 FROM app_recovery_points WHERE id=NEW.point_id AND removed=1) BEGIN SELECT RAISE(ABORT,'recovery_removed'); END;

CREATE TRIGGER app_migration_check_capture AFTER INSERT ON app_migration_checks BEGIN
 INSERT INTO app_migration_documents(migration_id,visitor_id,base_revision) SELECT NEW.id,visitor_id,revision FROM app_recovery_documents WHERE point_id=NEW.id;
END;

CREATE TRIGGER app_migration_check_immutable BEFORE UPDATE ON app_migration_checks BEGIN SELECT RAISE(ABORT,'migration_immutable'); END;

CREATE TRIGGER app_migration_check_delete BEFORE DELETE ON app_migration_checks
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'migration_immutable') WHERE NOT (EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=OLD.id AND a.status='applied') OR (OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour') AND NOT EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=OLD.id) AND NOT EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=OLD.id)) OR 0 OR EXISTS(SELECT 1 FROM app_migration_cancellations c WHERE c.id=OLD.id))
  OR (EXISTS(SELECT 1 FROM app_migration_approvals WHERE id=OLD.id)
   OR EXISTS(SELECT 1 FROM app_migration_cancellations WHERE id=OLD.id)
   OR EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=OLD.id AND a.status='applied')) OR OLD.id NOT IN (SELECT t.id FROM app_migration_checks t WHERE t.project_id=OLD.project_id AND EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=t.id AND a.status='applied') ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='app_migration_checks' AND id=OLD.id AND (EXISTS(SELECT 1 FROM app_migration_approvals a WHERE a.id=OLD.id AND a.status='applied'))=(outcome IN ('applied','withdrawn')));
END;

CREATE TRIGGER app_migration_document_admit BEFORE INSERT ON app_migration_documents BEGIN
 SELECT RAISE(ABORT,'migration_document') WHERE NEW.state!='pending' OR NOT EXISTS(SELECT 1 FROM app_migration_current m JOIN app_recovery_documents d ON d.point_id=m.id WHERE m.id=NEW.migration_id AND d.visitor_id=NEW.visitor_id AND d.revision=NEW.base_revision);
END;

CREATE TRIGGER app_migration_document_update BEFORE UPDATE ON app_migration_documents BEGIN
 SELECT RAISE(ABORT,'migration_immutable') WHERE NEW.migration_id!=OLD.migration_id OR NEW.visitor_id!=OLD.visitor_id OR NEW.base_revision!=OLD.base_revision OR NOT((OLD.state='pending' AND NEW.state='running') OR (OLD.state='running' AND NEW.state IN ('ready','failed')));
 SELECT RAISE(ABORT,'migration_stale') WHERE NOT EXISTS(SELECT 1 FROM app_migration_current WHERE id=NEW.migration_id);
END;

CREATE TRIGGER app_migration_revoke AFTER UPDATE OF revoked ON app_visitors WHEN NEW.revoked=1 BEGIN DELETE FROM app_migration_documents WHERE visitor_id=NEW.id; END;

CREATE TRIGGER app_migration_point_remove AFTER UPDATE OF removed ON app_recovery_points WHEN NEW.removed=1 BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;

CREATE TRIGGER app_migration_initial_space BEFORE INSERT ON app_spaces WHEN NEW.migration_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'migration_initial'); END;

CREATE TRIGGER app_migration_approval_admit BEFORE INSERT ON app_migration_approvals BEGIN
 SELECT RAISE(ABORT,'migration_changed_count') WHERE NEW.changed_documents!=(SELECT count(*) FROM app_migration_documents d JOIN app_recovery_documents b ON b.point_id=d.migration_id AND b.visitor_id=d.visitor_id WHERE d.migration_id=NEW.id AND d.state='ready' AND d.next_json!=b.state_json);
 SELECT RAISE(ABORT,'migration_approval') WHERE NEW.status!='applying' OR NOT EXISTS(SELECT 1 FROM app_migration_checks m JOIN app_migration_current current ON current.id=m.id WHERE m.id=NEW.id AND m.user_id=NEW.user_id);
 SELECT RAISE(ABORT,'migration_incomplete') WHERE (SELECT count(*) FROM app_migration_documents WHERE migration_id=NEW.id)!=(SELECT json_array_length(roster_json) FROM app_migration_checks WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM app_migration_documents WHERE migration_id=NEW.id AND state!='ready');
 SELECT RAISE(ABORT,'migration_roster') WHERE EXISTS(SELECT 1 FROM app_migration_checks m,json_each(m.roster_json) entry WHERE m.id=NEW.id AND NOT EXISTS(SELECT 1 FROM app_migration_documents d WHERE d.migration_id=m.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.base_revision=json_extract(entry.value,'$.revision')));
END;

CREATE TRIGGER app_migration_approval_update BEFORE UPDATE ON app_migration_approvals WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR NEW.changed_documents!=OLD.changed_documents OR OLD.status!='applying' OR NEW.status!='applied'
 BEGIN SELECT RAISE(ABORT,'migration_approval_immutable'); END;

CREATE TRIGGER app_migration_approval_delete BEFORE DELETE ON app_migration_approvals BEGIN SELECT RAISE(ABORT,'migration_approval_immutable'); END;

CREATE TRIGGER app_migration_approval_apply AFTER INSERT ON app_migration_approvals BEGIN
 UPDATE app_documents SET revision=revision+1,state_json=(SELECT next_json FROM app_migration_documents WHERE migration_id=NEW.id AND visitor_id=app_documents.visitor_id) WHERE visitor_id IN(SELECT visitor_id FROM app_migration_documents WHERE migration_id=NEW.id);
 UPDATE app_spaces SET version_id=(SELECT to_version FROM app_migration_checks WHERE id=NEW.id),revision=revision+1,migration_id=NEW.id WHERE project_id=(SELECT project_id FROM app_migration_checks WHERE id=NEW.id);
 -- Visitor sign-in belongs to the access instance (WH-126); the disabled application and its revision change fence documents.
 UPDATE app_migration_approvals SET status='applied' WHERE id=NEW.id;
END;

CREATE TRIGGER app_rollback_initial_space BEFORE INSERT ON app_spaces WHEN NEW.rollback_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'rollback_initial'); END;

CREATE TRIGGER app_restore_admit BEFORE INSERT ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_initial') WHERE NEW.status!='pending';
 SELECT RAISE(ABORT,'restore_authority') WHERE NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND ((NEW.restore_program=0 AND NEW.from_version IS NULL AND a.version_id=r.version_id) OR (NEW.restore_program=1 AND NEW.from_version=a.version_id AND a.version_id!=r.version_id)) AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
 SELECT RAISE(ABORT,'restore_capacity') WHERE ((SELECT count(*) FROM app_restore_reviews t WHERE t.project_id=NEW.project_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25
  OR (SELECT count(*) FROM app_restore_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=100
  OR (SELECT count(*) FROM app_restore_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=5000
  OR ((SELECT count(*) FROM app_restore_reviews t WHERE t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=2500 AND (SELECT count(*) FROM app_restore_reviews t WHERE t.user_id=NEW.user_id AND t.status='pending' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=25));
END;

CREATE TRIGGER app_restore_immutable BEFORE UPDATE ON app_restore_reviews BEGIN
 SELECT RAISE(ABORT,'restore_immutable') WHERE NEW.restore_program!=OLD.restore_program OR NEW.from_version IS NOT OLD.from_version OR NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.point_id!=OLD.point_id OR NEW.base_revision!=OLD.base_revision OR NEW.roster_json!=OLD.roster_json OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied';
 SELECT RAISE(ABORT,'restore_stale') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points r ON r.project_id=a.project_id AND r.user_id=a.owner_user_id JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE r.id=NEW.point_id AND r.sealed=1 AND a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.revision=NEW.base_revision AND ((NEW.restore_program=0 AND a.version_id=r.version_id) OR (NEW.restore_program=1 AND NEW.from_version=a.version_id AND a.version_id!=r.version_id)) AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'restore_missing_document') WHERE EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.point_id AND d.visitor_id=json_extract(entry.value,'$.visitor')));
END;

CREATE TRIGGER app_restore_apply AFTER UPDATE OF status ON app_restore_reviews BEGIN
 UPDATE app_documents SET revision=revision+1,state_json=(SELECT state_json FROM app_recovery_documents WHERE point_id=NEW.point_id AND visitor_id=app_documents.visitor_id) WHERE visitor_id IN(SELECT json_extract(value,'$.visitor') FROM json_each(NEW.roster_json));
 UPDATE app_spaces SET version_id=(SELECT version_id FROM app_recovery_points WHERE id=NEW.point_id),revision=revision+1,rollback_id=NEW.id WHERE project_id=NEW.project_id AND NEW.restore_program=1;
END;

CREATE TRIGGER app_space_apply_review BEFORE UPDATE ON app_spaces WHEN NOT (
 (NEW.rollback_id IS OLD.rollback_id AND NEW.migration_id IS OLD.migration_id AND EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.id=NEW.review_id AND r.project_id=NEW.project_id AND r.user_id=NEW.owner_user_id AND r.version_id=NEW.version_id AND r.enabled=NEW.enabled AND r.base_revision=OLD.revision AND r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))
 OR (NEW.rollback_id IS OLD.rollback_id AND NEW.enabled=0 AND OLD.enabled=0 AND NEW.review_id IS OLD.review_id AND NEW.migration_id IS NOT OLD.migration_id AND EXISTS(SELECT 1 FROM app_migration_approvals receipt JOIN app_migration_checks m ON m.id=receipt.id WHERE receipt.id=NEW.migration_id AND receipt.user_id=NEW.owner_user_id AND receipt.status='applying' AND m.project_id=NEW.project_id AND m.user_id=NEW.owner_user_id AND m.from_version=OLD.version_id AND m.to_version=NEW.version_id AND m.base_revision=OLD.revision))
 OR (NEW.enabled=0 AND OLD.enabled=0 AND NEW.review_id IS OLD.review_id AND NEW.migration_id IS OLD.migration_id AND NEW.rollback_id IS NOT OLD.rollback_id AND EXISTS(SELECT 1 FROM app_restore_reviews r JOIN app_recovery_points p ON p.id=r.point_id WHERE r.id=NEW.rollback_id AND r.user_id=NEW.owner_user_id AND r.project_id=NEW.project_id AND r.restore_program=1 AND r.status='applied' AND r.from_version=OLD.version_id AND p.version_id=NEW.version_id AND r.base_revision=OLD.revision))
) BEGIN SELECT RAISE(ABORT,'app_activation_required'); END;

CREATE TRIGGER app_rollback_backup_admit BEFORE INSERT ON app_restore_reviews WHEN NEW.restore_program=1 BEGIN
 SELECT RAISE(ABORT,'rollback_backup') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points b WHERE b.id=NEW.id AND b.project_id=NEW.project_id AND b.user_id=NEW.user_id AND b.version_id=NEW.from_version AND b.sealed=1 AND b.removed=0) OR EXISTS(SELECT 1 FROM json_each(NEW.roster_json) entry WHERE NOT EXISTS(SELECT 1 FROM app_recovery_documents d WHERE d.point_id=NEW.id AND d.visitor_id=json_extract(entry.value,'$.visitor') AND d.revision=json_extract(entry.value,'$.revision')));
END;

CREATE TRIGGER app_rollback_backup_confirm BEFORE UPDATE ON app_restore_reviews WHEN NEW.restore_program=1 BEGIN
 SELECT RAISE(ABORT,'rollback_backup') WHERE NOT EXISTS(SELECT 1 FROM app_recovery_points b WHERE b.id=NEW.id AND b.project_id=NEW.project_id AND b.user_id=NEW.user_id AND b.version_id=NEW.from_version AND b.sealed=1 AND b.removed=0);
END;

CREATE TRIGGER app_migration_cancel_admit BEFORE INSERT ON app_migration_cancellations BEGIN
 SELECT RAISE(ABORT,'migration_cancel_owner') WHERE NOT EXISTS(SELECT 1 FROM app_migration_checks m JOIN projects p ON p.id=m.project_id AND p.owner_user_id=m.user_id JOIN app_spaces a ON a.project_id=m.project_id AND a.owner_user_id=m.user_id WHERE m.id=NEW.id AND m.user_id=NEW.user_id);
 SELECT RAISE(ABORT,'migration_already_applied') WHERE EXISTS(SELECT 1 FROM app_migration_approvals WHERE id=NEW.id);
END;

CREATE TRIGGER app_migration_cancel_update BEFORE UPDATE ON app_migration_cancellations BEGIN SELECT RAISE(ABORT,'migration_cancel_immutable'); END;

CREATE TRIGGER app_migration_cancel_delete BEFORE DELETE ON app_migration_cancellations BEGIN SELECT RAISE(ABORT,'migration_cancel_immutable'); END;

CREATE TRIGGER app_migration_cancel_cleanup AFTER INSERT ON app_migration_cancellations BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;

CREATE TRIGGER app_migration_applied_cleanup AFTER UPDATE OF status ON app_migration_approvals WHEN NEW.status='applied' BEGIN DELETE FROM app_migration_documents WHERE migration_id=NEW.id; END;

CREATE TRIGGER app_migration_check_admit BEFORE INSERT ON app_migration_checks BEGIN
 SELECT RAISE(ABORT,'migration_authority') WHERE NEW.to_version=NEW.from_version OR NOT EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id JOIN app_recovery_points b ON b.id=NEW.id AND b.user_id=a.owner_user_id AND b.project_id=a.project_id AND b.version_id=a.version_id AND b.removed=0 AND b.sealed=1 JOIN app_recovery_rosters roster ON roster.project_id=a.project_id WHERE a.project_id=NEW.project_id AND a.owner_user_id=NEW.user_id AND a.enabled=0 AND a.version_id=NEW.from_version AND a.revision=NEW.base_revision AND roster.roster_json=NEW.roster_json);
 SELECT RAISE(ABORT,'migration_version') WHERE NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.to_version AND project_id=NEW.project_id) OR NOT EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.transform_version AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'migration_test') WHERE NOT EXISTS(SELECT 1 FROM backend_runs r WHERE r.id=NEW.test_id AND r.user_id=NEW.user_id AND r.project_id=NEW.project_id AND r.version_id=NEW.to_version AND r.state='complete' AND json_extract(r.result_json,'$.ok')=1 AND json_extract(r.result_json,'$.check.status')='passed' AND json_type(r.result_json,'$.value')='object' AND (SELECT count(*) FROM json_each(r.result_json,'$.value'))=2 AND json_type(r.result_json,'$.value.state') IS NOT NULL AND json_type(r.result_json,'$.value.result') IS NOT NULL AND length(CAST(json_quote(json_extract(r.result_json,'$.value.state')) AS BLOB))<=4096 AND length(CAST(json_quote(json_extract(r.result_json,'$.value.result')) AS BLOB))<=4096);
 SELECT RAISE(ABORT,'migration_capacity') WHERE (SELECT count(*) FROM app_migration_checks m JOIN app_migration_current c ON c.id=m.id WHERE m.project_id=NEW.project_id AND m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))>=5 OR (SELECT count(*) FROM app_migration_current)>=50;
END;

CREATE TRIGGER app_maintenance_chat_link_admit BEFORE INSERT ON app_maintenance_chat_links BEGIN
 SELECT RAISE(ABORT,'maintenance_chat_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.turn_id AND user_id=NEW.user_id);
 SELECT RAISE(ABORT,'maintenance_chat_review') WHERE NOT (
 (NEW.kind='upgrade' AND EXISTS(SELECT 1 FROM app_migration_checks WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
 (NEW.kind='rollback' AND EXISTS(SELECT 1 FROM app_restore_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id AND restore_program=1)));
END;

CREATE TRIGGER app_maintenance_chat_link_update BEFORE UPDATE ON app_maintenance_chat_links BEGIN SELECT RAISE(ABORT,'maintenance_chat_immutable'); END;

CREATE TRIGGER cms_import_media_admit BEFORE INSERT ON cms_import_reviews WHEN
 json_array_length(NEW.media_plan)<>(SELECT count(*) FROM json_each(NEW.body,'$.data.content') WHERE json_extract(value,'$._type')='image') OR
 (NEW.media_plan<>'[]' AND (NEW.source_upload_id IS NULL OR
 EXISTS(SELECT 1 FROM json_each(NEW.media_plan) m WHERE
  json_type(m.value)<>'object' OR (SELECT count(*) FROM json_each(m.value))<>10 OR
  json_type(m.value,'$.position') IS NOT 'integer' OR json_extract(m.value,'$.position')<>m.key OR
  json_type(m.value,'$.sourceAttachmentId') IS NOT 'integer' OR json_extract(m.value,'$.sourceAttachmentId')<1 OR
  json_type(m.value,'$.blockKey') IS NOT 'text' OR json_type(m.value,'$.mediaId') IS NOT 'text' OR
  json_type(m.value,'$.digest') IS NOT 'text' OR json_type(m.value,'$.size') IS NOT 'integer' OR json_type(m.value,'$.width') IS NOT 'integer' OR json_type(m.value,'$.height') IS NOT 'integer' OR
  json_type(m.value,'$.sourceURL') IS NULL OR json_type(m.value,'$.sourceURL') NOT IN ('text','null') OR length(json_extract(m.value,'$.sourceURL'))>2048 OR
  json_type(m.value,'$.attachmentURL') IS NULL OR json_type(m.value,'$.attachmentURL') NOT IN ('text','null') OR length(json_extract(m.value,'$.attachmentURL'))>2048 OR
  NOT EXISTS(SELECT 1 FROM json_each(NEW.body,'$.data.content') b WHERE json_extract(b.value,'$._type')='image' AND json_extract(b.value,'$._key')=json_extract(m.value,'$.blockKey') AND json_extract(b.value,'$.asset._ref')=json_extract(m.value,'$.mediaId')) OR
  NOT EXISTS(SELECT 1 FROM cms_media_uploads u JOIN cms_deployments d ON d.project_id=u.project_id WHERE u.user_id=NEW.user_id AND u.project_id=NEW.project_id AND u.origin=d.origin AND d.state='connected' AND u.result IS NOT NULL AND json_extract(u.result,'$.mediaId')=json_extract(m.value,'$.mediaId') AND u.digest=json_extract(m.value,'$.digest') AND u.size=json_extract(m.value,'$.size') AND u.width=json_extract(m.value,'$.width') AND u.height=json_extract(m.value,'$.height'))
 ) OR (SELECT count(DISTINCT json_extract(value,'$.blockKey')) FROM json_each(NEW.media_plan))<>json_array_length(NEW.media_plan)))
BEGIN SELECT RAISE(ABORT,'cms_import_media_invalid'); END;

CREATE TRIGGER cms_import_media_immutable BEFORE UPDATE OF media_plan ON cms_import_reviews WHEN NEW.media_plan<>OLD.media_plan BEGIN SELECT RAISE(ABORT,'cms_import_media_immutable'); END;

CREATE TRIGGER fair_use_review_insert BEFORE INSERT ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'review_must_start_open') WHERE NEW.state!='open' OR NEW.revision!=0;
END;

CREATE TRIGGER fair_use_review_update BEFORE UPDATE ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'immutable_review') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.policy_version IS NOT OLD.policy_version OR NEW.plan_id IS NOT OLD.plan_id OR NEW.category IS NOT OLD.category OR NEW.opened_by IS NOT OLD.opened_by OR NEW.context IS NOT OLD.context OR NEW.created_at IS NOT OLD.created_at;
 SELECT RAISE(ABORT,'review_already_resolved') WHERE OLD.state!='open' OR NEW.state!='resolved' OR NEW.revision!=OLD.revision+1;
END;

CREATE TRIGGER fair_use_review_observation_insert BEFORE INSERT ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'review_observation_required') WHERE NEW.observation_json IS NULL
  OR json_extract(NEW.observation_json,'$.version') IS NOT 1
  OR json_extract(NEW.observation_json,'$.entitlement.planId') IS NOT NEW.plan_id
  OR json_type(NEW.observation_json,'$.metrics') IS NOT 'object'
  OR json_type(NEW.observation_json,'$.asOf') IS NOT 'text';
END;

CREATE TRIGGER fair_use_review_observation_update BEFORE UPDATE ON fair_use_reviews BEGIN
 SELECT RAISE(ABORT,'immutable_review_observation') WHERE NEW.observation_json IS NOT OLD.observation_json;
END;

CREATE TRIGGER backend_nomination_insert BEFORE INSERT ON backend_nominations BEGIN
 SELECT RAISE(ABORT,'nomination_requires_review') WHERE NEW.state!='review';
 SELECT RAISE(ABORT,'nomination_owner_or_digest') WHERE NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.owner_user_id=NEW.user_id AND v.digest=NEW.digest);
 SELECT RAISE(ABORT,'nomination_capacity') WHERE ((SELECT count(*) FROM backend_nominations t WHERE t.user_id=NEW.user_id AND (t.state='nominated' OR (t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))>=5
  OR (SELECT count(*) FROM backend_nominations t WHERE (t.state='nominated' OR (t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))>=5000
  OR ((SELECT count(*) FROM backend_nominations t WHERE (t.state='nominated' OR (t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))>=2500 AND (SELECT count(*) FROM backend_nominations t WHERE t.user_id=NEW.user_id AND (t.state='nominated' OR (t.state='review' AND t.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))))>=25));
 SELECT RAISE(ABORT,'nomination_already_open') WHERE EXISTS(SELECT 1 FROM backend_nominations WHERE user_id=NEW.user_id AND version_id=NEW.version_id AND (state='nominated' OR (state='review' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))));
END;

CREATE TRIGGER backend_nomination_update BEFORE UPDATE ON backend_nominations BEGIN
 SELECT RAISE(ABORT,'nomination_immutable') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.version_id IS NOT OLD.version_id OR NEW.digest IS NOT OLD.digest OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at;
 SELECT RAISE(ABORT,'nomination_transition') WHERE NOT ((OLD.state='review' AND NEW.state='nominated' AND OLD.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) OR (OLD.state IN ('review','nominated') AND NEW.state='withdrawn' AND NEW.consent_at IS OLD.consent_at));
 SELECT RAISE(ABORT,'nomination_owner_or_digest') WHERE NOT EXISTS(SELECT 1 FROM backend_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=NEW.version_id AND p.owner_user_id=NEW.user_id AND v.digest=NEW.digest);
END;

CREATE TRIGGER standard_ai_insert BEFORE INSERT ON standard_ai_requests
WHEN NEW.state!='reserved' OR NEW.input_tokens IS NOT NULL OR NEW.output_tokens IS NOT NULL
BEGIN SELECT RAISE(ABORT,'standard_ai_initial'); END;

CREATE TRIGGER standard_ai_update BEFORE UPDATE ON standard_ai_requests
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.request_hash!=OLD.request_hash OR NEW.created_at!=OLD.created_at
 OR NOT ((OLD.state='reserved' AND NEW.state IN ('dispatched','released'))
 OR (OLD.state='dispatched' AND NEW.state IN ('completed','uncertain'))
 OR (OLD.state='uncertain' AND NEW.state='completed'))
BEGIN SELECT RAISE(ABORT,'standard_ai_transition'); END;

CREATE TRIGGER chat_private_context BEFORE UPDATE OF ai_context_allowed ON chat_turns
WHEN OLD.ai_context_allowed=0 AND NEW.ai_context_allowed!=0
BEGIN SELECT RAISE(ABORT,'private_chat_context'); END;

CREATE TRIGGER usage_review_insert BEFORE INSERT ON usage_review_requests BEGIN
 SELECT RAISE(ABORT,'usage_review_initial') WHERE NEW.state!='open' OR NEW.customer_read_at IS NOT NULL OR NOT (
  (NEW.source='chat' AND EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND t.status='completed' AND t.ai_context_allowed=0))
  OR (NEW.source='support' AND NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id) AND NOT EXISTS(SELECT 1 FROM chat_interaction_submissions s WHERE s.id=NEW.id))
  -- WH-035 Chat help intake: only the owner's own explicit submission of the maintained support form, with its exact statement.
  OR (NEW.source='chat_form' AND EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id AND i.user_id=s.user_id
   WHERE s.id=NEW.id AND s.user_id=NEW.user_id AND i.project_id IS NULL AND i.state='submitted'
    AND json_extract(i.envelope_json,'$.definition.template')='support-request@1' AND json_extract(s.answers_json,'$.statement')=NEW.statement)));
END;

CREATE TRIGGER usage_review_update BEFORE UPDATE ON usage_review_requests BEGIN
 SELECT RAISE(ABORT,'usage_review_immutable') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.kind IS NOT OLD.kind OR NEW.source IS NOT OLD.source OR NEW.reference IS NOT OLD.reference OR NEW.statement IS NOT OLD.statement OR NEW.created_at IS NOT OLD.created_at OR NOT (
  (OLD.state='open' AND NEW.state='answered' AND NEW.customer_read_at IS NULL)
  OR (OLD.state='answered' AND NEW.state='answered' AND OLD.customer_read_at IS NULL AND NEW.customer_read_at IS NOT NULL AND NEW.public_response IS OLD.public_response AND NEW.answered_by IS OLD.answered_by AND NEW.answered_at IS OLD.answered_at));
END;

CREATE TRIGGER usage_review_delete BEFORE DELETE ON usage_review_requests
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'usage_review_immutable'); END;

CREATE TRIGGER contact_destination_insert BEFORE INSERT ON contact_notification_destinations BEGIN
 SELECT RAISE(ABORT,'contact_destination_initial') WHERE NEW.state!='unverified' OR NEW.verification_code IS NOT NULL OR NEW.verification_failures!=0 OR NEW.verified_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'contact_destination_suppressed') WHERE EXISTS(SELECT 1 FROM contact_notification_suppressions WHERE user_id=NEW.user_id AND address=NEW.address);
END;

CREATE TRIGGER contact_destination_update BEFORE UPDATE ON contact_notification_destinations BEGIN
 SELECT RAISE(ABORT,'contact_destination_final') WHERE OLD.state='suppressed' OR NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.project_id IS NOT OLD.project_id OR NEW.address IS NOT OLD.address OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.state='verified' AND NEW.state NOT IN ('verified','suppressed')) OR (OLD.state='verified' AND NEW.state='verified' AND (NEW.verified_at IS NOT OLD.verified_at OR NEW.verification_code IS NOT NULL));
END;

CREATE TRIGGER contact_suppression_immutable BEFORE UPDATE ON contact_notification_suppressions BEGIN SELECT RAISE(ABORT,'contact_suppression_final'); END;
CREATE TRIGGER contact_suppression_delete BEFORE DELETE ON contact_notification_suppressions
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND NOT EXISTS(SELECT 1 FROM contact_notification_suppression_resets r WHERE r.user_id=OLD.user_id AND r.address=OLD.address AND r.suppressed_at=OLD.created_at)
BEGIN SELECT RAISE(ABORT,'contact_suppression_final'); END;

-- An operator reset must name the exact current suppression; it removes that suppression and the final-suppressed destination
-- (refused inside a safety preservation hold by safety_hold_contact_destination_retained). The owner then sets and verifies again.
CREATE TRIGGER contact_suppression_reset_insert BEFORE INSERT ON contact_notification_suppression_resets BEGIN
 SELECT RAISE(ABORT,'contact_suppression_reset_stale') WHERE NOT EXISTS(SELECT 1 FROM contact_notification_suppressions WHERE user_id=NEW.user_id AND address=NEW.address AND created_at=NEW.suppressed_at AND reason=NEW.suppression_reason);
END;
CREATE TRIGGER contact_suppression_reset_immutable BEFORE UPDATE ON contact_notification_suppression_resets BEGIN SELECT RAISE(ABORT,'contact_suppression_reset_final'); END;
CREATE TRIGGER contact_suppression_reset_apply AFTER INSERT ON contact_notification_suppression_resets BEGIN
 DELETE FROM contact_notification_destinations WHERE user_id=NEW.user_id AND address=NEW.address AND state='suppressed';
 DELETE FROM contact_notification_suppressions WHERE user_id=NEW.user_id AND address=NEW.address AND created_at=NEW.suppressed_at;
END;

CREATE TRIGGER contact_destination_review_insert BEFORE INSERT ON contact_destination_reviews BEGIN
 SELECT RAISE(ABORT,'contact_destination_review_changed') WHERE NEW.status!='pending' OR NEW.confirmed_by IS NOT NULL OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
END;
CREATE TRIGGER contact_destination_review_identity BEFORE UPDATE ON contact_destination_reviews
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.address!=OLD.address OR NEW.expires_at!=OLD.expires_at OR OLD.status!='pending' OR NEW.status!='applied' OR NEW.confirmed_by IS NULL
BEGIN SELECT RAISE(ABORT,'contact_destination_review_changed'); END;
CREATE TRIGGER contact_destination_review_confirm BEFORE UPDATE ON contact_destination_reviews BEGIN
 SELECT RAISE(ABORT,'contact_destination_review_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id) OR NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='contactNotification' AND json_extract(action_json,'$.reviewId')=NEW.id);
 SELECT RAISE(ABORT,'contact_destination_suppressed') WHERE EXISTS(SELECT 1 FROM contact_notification_suppressions WHERE user_id=NEW.user_id AND address=NEW.address) OR EXISTS(SELECT 1 FROM contact_notification_destinations WHERE project_id=NEW.project_id AND state='suppressed');
END;
-- The same address keeps its current state; a different address replaces the destination (its queued notices cascade) and starts unverified.
CREATE TRIGGER contact_destination_review_apply AFTER UPDATE ON contact_destination_reviews BEGIN
 DELETE FROM contact_notification_destinations WHERE project_id=NEW.project_id AND address!=NEW.address;
 INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) SELECT NEW.id,NEW.user_id,NEW.project_id,NEW.address,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM contact_notification_destinations WHERE project_id=NEW.project_id);
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('contact-notify:'||NEW.id,NEW.user_id,NEW.project_id,'contact.notifications','Set the reviewed contact notification address (verification required)',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

-- Suppression is atomic with its effect: the destination becomes final-suppressed and unsent notices are cancelled.
CREATE TRIGGER contact_suppression_apply AFTER INSERT ON contact_notification_suppressions BEGIN
 UPDATE contact_notification_destinations SET state='suppressed',verification_code=NULL,verification_expires_at=NULL WHERE user_id=NEW.user_id AND address=NEW.address AND state!='suppressed';
END;

CREATE TRIGGER backend_import_owner BEFORE INSERT ON backend_imports WHEN NOT EXISTS(
 SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id
) OR EXISTS(SELECT 1 FROM backend_versions WHERE id=NEW.id) OR NEW.state!='pending'
 BEGIN SELECT RAISE(ABORT,'backend_import_owner'); END;

CREATE TRIGGER backend_import_quota BEFORE INSERT ON backend_imports WHEN
 (SELECT count(*) FROM backend_imports WHERE project_id=NEW.project_id)>=25 OR
 (SELECT count(*) FROM backend_imports WHERE user_id=NEW.user_id)>=100 OR
 (SELECT count(*) FROM backend_imports)>=1000
 BEGIN SELECT RAISE(ABORT,'backend_import_quota'); END;

CREATE TRIGGER backend_import_immutable BEFORE UPDATE ON backend_imports WHEN
 NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR
 NEW.source!=OLD.source OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR
 NEW.created_at!=OLD.created_at OR OLD.state!='pending' OR NEW.state='pending'
 BEGIN SELECT RAISE(ABORT,'backend_import_immutable'); END;

CREATE TRIGGER backend_import_not_executable BEFORE INSERT ON backend_versions WHEN
 EXISTS(SELECT 1 FROM backend_imports WHERE id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'backend_import_quarantined'); END;

CREATE TRIGGER profile_photo_safety_owner BEFORE INSERT ON profile_photo_safety WHEN
 NEW.state!='pending' OR NEW.csam_check!='unknown' OR NEW.sexual_check!='unknown' OR
 NEW.scanner_reference IS NOT NULL OR NEW.expires_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM user_profiles WHERE user_id=NEW.user_id AND photo IS NOT NULL AND photo_digest=NEW.digest AND revision=NEW.photo_revision
) BEGIN SELECT RAISE(ABORT,'profile_photo_safety_owner'); END;

CREATE TRIGGER profile_photo_safety_invalidate AFTER UPDATE ON user_profiles WHEN
 NEW.photo IS NOT OLD.photo OR NEW.photo_digest IS NOT OLD.photo_digest
 BEGIN DELETE FROM profile_photo_safety WHERE user_id=NEW.user_id; END;

CREATE TRIGGER project_photo_safety_owner BEFORE INSERT ON project_photo_safety WHEN
 NEW.state!='pending' OR NEW.csam_check!='unknown' OR NEW.sexual_check!='unknown' OR NEW.scanner_reference IS NOT NULL OR NEW.expires_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=NEW.file_id AND f.digest=NEW.digest AND p.owner_user_id=NEW.user_id AND f.status='ready'
) BEGIN SELECT RAISE(ABORT,'project_photo_safety_owner'); END;

CREATE TRIGGER project_photo_safety_ready AFTER UPDATE OF status ON project_files WHEN NEW.status='ready' AND OLD.status!='ready'
 BEGIN INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version) SELECT NEW.id,owner_user_id,NEW.digest,'2026-09-30' FROM projects WHERE id=NEW.project_id; END;

CREATE TRIGGER project_photo_safety_insert AFTER INSERT ON project_files WHEN NEW.status='ready'
 BEGIN INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version) SELECT NEW.id,owner_user_id,NEW.digest,'2026-09-30' FROM projects WHERE id=NEW.project_id; END;

CREATE TRIGGER version_photo_safety BEFORE INSERT ON version_photos WHEN NOT EXISTS(
 SELECT 1 FROM approved_project_photos WHERE id=NEW.file_id
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;

CREATE TRIGGER publication_photo_safety_insert BEFORE INSERT ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM version_photos vp WHERE vp.version_id=NEW.version_id AND NOT EXISTS(SELECT 1 FROM approved_project_photos WHERE id=vp.file_id)
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;

CREATE TRIGGER publication_photo_safety_update BEFORE UPDATE OF version_id ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(
 SELECT 1 FROM version_photos vp WHERE vp.version_id=NEW.version_id AND NOT EXISTS(SELECT 1 FROM approved_project_photos WHERE id=vp.file_id)
) BEGIN SELECT RAISE(ABORT,'photo_safety_required'); END;

CREATE TRIGGER photo_scan_ticket_owner BEFORE INSERT ON photo_scan_tickets WHEN
 NEW.state!='reserved' OR julianday(NEW.expires_at)<=julianday('now') OR julianday(NEW.expires_at)>julianday('now','+1 hour') OR julianday(NEW.expires_at) IS NULL OR NOT (
 (NEW.kind='profile' AND NEW.subject_id=NEW.user_id AND EXISTS(SELECT 1 FROM profile_photo_safety s JOIN user_profiles p ON p.user_id=s.user_id AND p.photo_digest=s.digest WHERE s.user_id=NEW.user_id AND s.digest=NEW.digest AND s.policy_version=NEW.policy_version AND s.state='pending')) OR
 (NEW.kind='project' AND EXISTS(SELECT 1 FROM project_photo_safety s JOIN project_files f ON f.id=s.file_id AND f.digest=s.digest JOIN projects p ON p.id=f.project_id AND p.owner_user_id=s.user_id WHERE s.file_id=NEW.subject_id AND s.user_id=NEW.user_id AND s.digest=NEW.digest AND s.policy_version=NEW.policy_version AND s.state='pending')) OR
 (NEW.kind='cms' AND EXISTS(SELECT 1 FROM cms_media_safety s JOIN cms_media_uploads u ON u.id=s.upload_id AND u.digest=s.digest AND u.user_id=s.user_id AND u.project_id=s.project_id JOIN projects p ON p.id=u.project_id AND p.owner_user_id=s.user_id WHERE s.upload_id=NEW.subject_id AND s.user_id=NEW.user_id AND s.digest=NEW.digest AND s.policy_version=NEW.policy_version AND s.state='pending' AND u.result IS NOT NULL))
) BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_owner'); END;

CREATE TRIGGER photo_scan_ticket_quota BEFORE INSERT ON photo_scan_tickets WHEN
 (SELECT count(*) FROM photo_scan_tickets)>=5000 OR
 (SELECT count(*) FROM photo_scan_tickets WHERE user_id=NEW.user_id)>=100
 BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_quota'); END;

CREATE TRIGGER photo_scan_ticket_immutable BEFORE UPDATE ON photo_scan_tickets WHEN
 NEW.id!=OLD.id OR NEW.kind!=OLD.kind OR NEW.subject_id!=OLD.subject_id OR NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.authority_hash!=OLD.authority_hash OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at OR OLD.state!='reserved' OR NEW.state NOT IN ('completed','stale')
 BEGIN SELECT RAISE(ABORT,'photo_scan_ticket_immutable'); END;

CREATE TRIGGER profile_photo_safety_immutable BEFORE UPDATE ON profile_photo_safety WHEN
 NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.photo_revision!=OLD.photo_revision OR NEW.policy_version!=OLD.policy_version OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.state='pending' AND NEW.state IN ('approved','blocked')) OR (OLD.state='approved' AND NEW.state='blocked') OR (OLD.state='approved' AND NEW.state='pending' AND julianday(OLD.expires_at)<=julianday('now') AND NEW.csam_check='unknown' AND NEW.sexual_check='unknown' AND NEW.scanner_reference IS NULL AND NEW.expires_at IS NULL))
 BEGIN SELECT RAISE(ABORT,'profile_photo_safety_immutable'); END;

CREATE TRIGGER project_photo_safety_immutable BEFORE UPDATE ON project_photo_safety WHEN
 NEW.file_id!=OLD.file_id OR NEW.user_id!=OLD.user_id OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.state='pending' AND NEW.state IN ('approved','blocked')) OR (OLD.state='approved' AND NEW.state='blocked') OR (OLD.state='approved' AND NEW.state='pending' AND julianday(OLD.expires_at)<=julianday('now') AND NEW.csam_check='unknown' AND NEW.sexual_check='unknown' AND NEW.scanner_reference IS NULL AND NEW.expires_at IS NULL))
 BEGIN SELECT RAISE(ABORT,'project_photo_safety_immutable'); END;

CREATE TRIGGER cms_media_safety_owner BEFORE INSERT ON cms_media_safety WHEN
 NEW.state!='pending' OR NEW.csam_check!='unknown' OR NEW.sexual_check!='unknown' OR NEW.scanner_reference IS NOT NULL OR NEW.expires_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM cms_media_uploads u JOIN projects p ON p.id=u.project_id WHERE u.id=NEW.upload_id AND u.user_id=NEW.user_id AND u.project_id=NEW.project_id AND u.digest=NEW.digest AND p.owner_user_id=NEW.user_id
) BEGIN SELECT RAISE(ABORT,'cms_media_safety_owner'); END;

-- Every receipt starts held. There is no customer, model or upload path that can approve it.
CREATE TRIGGER cms_media_safety_insert AFTER INSERT ON cms_media_uploads
 BEGIN INSERT INTO cms_media_safety(upload_id,user_id,project_id,digest,policy_version) VALUES(NEW.id,NEW.user_id,NEW.project_id,NEW.digest,'2026-09-30'); END;

CREATE TRIGGER cms_media_safety_immutable BEFORE UPDATE ON cms_media_safety WHEN
 NEW.upload_id!=OLD.upload_id OR NEW.user_id!=OLD.user_id OR NEW.project_id!=OLD.project_id OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.created_at!=OLD.created_at OR
 NOT ((OLD.state='pending' AND NEW.state IN ('approved','blocked')) OR (OLD.state='approved' AND NEW.state='blocked') OR (OLD.state='approved' AND NEW.state='pending' AND julianday(OLD.expires_at)<=julianday('now') AND NEW.csam_check='unknown' AND NEW.sexual_check='unknown' AND NEW.scanner_reference IS NULL AND NEW.expires_at IS NULL))
 BEGIN SELECT RAISE(ABORT,'cms_media_safety_immutable'); END;

CREATE TRIGGER cms_media_safety_retained BEFORE DELETE ON cms_media_safety WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'cms_media_safety_retained'); END;

CREATE TRIGGER content_screening_insert BEFORE INSERT ON content_screening_decisions WHEN
 NEW.first_required!=NEW.required OR NEW.escalation_reason IS NOT NULL OR NEW.escalated_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'content_screening_initial'); END;

CREATE TRIGGER content_screening_immutable BEFORE UPDATE ON content_screening_decisions WHEN
 NEW.user_id!=OLD.user_id OR NEW.kind!=OLD.kind OR NEW.digest!=OLD.digest OR NEW.policy_version!=OLD.policy_version OR NEW.first_required!=OLD.first_required OR NEW.first_reason!=OLD.first_reason OR NEW.first_percent!=OLD.first_percent OR NEW.first_risk_score!=OLD.first_risk_score OR NEW.created_at!=OLD.created_at OR OLD.required!=0 OR NEW.required!=1
 BEGIN SELECT RAISE(ABORT,'content_screening_immutable'); END;

CREATE TRIGGER content_screening_capacity BEFORE INSERT ON content_screening_decisions WHEN
 (SELECT count(*) FROM content_screening_decisions WHERE user_id=NEW.user_id)>=10000 OR
 (SELECT count(*) FROM content_screening_decisions)>=100000
 BEGIN SELECT RAISE(ABORT,'content_screening_capacity'); END;

CREATE TRIGGER content_risk_evidence_admit BEFORE INSERT ON content_risk_evidence BEGIN
 SELECT RAISE(ABORT,'risk_event_future') WHERE NEW.occurred_at>unixepoch('now')*1000+999;
 SELECT RAISE(ABORT,'risk_event_capacity') WHERE (SELECT count(*) FROM content_risk_evidence WHERE user_id=NEW.user_id)>=10000 OR (SELECT count(*) FROM content_risk_evidence)>=100000;
END;

CREATE TRIGGER content_risk_evidence_immutable BEFORE UPDATE ON content_risk_evidence BEGIN SELECT RAISE(ABORT,'risk_event_immutable'); END;

CREATE TRIGGER content_risk_evidence_retained BEFORE DELETE ON content_risk_evidence WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'risk_event_retained'); END;

CREATE TRIGGER content_risk_reversal_admit BEFORE INSERT ON content_risk_reversals WHEN NOT EXISTS(SELECT 1 FROM content_risk_evidence WHERE user_id=NEW.user_id AND incident_id=NEW.incident_id) BEGIN SELECT RAISE(ABORT,'risk_incident_missing'); END;

CREATE TRIGGER content_risk_reversal_immutable BEFORE UPDATE ON content_risk_reversals BEGIN SELECT RAISE(ABORT,'risk_reversal_immutable'); END;

CREATE TRIGGER content_risk_reversal_retained BEFORE DELETE ON content_risk_reversals WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'risk_reversal_retained'); END;

CREATE TRIGGER github_revocation_health_insert AFTER INSERT ON github_token_vault WHEN NEW.state='revoking'
BEGIN INSERT OR IGNORE INTO github_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

CREATE TRIGGER github_revocation_health_update AFTER UPDATE OF state ON github_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO github_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

CREATE TRIGGER cloudflare_revocation_health_insert AFTER INSERT ON cloudflare_token_vault WHEN NEW.state='revoking'
BEGIN INSERT OR IGNORE INTO cloudflare_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

CREATE TRIGGER cloudflare_revocation_health_update AFTER UPDATE OF state ON cloudflare_token_vault WHEN NEW.state='revoking' AND OLD.state!='revoking'
BEGIN INSERT OR IGNORE INTO cloudflare_revocation_health VALUES(NEW.id,strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;

CREATE TRIGGER chat_review_receipt_admit BEFORE INSERT ON chat_review_receipts BEGIN
 SELECT RAISE(ABORT,'chat_review_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.turn_id AND user_id=NEW.user_id);
 SELECT RAISE(ABORT,'chat_review_missing') WHERE NOT (
  (NEW.kind='githubGrant' AND EXISTS(SELECT 1 FROM github_grant_revocations WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='application' AND EXISTS(SELECT 1 FROM app_activation_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='appPage' AND EXISTS(SELECT 1 FROM app_page_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='appRestore' AND EXISTS(SELECT 1 FROM app_restore_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id AND restore_program=0)) OR
  (NEW.kind='backendPublication' AND EXISTS(SELECT 1 FROM backend_publication_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='backendForm' AND EXISTS(SELECT 1 FROM backend_form_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='directory' AND EXISTS(SELECT 1 FROM directory_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='contactNotification' AND EXISTS(SELECT 1 FROM contact_destination_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='backendState' AND EXISTS(SELECT 1 FROM backend_state_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='cmsImport' AND EXISTS(SELECT 1 FROM cms_import_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='cmsDiscard' AND EXISTS(SELECT 1 FROM cms_discard_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='cmsUnpublish' AND EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='cmsPublish' AND EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='cmsSetup' AND EXISTS(SELECT 1 FROM cms_setup_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='backup' AND EXISTS(SELECT 1 FROM github_backups WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='dns' AND EXISTS(SELECT 1 FROM cloudflare_dns_actions WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='hosting' AND EXISTS(SELECT 1 FROM domain_connections WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='backendNomination' AND EXISTS(SELECT 1 FROM backend_nominations WHERE id=NEW.review_id AND user_id=NEW.user_id)) OR
  (NEW.kind='notificationConfiguration' AND EXISTS(SELECT 1 FROM notification_configuration_reviews WHERE id=NEW.review_id AND user_id=NEW.user_id))
 );
END;

CREATE TRIGGER chat_review_receipt_immutable BEFORE UPDATE ON chat_review_receipts BEGIN SELECT RAISE(ABORT,'chat_review_immutable'); END;

CREATE TRIGGER composition_backend_added AFTER INSERT ON backend_versions BEGIN UPDATE projects SET backend_revision=backend_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER composition_backend_removed AFTER DELETE ON backend_versions BEGIN UPDATE projects SET backend_revision=backend_revision+1 WHERE id=OLD.project_id; END;

CREATE TRIGGER composition_plan_admit BEFORE INSERT ON composition_plans BEGIN
 SELECT RAISE(ABORT,'composition_plan_owner') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.status='pending' AND t.mode='ai'
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.details_revision=NEW.details_revision
  AND p.backend_revision=NEW.backend_revision AND (SELECT count(*) FROM backend_versions WHERE project_id=p.id)=NEW.backend_count
 );
 SELECT RAISE(ABORT,'composition_plan_quota') WHERE ((SELECT count(*) FROM composition_plans t WHERE t.project_id=NEW.project_id AND t.expires_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id))>=25
  OR (SELECT count(*) FROM composition_plans t WHERE t.user_id=NEW.user_id AND t.expires_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id))>=100
  OR (SELECT count(*) FROM composition_plans t WHERE t.expires_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id))>=5000
  OR ((SELECT count(*) FROM composition_plans t WHERE t.expires_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id))>=2500 AND (SELECT count(*) FROM composition_plans t WHERE t.user_id=NEW.user_id AND t.expires_at>unixepoch() AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id))>=25));
END;

CREATE TRIGGER composition_plan_immutable BEFORE UPDATE ON composition_plans BEGIN SELECT RAISE(ABORT,'composition_plan_immutable'); END;

CREATE TRIGGER backend_extension_admit BEFORE INSERT ON backend_extension_uses BEGIN
 SELECT RAISE(ABORT,'composition_plan_changed') WHERE NOT EXISTS(
  SELECT 1 FROM composition_plans c JOIN projects p ON p.id=c.project_id AND p.owner_user_id=c.user_id
  JOIN backend_versions v ON v.id=NEW.version_id AND v.project_id=p.id
  JOIN chat_turns t ON t.id=v.id AND t.user_id=c.user_id AND t.status='pending' AND t.mode='ai'
  WHERE c.id=NEW.plan_id AND c.extension_scope!='none' AND c.expires_at>unixepoch()
  AND p.details_revision=c.details_revision AND p.backend_revision=c.backend_revision+1
  AND (SELECT count(*) FROM backend_versions WHERE project_id=p.id AND id!=v.id)=c.backend_count
 );
END;

CREATE TRIGGER backend_extension_immutable BEFORE UPDATE ON backend_extension_uses BEGIN SELECT RAISE(ABORT,'composition_plan_immutable'); END;

CREATE TRIGGER backend_extension_retain BEFORE DELETE ON backend_extension_uses WHEN EXISTS(SELECT 1 FROM backend_versions WHERE id=OLD.version_id)
 BEGIN SELECT RAISE(ABORT,'composition_plan_retained'); END;

CREATE TRIGGER specification_site_added AFTER INSERT ON site_versions BEGIN UPDATE projects SET site_draft_revision=site_draft_revision+1 WHERE id=NEW.project_id; END;

CREATE TRIGGER project_spec_proposal_admit BEFORE INSERT ON project_spec_proposals BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id
   AND ((t.status='pending' AND (t.mode='ai' OR (t.mode='guided' AND EXISTS(
    SELECT 1 FROM chat_interaction_continuations c JOIN chat_interaction_submissions s ON s.id=c.id
    JOIN chat_interactions i ON i.id=s.interaction_id AND i.user_id=s.user_id
    WHERE c.id=t.id AND c.state='pending' AND s.user_id=t.user_id AND i.project_id=NEW.project_id AND i.state='submitted'
    AND json_extract(i.envelope_json,'$.definition.continuationBinding') IN ('site.content-prepare@1','agent.task-continue@1')))))
   -- WH-126 owner visitor access setup: the typed accessModuleReview control of this project prepares a change.
   OR (t.mode='guided' AND t.status='completed' AND NEW.operation='change' AND json_extract(t.action_json,'$.type')='accessModuleReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id)
   -- WH-128 owner photo collection setup: the typed filesModuleReview control of this project prepares a change.
   OR (t.mode='guided' AND t.status='completed' AND NEW.operation='change' AND json_extract(t.action_json,'$.type')='filesModuleReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id)
   -- WH-070 owner appointment form setup: the typed appointmentFormReview control of this project prepares a change.
   OR (t.mode='guided' AND t.status='completed' AND NEW.operation='change' AND json_extract(t.action_json,'$.type')='appointmentFormReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id)
   -- WH-128 published gallery: the typed galleryPageReview control of this project prepares a change.
   OR (t.mode='guided' AND t.status='completed' AND NEW.operation='change' AND json_extract(t.action_json,'$.type')='galleryPageReview' AND json_extract(t.action_json,'$.projectId')=NEW.project_id)
   -- WH-091 brand kits and saved sections: the typed brandKitReview, brandRemoveReview and savedSectionReview controls of this project prepare a change.
   OR (t.mode='guided' AND t.status='completed' AND NEW.operation='change' AND json_extract(t.action_json,'$.type') IN('brandKitReview','brandRemoveReview','savedSectionReview') AND json_extract(t.action_json,'$.projectId')=NEW.project_id))
  LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN project_spec_versions v ON v.version_id=h.version_id
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.site_draft_revision=NEW.draft_revision
  AND coalesce(h.revision,0)=NEW.expected_revision AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND (NEW.operation!='change' OR h.draft_revision=p.site_draft_revision)
 );
 SELECT RAISE(ABORT,'specification_changed') WHERE NEW.target_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.target_version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'specification_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM content_screening_decisions WHERE user_id=NEW.user_id AND kind='generated_artifact' AND required=1 AND digest IN (NEW.spec_digest,NEW.manifest_digest,NEW.html_digest));
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM project_spec_held WHERE version_id IN(NEW.base_version_id,NEW.target_version_id));
 SELECT RAISE(ABORT,'specification_quota') WHERE (SELECT count(*) FROM project_spec_proposals WHERE project_id=NEW.project_id)>=50 OR (SELECT count(*) FROM project_spec_proposals)>=4000;
END;

CREATE TRIGGER project_spec_proposal_immutable BEFORE UPDATE ON project_spec_proposals BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;

-- WH-126 owner visitor access setup. A proposal prepared by the typed accessModuleReview control is exactly the current
-- head plus one appended standard access instance (id visitors, no dependencies, no staff role, invitation enrollment)
-- in a project whose head has no access instance; nothing else in the specification may change.
CREATE TRIGGER project_spec_access_setup_admit BEFORE INSERT ON project_spec_proposals
WHEN EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND json_extract(t.action_json,'$.type')='accessModuleReview') BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=h.project_id
  WHERE h.project_id=NEW.project_id AND h.version_id IS NEW.base_version_id AND v.spec_digest IS NEW.base_digest
  AND json_array_length(NEW.spec_json,'$.instances')=json_array_length(v.spec_json,'$.instances')+1
  AND json(json_remove(NEW.spec_json,'$.instances[#-1]'))=json(v.spec_json)
  AND NOT EXISTS(SELECT 1 FROM json_each(v.spec_json,'$.instances') e WHERE json_extract(e.value,'$.kind')='access')
  AND json_extract(NEW.spec_json,'$.instances[#-1].id')='visitors' AND json_extract(NEW.spec_json,'$.instances[#-1].kind')='access'
  AND json_array_length(NEW.spec_json,'$.instances[#-1].dependencies')=0 AND json_array_length(NEW.spec_json,'$.instances[#-1].config.roles')=0
  AND json_extract(NEW.spec_json,'$.instances[#-1].config.enrollment')='invitation'
 );
END;


CREATE TRIGGER project_spec_version_immutable BEFORE UPDATE ON project_spec_versions BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;

CREATE TRIGGER project_spec_apply_immutable BEFORE UPDATE ON project_spec_applies BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;

CREATE TRIGGER project_spec_head_update BEFORE UPDATE ON project_spec_heads BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NEW.project_id!=OLD.project_id OR NEW.revision!=OLD.revision+1 OR NOT EXISTS(SELECT 1 FROM project_spec_applies a JOIN projects p ON p.id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id=NEW.version_id AND a.revision=NEW.revision AND p.site_draft_revision=NEW.draft_revision);
END;

CREATE TRIGGER project_spec_apply AFTER INSERT ON project_spec_applies BEGIN
 INSERT INTO project_spec_heads(project_id,revision,version_id,draft_revision) SELECT NEW.project_id,NEW.revision,NEW.version_id,site_draft_revision FROM projects WHERE id=NEW.project_id
 ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,version_id=excluded.version_id,draft_revision=excluded.draft_revision;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('specification:'||NEW.id,NEW.user_id,NEW.project_id,'site.specification.applied','Saved a reviewed private website version',NEW.created_at);
END;

CREATE TRIGGER project_spec_link_admit BEFORE INSERT ON project_spec_chat_links BEGIN
 SELECT RAISE(ABORT,'specification_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN project_spec_proposals q ON q.user_id=t.user_id JOIN projects p ON p.id=q.project_id AND p.owner_user_id=t.user_id WHERE t.id=NEW.turn_id AND q.id=NEW.proposal_id);
END;

CREATE TRIGGER project_spec_link_immutable BEFORE UPDATE ON project_spec_chat_links BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;

CREATE TRIGGER project_spec_version_retained BEFORE DELETE ON site_versions WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) BEGIN
 SELECT RAISE(ABORT,'version_removal_specification') WHERE EXISTS(SELECT 1 FROM project_spec_heads WHERE version_id=OLD.id);
 SELECT RAISE(ABORT,'version_removal_specification') WHERE EXISTS(SELECT 1 FROM project_spec_proposals q WHERE (q.base_version_id=OLD.id OR q.target_version_id=OLD.id) AND q.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM project_spec_applies WHERE proposal_id=q.id));
END;

CREATE TRIGGER project_spec_forget_deleted AFTER DELETE ON site_versions BEGIN
 DELETE FROM project_spec_proposals WHERE base_version_id=OLD.id OR target_version_id=OLD.id OR id IN(SELECT proposal_id FROM project_spec_applies WHERE version_id=OLD.id);
END;

CREATE TRIGGER specification_publication_insert BEFORE INSERT ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'specification_held'); END;

CREATE TRIGGER specification_publication_update BEFORE UPDATE OF version_id ON publications WHEN NEW.version_id IS NOT NULL AND EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id) BEGIN SELECT RAISE(ABORT,'specification_held'); END;

CREATE TRIGGER project_spec_apply_retained BEFORE DELETE ON project_spec_applies
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
 AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'specification_receipt_retained'); END;

CREATE TRIGGER service_client_proposal_admit BEFORE INSERT ON service_client_proposals BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t JOIN projects p ON p.id=NEW.project_id WHERE t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending' AND p.owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_proposals WHERE project_id=NEW.project_id)>=20 OR (SELECT count(*) FROM service_client_proposals)>=400;
END;

CREATE TRIGGER service_client_proposal_validate AFTER INSERT ON service_client_proposals BEGIN SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_valid_proposals WHERE id=NEW.id); END;

CREATE TRIGGER service_client_proposal_immutable BEFORE UPDATE ON service_client_proposals BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;

CREATE TRIGGER service_client_version_immutable BEFORE UPDATE ON service_client_versions BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;

CREATE TRIGGER service_client_apply_immutable BEFORE UPDATE ON service_client_applies BEGIN SELECT RAISE(ABORT,'service_client_immutable'); END;

CREATE TRIGGER service_client_apply_retained BEFORE DELETE ON service_client_applies WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'service_client_receipt_retained'); END;

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

CREATE TRIGGER service_client_contact_submission BEFORE INSERT ON contact_submissions BEGIN
 SELECT RAISE(ABORT,'contact_unavailable') WHERE EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=NEW.project_id);
END;

CREATE TRIGGER stripe_customer_identity BEFORE UPDATE ON stripe_customers
WHEN NEW.user_id!=OLD.user_id OR NEW.created_at!=OLD.created_at OR (OLD.customer_id IS NOT NULL AND NEW.customer_id IS NOT OLD.customer_id)
BEGIN SELECT RAISE(ABORT,'stripe_customer_identity'); END;

CREATE TRIGGER stripe_order_identity BEFORE UPDATE ON stripe_subscription_orders
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.plan_id!=OLD.plan_id OR NEW.interval!=OLD.interval OR NEW.price_id!=OLD.price_id OR NEW.amount_cents!=OLD.amount_cents OR NEW.created_at!=OLD.created_at
 OR (OLD.session_id IS NOT NULL AND NEW.session_id IS NOT OLD.session_id)
 OR (OLD.subscription_id IS NOT NULL AND NEW.subscription_id IS NOT OLD.subscription_id)
 OR (OLD.state!='pending' AND NEW.state!=OLD.state)
BEGIN SELECT RAISE(ABORT,'stripe_order_identity'); END;

CREATE TRIGGER stripe_invoice_immutable BEFORE UPDATE ON stripe_paid_invoices BEGIN SELECT RAISE(ABORT,'stripe_invoice_immutable'); END;

CREATE TRIGGER publication_chat_link_admit BEFORE INSERT ON publication_chat_links BEGIN
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN publication_actions a ON a.user_id=t.user_id
  JOIN projects p ON p.id=a.project_id AND p.owner_user_id=t.user_id
  JOIN publications s ON s.project_id=p.id AND s.revision=a.expected_revision
  WHERE t.id=NEW.turn_id AND a.id=NEW.review_id AND a.status='pending'
   AND a.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER publication_chat_link_immutable BEFORE UPDATE ON publication_chat_links
 BEGIN SELECT RAISE(ABORT,'publication_changed'); END;

CREATE TRIGGER publication_confirm_guard BEFORE UPDATE ON publication_actions
BEGIN
 SELECT RAISE(ABORT,'publication_expired') WHERE NEW.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT EXISTS(SELECT 1 FROM publications s JOIN projects p ON p.id=s.project_id WHERE s.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND s.revision=NEW.expected_revision);
 -- WH-004 R2: a Chat confirmation is a guided confirm control for this exact review. The only other confirmation is the withdrawal of a site, bound to its own review turn.
 SELECT RAISE(ABORT,'publication_changed') WHERE NOT (NEW.confirmed_by=NEW.id AND NEW.kind='unpublish') AND NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='site' AND json_extract(action_json,'$.reviewId')=NEW.id);
 SELECT RAISE(ABORT,'publication_version') WHERE NEW.kind!='unpublish' AND NOT EXISTS(SELECT 1 FROM site_versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
 SELECT RAISE(ABORT,'published_site_quota') WHERE NEW.kind!='unpublish'
 AND NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL)
 AND (SELECT COUNT(*) FROM publications s JOIN projects p ON p.id=s.project_id WHERE p.owner_user_id=NEW.user_id AND s.version_id IS NOT NULL AND s.project_id!=NEW.project_id)>=COALESCE((SELECT MAX(c.published_sites) FROM plan_entitlements g JOIN plan_catalog c ON c.id=g.plan_id WHERE user_id=NEW.user_id AND starts_at<=unixepoch() AND ends_at>unixepoch()),1);
END;

CREATE TRIGGER app_deletion_review_immutable BEFORE UPDATE ON app_deletion_reviews
 BEGIN SELECT RAISE(ABORT,'app_deletion_review_immutable'); END;

CREATE TRIGGER app_deletion_review_capacity BEFORE INSERT ON app_deletion_reviews
 WHEN (SELECT count(*) FROM app_deletion_reviews)>=5000
 BEGIN SELECT RAISE(ABORT,'app_deletion_review_capacity'); END;

CREATE TRIGGER inference_admit BEFORE INSERT ON inference_calls BEGIN
 SELECT RAISE(ABORT,'inference_owner') WHERE NOT EXISTS(SELECT 1 FROM chat_turns t WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
 AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND substr(s.created_at,1,7)=NEW.period AND s.state IN ('reserved','dispatched')));
 SELECT RAISE(ABORT,'inference_initial') WHERE NEW.status!='reserved';
 SELECT RAISE(ABORT,'inference_budget') WHERE NOT EXISTS(SELECT 1 FROM inference_budgets WHERE user_id=NEW.user_id AND period=NEW.period AND budget_micros-spent_micros-reserved_micros>=NEW.reserved_micros);
 -- Subagent dispatch is not exposed yet. All actual calls use the orchestrator route.
 SELECT RAISE(ABORT,'inference_role_unavailable') WHERE NEW.role NOT IN ('orchestrator','ack');
END;

CREATE TRIGGER agent_inspection_admit BEFORE INSERT ON agent_inspections BEGIN
 SELECT RAISE(ABORT,'agent_inspection_closed') WHERE NOT EXISTS(
  SELECT 1 FROM chat_turns t JOIN inference_calls i ON i.id=t.id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.status='pending'
   AND i.user_id=NEW.user_id AND i.status='dispatched'
   AND EXISTS(SELECT 1 FROM standard_ai_requests s WHERE s.id=t.id AND s.user_id=NEW.user_id AND s.state='dispatched'));
END;

CREATE TRIGGER chat_result_open BEFORE UPDATE OF input_tokens,output_tokens ON chat_turns
WHEN OLD.mode='ai' AND (OLD.status!='pending' OR NOT EXISTS(
 SELECT 1 FROM standard_ai_requests s WHERE s.id=OLD.id AND s.user_id=OLD.user_id AND s.state IN ('dispatched','uncertain')))
BEGIN SELECT RAISE(ABORT,'chat_result_closed'); END;

CREATE TRIGGER stripe_invoice_delete_guard BEFORE DELETE ON stripe_paid_invoices
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'stripe_invoice_immutable'); END;

CREATE TRIGGER plan_catalog_delete_guard BEFORE DELETE ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;

CREATE TRIGGER plan_catalog_insert_guard BEFORE INSERT ON plan_catalog BEGIN SELECT RAISE(ABORT,'plan_catalog_immutable'); END;

CREATE TRIGGER stripe_current_order BEFORE INSERT ON stripe_subscription_orders
WHEN NEW.plan_id NOT IN ('starter','personal','business','business-pro')
BEGIN SELECT RAISE(ABORT,'current_plan_required'); END;

CREATE TRIGGER stripe_current_invoice BEFORE INSERT ON stripe_paid_invoices
WHEN NEW.plan_id NOT IN ('starter','personal','business','business-pro')
BEGIN SELECT RAISE(ABORT,'current_plan_required'); END;

CREATE TRIGGER chat_action_guided BEFORE INSERT ON chat_turns WHEN NEW.action_json IS NOT NULL AND NEW.mode!='guided'
BEGIN SELECT RAISE(ABORT,'chat_action_mode'); END;

CREATE TRIGGER chat_action_immutable BEFORE UPDATE OF action_json,user_text ON chat_turns
WHEN NEW.action_json IS NOT OLD.action_json OR (OLD.action_json IS NOT NULL AND NEW.user_text IS NOT OLD.user_text)
BEGIN SELECT RAISE(ABORT,'chat_action_immutable'); END;

CREATE TRIGGER directory_review_confirm BEFORE UPDATE ON directory_reviews
BEGIN
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') OR NOT EXISTS(SELECT 1 FROM directories d JOIN projects p ON p.id=d.project_id WHERE d.project_id=NEW.project_id AND p.owner_user_id=NEW.user_id AND d.revision=NEW.expected_revision);
 SELECT RAISE(ABORT,'directory_changed') WHERE NEW.kind='publish' AND (NOT EXISTS(SELECT 1 FROM publications WHERE project_id=NEW.project_id AND version_id IS NOT NULL AND revision=NEW.publication_revision) OR NEW.snapshot_json!=(SELECT draft_json FROM directories WHERE project_id=NEW.project_id));
 SELECT RAISE(ABORT,'directory_changed') WHERE NOT EXISTS(SELECT 1 FROM chat_turns WHERE id=NEW.confirmed_by AND user_id=NEW.user_id AND mode='guided' AND json_extract(action_json,'$.type')='confirm' AND json_extract(action_json,'$.kind')='directory' AND json_extract(action_json,'$.reviewId')=NEW.id);
END;

CREATE TRIGGER domain_proof_removal_guard BEFORE UPDATE ON domain_proof_removals
BEGIN
 SELECT RAISE(ABORT,'domain_proof_removal_expired') WHERE NEW.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now');
 SELECT RAISE(ABORT,'domain_proof_removal_changed') WHERE NOT EXISTS(
  SELECT 1 FROM domain_claims d JOIN projects p ON p.id=d.project_id JOIN chat_turns t ON t.id=NEW.confirmed_by
  WHERE d.id=NEW.claim_id AND d.project_id=NEW.project_id AND d.hostname=NEW.hostname AND d.token=NEW.proof_token AND d.expires_at=NEW.proof_expires_at AND p.owner_user_id=NEW.user_id
  AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='confirm' AND json_extract(t.action_json,'$.kind')='domainProof' AND json_extract(t.action_json,'$.reviewId')=NEW.id);
END;

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

CREATE TRIGGER service_client_version_admit BEFORE INSERT ON service_client_versions BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=q.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='serviceClientApply' AND json_extract(t.action_json,'$.reviewId')=q.id AND json_extract(t.action_json,'$.proposalDigest')=q.proposal_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND q.website_version_id=NEW.website_version_id AND NEW.revision=q.expected_revision+1
 AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.target_json=q.target_json AND NEW.target_digest=q.target_digest AND NEW.lock_json=q.lock_json AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest AND NEW.preview_html=q.preview_html AND NEW.preview_digest=q.preview_digest AND NEW.candidate_html=q.candidate_html AND NEW.candidate_digest=q.candidate_digest);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_versions WHERE project_id=NEW.project_id)>=25 OR (SELECT count(*) FROM service_client_versions)>=1000;
END;

CREATE TRIGGER service_client_apply_admit BEFORE INSERT ON service_client_applies BEGIN
 SELECT RAISE(ABORT,'service_client_changed') WHERE NOT EXISTS(SELECT 1 FROM service_client_proposals q JOIN service_client_valid_proposals a ON a.id=q.id JOIN service_client_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id AND v.proposal_id=q.id
 JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='guided' AND json_extract(t.action_json,'$.type')='serviceClientApply' AND json_extract(t.action_json,'$.reviewId')=q.id AND json_extract(t.action_json,'$.proposalDigest')=q.proposal_digest AND json_type(t.action_json,'$.expectedRevision')='integer' AND json_extract(t.action_json,'$.expectedRevision')=q.expected_revision
 WHERE q.id=NEW.proposal_id AND q.user_id=NEW.user_id AND q.project_id=NEW.project_id AND q.proposal_digest=NEW.proposal_digest AND NEW.id=NEW.version_id AND NEW.revision=q.expected_revision+1 AND v.revision=NEW.revision);
 SELECT RAISE(ABORT,'service_client_quota') WHERE (SELECT count(*) FROM service_client_applies WHERE project_id=NEW.project_id)>=500 OR (SELECT count(*) FROM service_client_applies)>=20000;
END;

CREATE TRIGGER project_spec_creation_immutable BEFORE UPDATE ON project_spec_creations BEGIN SELECT RAISE(ABORT,'specification_immutable'); END;

CREATE TRIGGER project_spec_creation_retained BEFORE DELETE ON project_spec_creations
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'specification_receipt_retained'); END;

CREATE TRIGGER project_spec_current_proposal BEFORE INSERT ON project_spec_proposals BEGIN
 SELECT RAISE(ABORT,'specification_current_required') WHERE NEW.operation NOT IN('change','restore') OR json_extract(NEW.spec_json,'$.schemaVersion') IS NOT 3 OR json_extract(NEW.lock_json,'$.compiler.version') IS NOT 7;
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=NEW.project_id AND json_extract(v.spec_json,'$.schemaVersion')=3 AND h.draft_revision=NEW.draft_revision);
END;

CREATE TRIGGER project_spec_version_admit BEFORE INSERT ON project_spec_versions BEGIN
 SELECT RAISE(ABORT,'specification_current_required') WHERE json_extract(NEW.spec_json,'$.schemaVersion') IS NOT 3 OR json_extract(NEW.lock_json,'$.compiler.version') IS NOT 7;
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM project_spec_proposals q JOIN site_versions v ON v.id=NEW.version_id AND v.project_id=q.project_id
  JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id
  WHERE q.id=NEW.proposal_id AND q.project_id=NEW.project_id AND NEW.revision=q.expected_revision+1
  AND NEW.spec_json=q.spec_json AND NEW.spec_digest=q.spec_digest AND NEW.lock_json=q.lock_json
  AND NEW.manifest_json=q.manifest_json AND NEW.manifest_digest=q.manifest_digest
  AND v.component_id=json_extract(q.manifest_json,'$.artifacts[0].component') AND v.html=q.html AND v.digest=q.html_digest AND v.config_json=q.config_json
 ) AND NOT EXISTS(
  SELECT 1 FROM site_versions v JOIN projects p ON p.id=v.project_id
  JOIN chat_turns t ON t.id=v.id AND t.user_id=p.owner_user_id AND t.mode='ai' AND t.status='pending' AND t.action_json IS NULL
  WHERE v.id=NEW.version_id AND v.project_id=NEW.project_id AND NEW.proposal_id=NEW.version_id AND NEW.revision=1
  AND p.site_draft_revision=1 AND NOT EXISTS(SELECT 1 FROM project_spec_heads WHERE project_id=p.id)
  AND v.component_id=json_extract(NEW.manifest_json,'$.artifacts[0].component')
  AND v.digest=json_extract(NEW.manifest_json,'$.artifacts[0].digest')
  AND NEW.spec_digest=json_extract(NEW.manifest_json,'$.specificationDigest')
  AND NOT EXISTS(SELECT 1 FROM project_spec_creations WHERE project_id=p.id)
 );
END;

CREATE TRIGGER project_spec_creation_admit BEFORE INSERT ON project_spec_creations BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(
  SELECT 1 FROM projects p JOIN site_versions s ON s.project_id=p.id
  JOIN project_spec_versions v ON v.version_id=s.id AND v.project_id=p.id AND v.revision=1 AND v.proposal_id=v.version_id
  JOIN chat_turns t ON t.id=NEW.id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending' AND t.action_json IS NULL
  WHERE p.id=NEW.project_id AND p.owner_user_id=NEW.user_id AND p.site_draft_revision=1
  AND NEW.id=NEW.version_id AND v.version_id=NEW.version_id AND s.source='ai'
  AND NOT EXISTS(SELECT 1 FROM project_spec_heads WHERE project_id=p.id)
  AND json_extract(v.spec_json,'$.schemaVersion')=3 AND json_extract(v.lock_json,'$.compiler.version')=7
 );
 SELECT RAISE(ABORT,'specification_held') WHERE EXISTS(SELECT 1 FROM project_spec_held WHERE version_id=NEW.version_id);
END;

CREATE TRIGGER project_spec_head_insert BEFORE INSERT ON project_spec_heads BEGIN
 SELECT RAISE(ABORT,'specification_changed') WHERE NOT EXISTS(SELECT 1 FROM project_spec_applies a JOIN projects p ON p.id=a.project_id WHERE a.project_id=NEW.project_id AND a.version_id=NEW.version_id AND a.revision=NEW.revision AND p.site_draft_revision=NEW.draft_revision)
 AND NOT EXISTS(SELECT 1 FROM project_spec_creations c JOIN projects p ON p.id=c.project_id WHERE c.project_id=NEW.project_id AND c.version_id=NEW.version_id AND NEW.revision=1 AND p.site_draft_revision=1 AND NEW.draft_revision=1);
END;

CREATE TRIGGER project_spec_created AFTER INSERT ON project_spec_creations BEGIN
 INSERT INTO project_spec_heads(project_id,revision,version_id,draft_revision) VALUES(NEW.project_id,1,NEW.version_id,1);
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES('specification:'||NEW.id,NEW.user_id,NEW.project_id,'site.specification.created','Saved the first current website specification',NEW.created_at);
END;

CREATE TRIGGER current_website_component BEFORE INSERT ON site_versions
WHEN NEW.component_id NOT IN('site-page@1','photo-page@1')
BEGIN SELECT RAISE(ABORT,'specification_current_required'); END;

CREATE TRIGGER welcome_create_project AFTER UPDATE ON welcome_onboarding WHEN NEW.completed_at IS NOT NULL
 BEGIN
 INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at,audience,preferred_theme)
 VALUES(NEW.project_id,NEW.user_id,NEW.project_name,NEW.idea,'draft',NEW.completed_at,NEW.completed_at,NEW.audience,NEW.preferred_theme);
 INSERT INTO workspace_state(user_id,revision,step,idea) VALUES(NEW.user_id,1,'ready','')
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,step='ready',idea='',brief_project_id=NULL,brief_stage=NULL;
 INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status)
 SELECT NEW.project_id,NEW.user_id,revision,'Start my first project.',
 'Your project “'||NEW.project_name||'” is ready to work on. I saved your idea and preferences privately. Tell me what you would like to build first. Nothing is published, and no services have been purchased.',NEW.completed_at,'guided','completed'
 FROM workspace_state WHERE user_id=NEW.user_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES('welcome:'||NEW.project_id,NEW.user_id,NEW.project_id,'project.created','Started first project during welcome',NEW.completed_at);
 END;

CREATE TRIGGER feature_preview_admit BEFORE INSERT ON feature_preview_grants BEGIN
 SELECT RAISE(ABORT,'feature_preview_owner') WHERE NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id);
 SELECT RAISE(ABORT,'feature_preview_initial') WHERE NEW.revoked_at IS NOT NULL;
 SELECT RAISE(ABORT,'feature_preview_capacity') WHERE (SELECT count(*) FROM feature_preview_grants WHERE user_id=NEW.user_id)>=1000 OR (SELECT count(*) FROM feature_preview_grants)>=20000;
END;

CREATE TRIGGER feature_preview_immutable BEFORE UPDATE ON feature_preview_grants
WHEN NEW.id IS NOT OLD.id OR NEW.contract_version IS NOT OLD.contract_version OR NEW.user_id IS NOT OLD.user_id
 OR NEW.project_id IS NOT OLD.project_id OR NEW.feature_id IS NOT OLD.feature_id OR NEW.operation IS NOT OLD.operation
 OR NEW.purpose IS NOT OLD.purpose OR NEW.review_reference IS NOT OLD.review_reference
 OR NEW.starts_at IS NOT OLD.starts_at OR NEW.ends_at IS NOT OLD.ends_at OR NEW.created_at IS NOT OLD.created_at
 OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT,'feature_preview_immutable'); END;

CREATE TRIGGER feature_preview_retained BEFORE DELETE ON feature_preview_grants
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 AND (OLD.project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id))
BEGIN SELECT RAISE(ABORT,'feature_preview_retained'); END;

-- Current connection-key policy. No bootstrap key material or obsolete encoding is admitted.
CREATE TABLE connection_key_registry (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 32 AND id GLOB '[a-z]*' AND id NOT GLOB '*[^a-z0-9-]*'),
 fingerprint TEXT NOT NULL UNIQUE CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^a-f0-9]*'),
 review_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER connection_key_registry_immutable BEFORE UPDATE ON connection_key_registry
BEGIN SELECT RAISE(ABORT,'connection_key_identity'); END;
CREATE TRIGGER connection_key_registry_retained BEFORE DELETE ON connection_key_registry
BEGIN SELECT RAISE(ABORT,'connection_key_custody_required'); END;
CREATE TABLE connection_key_policy (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 active_key TEXT NOT NULL REFERENCES connection_key_registry(id),
 revision INTEGER NOT NULL CHECK(revision>0),
 review_id TEXT NOT NULL
);
CREATE TRIGGER connection_key_policy_retained BEFORE DELETE ON connection_key_policy
BEGIN SELECT RAISE(ABORT,'connection_key_policy_required'); END;
CREATE TABLE connection_key_rotations (
 id TEXT PRIMARY KEY,
 source_key TEXT NOT NULL REFERENCES connection_key_registry(id),
 target_key TEXT NOT NULL REFERENCES connection_key_registry(id),
 revision INTEGER NOT NULL UNIQUE,
 review_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','complete')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 completed_at TEXT,
 CHECK(source_key!=target_key)
);
CREATE UNIQUE INDEX connection_key_rotation_running ON connection_key_rotations(state) WHERE state='running';
CREATE TABLE connection_rotation_batches (
 id TEXT PRIMARY KEY,
 rotation_id TEXT NOT NULL REFERENCES connection_key_rotations(id),
 selected_count INTEGER NOT NULL CHECK(selected_count BETWEEN 0 AND 20),
 changed_count INTEGER NOT NULL DEFAULT 0 CHECK(changed_count BETWEEN 0 AND selected_count),
 bytes_before INTEGER NOT NULL CHECK(bytes_before>=0),
 bytes_after INTEGER NOT NULL CHECK(bytes_after>=0),
 crypto_ms INTEGER NOT NULL CHECK(crypto_ms>=0),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Transient ciphertext-only capabilities. Insert/update/delete are one D1 batch;
-- a failed or interrupted transaction cannot leave a capability behind.
CREATE TABLE connection_rotation_guards (
 batch_id TEXT NOT NULL REFERENCES connection_rotation_batches(id),
 store TEXT NOT NULL CHECK(store IN ('github_token_vault','github_refresh_custody','cloudflare_token_vault','github_oauth_states','cloudflare_oauth_states','push_devices')),
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 record_id TEXT NOT NULL,
 old_ciphertext TEXT NOT NULL,
 new_ciphertext TEXT NOT NULL,
 PRIMARY KEY(batch_id,store,owner_id,record_id)
);
-- Does not expire automatically: an unknown exchange outcome may have issued a token.
CREATE TABLE connection_oauth_exchanges (
 token_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL CHECK(provider IN ('github','cloudflare')),
 client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 1 AND 128),
 state_hash TEXT NOT NULL,
 key_id TEXT NOT NULL REFERENCES connection_key_registry(id),
 revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state='dispatched'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(provider,state_hash),
 UNIQUE(user_id,provider)
);
CREATE TRIGGER connection_oauth_exchange_key BEFORE INSERT ON connection_oauth_exchanges
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE active_key=NEW.key_id AND revision=NEW.revision)
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER connection_oauth_exchange_identity BEFORE UPDATE ON connection_oauth_exchanges
BEGIN SELECT RAISE(ABORT,'connection_exchange_identity'); END;
CREATE TRIGGER github_grant_exchange_fence BEFORE INSERT ON connection_oauth_exchanges
WHEN NEW.provider='github' AND EXISTS(SELECT 1 FROM github_grant_revocations WHERE client_id=NEW.client_id AND state IN ('dispatching','uncertain'))
BEGIN SELECT RAISE(ABORT,'github_grant_in_progress'); END;
CREATE TRIGGER github_grant_cleanup_fence BEFORE INSERT ON github_revocation_claims
WHEN EXISTS(SELECT 1 FROM github_grant_revocations WHERE state IN ('dispatching','uncertain') AND NEW.token_id IN (SELECT value FROM json_each(token_ids)))
BEGIN SELECT RAISE(ABORT,'github_grant_in_progress'); END;
-- Metadata from the exact dispatch response. No code, credential, response body
-- or provider error description is retained. A restored receipt is not independent evidence.
CREATE TABLE connection_oauth_outcomes (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('github','cloudflare')),
 client_id TEXT NOT NULL,
 state_hash TEXT NOT NULL,
 key_id TEXT NOT NULL REFERENCES connection_key_registry(id),
 revision INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('rejected','revoked')),
 reason TEXT NOT NULL,
 http_status INTEGER NOT NULL,
 dispatched_at TEXT NOT NULL,
 settled_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK((state='revoked' AND reason='provider_revoked' AND ((provider='github' AND http_status=204) OR (provider='cloudflare' AND http_status=200)))
  OR (state='rejected' AND provider='github' AND http_status IN (200,400) AND reason IN ('incorrect_client_credentials','redirect_uri_mismatch','bad_verification_code','unverified_user_email'))
  OR (state='rejected' AND provider='cloudflare' AND ((http_status=400 AND reason IN ('invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope')) OR (http_status=401 AND reason='invalid_client'))))
);
CREATE TRIGGER connection_oauth_outcome_admission BEFORE INSERT ON connection_oauth_outcomes
WHEN NOT EXISTS(SELECT 1 FROM connection_oauth_exchanges e WHERE e.token_id=NEW.id AND e.user_id=NEW.user_id AND e.provider=NEW.provider AND e.client_id=NEW.client_id AND e.state_hash=NEW.state_hash AND e.key_id=NEW.key_id AND e.revision=NEW.revision AND e.created_at=NEW.dispatched_at)
 OR EXISTS(SELECT 1 FROM github_token_vault WHERE id=NEW.id)
 OR EXISTS(SELECT 1 FROM cloudflare_token_vault WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'connection_outcome_admission'); END;
CREATE TRIGGER connection_oauth_outcome_immutable BEFORE UPDATE ON connection_oauth_outcomes
BEGIN SELECT RAISE(ABORT,'connection_outcome_immutable'); END;
CREATE TRIGGER connection_oauth_exchange_settlement BEFORE DELETE ON connection_oauth_exchanges
WHEN NOT EXISTS(SELECT 1 FROM connection_oauth_outcomes r WHERE r.id=OLD.token_id AND r.user_id=OLD.user_id AND r.provider=OLD.provider AND r.client_id=OLD.client_id AND r.state_hash=OLD.state_hash AND r.key_id=OLD.key_id AND r.revision=OLD.revision AND r.dispatched_at=OLD.created_at)
 AND NOT (OLD.provider='github' AND EXISTS(SELECT 1 FROM github_token_vault WHERE id=OLD.token_id AND user_id=OLD.user_id))
 AND NOT (OLD.provider='cloudflare' AND EXISTS(SELECT 1 FROM cloudflare_token_vault WHERE id=OLD.token_id AND user_id=OLD.user_id))
BEGIN SELECT RAISE(ABORT,'connection_outcome_required'); END;
CREATE TRIGGER connection_key_activation BEFORE UPDATE ON connection_key_policy
WHEN NEW.singleton!=OLD.singleton OR NEW.revision!=OLD.revision+1 OR NEW.active_key=OLD.active_key
 OR EXISTS(SELECT 1 FROM connection_oauth_exchanges)
 OR NOT EXISTS(SELECT 1 FROM connection_key_rotations WHERE source_key=OLD.active_key AND target_key=NEW.active_key AND revision=NEW.revision AND review_id=NEW.review_id AND state='running')
BEGIN SELECT RAISE(ABORT,'connection_key_activation_denied'); END;
CREATE TRIGGER github_token_vault_write_key_insert BEFORE INSERT ON github_token_vault
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_token_vault_write_key_update BEFORE UPDATE OF ciphertext ON github_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_token_vault_rotation_only BEFORE UPDATE OF ciphertext ON github_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(
 SELECT 1 FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_token_vault' AND g.owner_id=OLD.user_id AND g.record_id=OLD.id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key)
BEGIN SELECT RAISE(ABORT,'connection_rotation_required'); END;
CREATE TRIGGER github_token_vault_rotation_count AFTER UPDATE OF ciphertext ON github_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext
BEGIN UPDATE connection_rotation_batches SET changed_count=changed_count+1 WHERE id IN (
 SELECT g.batch_id FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_token_vault' AND g.owner_id=OLD.user_id AND g.record_id=OLD.id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key); END;
CREATE TRIGGER github_refresh_custody_write_key_insert BEFORE INSERT ON github_refresh_custody
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_refresh_custody_write_key_update BEFORE UPDATE OF ciphertext ON github_refresh_custody
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_refresh_custody_rotation_only BEFORE UPDATE OF ciphertext ON github_refresh_custody
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(
 SELECT 1 FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_refresh_custody' AND g.owner_id=OLD.user_id AND g.record_id=OLD.token_id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key)
BEGIN SELECT RAISE(ABORT,'connection_rotation_required'); END;
CREATE TRIGGER github_refresh_custody_rotation_count AFTER UPDATE OF ciphertext ON github_refresh_custody
WHEN NEW.ciphertext!=OLD.ciphertext
BEGIN UPDATE connection_rotation_batches SET changed_count=changed_count+1 WHERE id IN (
 SELECT g.batch_id FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_refresh_custody' AND g.owner_id=OLD.user_id AND g.record_id=OLD.token_id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key); END;
CREATE TRIGGER cloudflare_token_vault_write_key_insert BEFORE INSERT ON cloudflare_token_vault
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER cloudflare_token_vault_write_key_update BEFORE UPDATE OF ciphertext ON cloudflare_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER cloudflare_token_vault_rotation_only BEFORE UPDATE OF ciphertext ON cloudflare_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext AND NOT EXISTS(
 SELECT 1 FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='cloudflare_token_vault' AND g.owner_id=OLD.user_id AND g.record_id=OLD.id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key)
BEGIN SELECT RAISE(ABORT,'connection_rotation_required'); END;
CREATE TRIGGER cloudflare_token_vault_rotation_count AFTER UPDATE OF ciphertext ON cloudflare_token_vault
WHEN NEW.ciphertext!=OLD.ciphertext
BEGIN UPDATE connection_rotation_batches SET changed_count=changed_count+1 WHERE id IN (
 SELECT g.batch_id FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='cloudflare_token_vault' AND g.owner_id=OLD.user_id AND g.record_id=OLD.id AND g.old_ciphertext=OLD.ciphertext AND g.new_ciphertext=NEW.ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key); END;
CREATE TRIGGER github_oauth_states_write_key_insert BEFORE INSERT ON github_oauth_states
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.verifier_ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_oauth_states_write_key_update BEFORE UPDATE OF verifier_ciphertext ON github_oauth_states
WHEN (NEW.verifier_ciphertext!=OLD.verifier_ciphertext OR NEW.state_hash!=OLD.state_hash) AND NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.verifier_ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER github_oauth_states_rotation_only BEFORE UPDATE OF verifier_ciphertext ON github_oauth_states
WHEN NEW.state_hash=OLD.state_hash AND NEW.verifier_ciphertext!=OLD.verifier_ciphertext AND NOT EXISTS(
 SELECT 1 FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_oauth_states' AND g.owner_id=OLD.user_id AND g.record_id=OLD.state_hash AND g.old_ciphertext=OLD.verifier_ciphertext AND g.new_ciphertext=NEW.verifier_ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key)
BEGIN SELECT RAISE(ABORT,'connection_rotation_required'); END;
CREATE TRIGGER github_oauth_states_rotation_count AFTER UPDATE OF verifier_ciphertext ON github_oauth_states
WHEN NEW.state_hash=OLD.state_hash AND NEW.verifier_ciphertext!=OLD.verifier_ciphertext
BEGIN UPDATE connection_rotation_batches SET changed_count=changed_count+1 WHERE id IN (
 SELECT g.batch_id FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='github_oauth_states' AND g.owner_id=OLD.user_id AND g.record_id=OLD.state_hash AND g.old_ciphertext=OLD.verifier_ciphertext AND g.new_ciphertext=NEW.verifier_ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key); END;
CREATE TRIGGER cloudflare_oauth_states_write_key_insert BEFORE INSERT ON cloudflare_oauth_states
WHEN NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.verifier_ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER cloudflare_oauth_states_write_key_update BEFORE UPDATE OF verifier_ciphertext ON cloudflare_oauth_states
WHEN (NEW.verifier_ciphertext!=OLD.verifier_ciphertext OR NEW.state_hash!=OLD.state_hash) AND NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE substr(NEW.verifier_ciphertext,1,length('wv2.'||active_key||'.'))='wv2.'||active_key||'.')
BEGIN SELECT RAISE(ABORT,'connection_write_key_changed'); END;
CREATE TRIGGER cloudflare_oauth_states_rotation_only BEFORE UPDATE OF verifier_ciphertext ON cloudflare_oauth_states
WHEN NEW.state_hash=OLD.state_hash AND NEW.verifier_ciphertext!=OLD.verifier_ciphertext AND NOT EXISTS(
 SELECT 1 FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='cloudflare_oauth_states' AND g.owner_id=OLD.user_id AND g.record_id=OLD.state_hash AND g.old_ciphertext=OLD.verifier_ciphertext AND g.new_ciphertext=NEW.verifier_ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key)
BEGIN SELECT RAISE(ABORT,'connection_rotation_required'); END;
CREATE TRIGGER cloudflare_oauth_states_rotation_count AFTER UPDATE OF verifier_ciphertext ON cloudflare_oauth_states
WHEN NEW.state_hash=OLD.state_hash AND NEW.verifier_ciphertext!=OLD.verifier_ciphertext
BEGIN UPDATE connection_rotation_batches SET changed_count=changed_count+1 WHERE id IN (
 SELECT g.batch_id FROM connection_rotation_guards g JOIN connection_rotation_batches b ON b.id=g.batch_id
 JOIN connection_key_rotations r ON r.id=b.rotation_id JOIN connection_key_policy p ON p.singleton=1 WHERE g.store='cloudflare_oauth_states' AND g.owner_id=OLD.user_id AND g.record_id=OLD.state_hash AND g.old_ciphertext=OLD.verifier_ciphertext AND g.new_ciphertext=NEW.verifier_ciphertext AND r.state='running' AND p.revision=r.revision AND p.active_key=r.target_key); END;
CREATE TRIGGER github_vault_identity BEFORE UPDATE ON github_token_vault
WHEN NEW.id!=OLD.id OR NEW.user_id!=OLD.user_id OR NEW.expires_at!=OLD.expires_at
BEGIN SELECT RAISE(ABORT,'github_vault_immutable'); END;
-- A key identity is activated once. Reusing an earlier active key would admit
-- stale configurations that still possess it; every rotation advances identity.
CREATE TRIGGER connection_key_rotation_forward BEFORE INSERT ON connection_key_rotations
WHEN EXISTS(SELECT 1 FROM connection_key_rotations WHERE source_key=NEW.target_key OR target_key=NEW.target_key)
 OR NOT EXISTS(SELECT 1 FROM connection_key_policy WHERE active_key=NEW.source_key AND revision+1=NEW.revision)
BEGIN SELECT RAISE(ABORT,'connection_key_rotation_forward_only'); END;
CREATE TRIGGER connection_key_rotation_identity BEFORE UPDATE ON connection_key_rotations
WHEN NEW.id!=OLD.id OR NEW.source_key!=OLD.source_key OR NEW.target_key!=OLD.target_key OR NEW.revision!=OLD.revision OR NEW.review_id!=OLD.review_id OR NEW.created_at!=OLD.created_at OR OLD.state!='running' OR NEW.state!='complete' OR NEW.completed_at IS NULL
BEGIN SELECT RAISE(ABORT,'connection_rotation_identity'); END;
CREATE TRIGGER connection_key_rotation_retained BEFORE DELETE ON connection_key_rotations
BEGIN SELECT RAISE(ABORT,'connection_rotation_receipt_required'); END;
CREATE TRIGGER connection_rotation_batch_identity BEFORE UPDATE ON connection_rotation_batches
WHEN NEW.id!=OLD.id OR NEW.rotation_id!=OLD.rotation_id OR NEW.selected_count!=OLD.selected_count OR NEW.bytes_before!=OLD.bytes_before OR NEW.bytes_after!=OLD.bytes_after OR NEW.crypto_ms!=OLD.crypto_ms OR NEW.created_at!=OLD.created_at OR NEW.changed_count!=OLD.changed_count+1
BEGIN SELECT RAISE(ABORT,'connection_rotation_batch_identity'); END;
CREATE TRIGGER connection_rotation_batch_retained BEFORE DELETE ON connection_rotation_batches
BEGIN SELECT RAISE(ABORT,'connection_rotation_receipt_required'); END;

-- WH-106: current owner Chat interactions. No user-provided form carries effect authority.
CREATE TABLE chat_interaction_checks (denied INTEGER NOT NULL);
CREATE TRIGGER chat_interaction_refuse BEFORE INSERT ON chat_interaction_checks
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;

CREATE TABLE chat_conversations (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 UNIQUE(id,user_id)
);
CREATE TABLE chat_interaction_tasks (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 origin_turn_id TEXT NOT NULL UNIQUE REFERENCES chat_turns(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 FOREIGN KEY(conversation_id,user_id) REFERENCES chat_conversations(id,user_id) ON DELETE CASCADE,
 UNIQUE(id,user_id,conversation_id)
);
CREATE TABLE chat_interactions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 origin_turn_id TEXT NOT NULL UNIQUE REFERENCES chat_turns(id) ON DELETE CASCADE,
 previous_interaction_id TEXT UNIQUE REFERENCES chat_interactions(id) ON DELETE CASCADE,
 envelope_json TEXT CHECK(envelope_json IS NULL OR (json_valid(envelope_json) AND length(CAST(envelope_json AS BLOB))<=32768)),
 definition_digest TEXT NOT NULL CHECK(length(definition_digest)=64),
 issue_hash TEXT NOT NULL CHECK(length(issue_hash)=64),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL CHECK(expires_at>created_at),
 state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','submitted','canceled','superseded')),
 answer_revision INTEGER NOT NULL DEFAULT 0 CHECK(answer_revision>=0),
 draft_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(draft_json) AND json_type(draft_json)='object' AND length(CAST(draft_json AS BLOB))<=16384),
 draft_saved_at TEXT,
 removed_at TEXT,
 removal_reason TEXT CHECK(removal_reason IN ('discarded','inactive')),
 CHECK(state!='canceled' OR removed_at IS NOT NULL),
 CHECK((removed_at IS NULL AND removal_reason IS NULL AND envelope_json IS NOT NULL)
  OR (removed_at IS NOT NULL AND removal_reason IS NOT NULL AND envelope_json IS NULL AND draft_json='{}' AND draft_saved_at IS NULL AND state!='submitted')),
 FOREIGN KEY(task_id,user_id,conversation_id) REFERENCES chat_interaction_tasks(id,user_id,conversation_id) ON DELETE CASCADE,
 UNIQUE(id,user_id)
);
CREATE INDEX chat_interactions_history ON chat_interactions(user_id,created_at DESC,id DESC);
CREATE INDEX chat_interactions_open ON chat_interactions(conversation_id,state,expires_at);
CREATE INDEX chat_interactions_retention ON chat_interactions(COALESCE(draft_saved_at,created_at),id) WHERE removed_at IS NULL AND state!='submitted';
CREATE TRIGGER chat_interaction_issue_scope BEFORE INSERT ON chat_interactions
WHEN NOT EXISTS(SELECT 1 FROM chat_interaction_tasks t JOIN chat_turns c ON c.id=NEW.origin_turn_id
 WHERE t.id=NEW.task_id AND t.user_id=NEW.user_id AND t.conversation_id=NEW.conversation_id
 AND t.project_id IS NEW.project_id AND c.user_id=NEW.user_id
 AND ((NEW.previous_interaction_id IS NULL AND t.origin_turn_id=NEW.origin_turn_id)
  OR EXISTS(SELECT 1 FROM chat_interactions previous WHERE previous.id=NEW.previous_interaction_id
   AND previous.id!=NEW.id AND previous.user_id=NEW.user_id AND previous.project_id IS NEW.project_id
   AND previous.task_id=NEW.task_id AND previous.conversation_id=NEW.conversation_id
   AND previous.created_at<=NEW.created_at AND previous.state!='open')))
 OR (NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id))
 OR json_extract(NEW.envelope_json,'$.id') IS NOT NEW.id
 OR json_extract(NEW.envelope_json,'$.version') IS NOT 1
 OR json_extract(NEW.envelope_json,'$.scope.accountId') IS NOT NEW.user_id
 OR json_extract(NEW.envelope_json,'$.scope.actorId') IS NOT NEW.user_id
 OR json_extract(NEW.envelope_json,'$.scope.conversationId') IS NOT NEW.conversation_id
 OR json_extract(NEW.envelope_json,'$.scope.taskId') IS NOT NEW.task_id
 OR json_extract(NEW.envelope_json,'$.scope.projectId') IS NOT NEW.project_id
 OR json_extract(NEW.envelope_json,'$.scope.originTurnId') IS NOT NEW.origin_turn_id
 OR json_extract(NEW.envelope_json,'$.createdAt') IS NOT NEW.created_at
 OR json_extract(NEW.envelope_json,'$.expiresAt') IS NOT NEW.expires_at
 OR json_extract(NEW.envelope_json,'$.definitionDigest') IS NOT NEW.definition_digest
 OR NEW.state!='open' OR NEW.answer_revision!=0 OR NEW.draft_json!='{}' OR NEW.draft_saved_at IS NOT NULL OR NEW.removed_at IS NOT NULL OR NEW.removal_reason IS NOT NULL
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;
CREATE TRIGGER chat_interaction_fixed BEFORE UPDATE ON chat_interactions
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.conversation_id IS NOT OLD.conversation_id
 OR NEW.task_id IS NOT OLD.task_id OR NEW.project_id IS NOT OLD.project_id OR NEW.origin_turn_id IS NOT OLD.origin_turn_id
 OR NEW.previous_interaction_id IS NOT OLD.previous_interaction_id
 OR NEW.definition_digest IS NOT OLD.definition_digest
 OR NEW.issue_hash IS NOT OLD.issue_hash OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR OLD.removed_at IS NOT NULL OR NEW.answer_revision!=OLD.answer_revision+1
 OR NOT (
  (OLD.state='open' AND NEW.envelope_json IS OLD.envelope_json AND NEW.removed_at IS NULL AND NEW.removal_reason IS NULL)
  OR (OLD.state!='submitted' AND NEW.envelope_json IS NULL AND NEW.draft_json='{}' AND NEW.draft_saved_at IS NULL
   AND NEW.removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND NOT EXISTS(SELECT 1 FROM chat_interaction_submissions WHERE interaction_id=OLD.id)
   AND ((OLD.state='open' AND NEW.state='canceled' AND NEW.removal_reason='discarded')
    OR (NEW.state=OLD.state AND NEW.removal_reason='inactive' AND strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(OLD.draft_saved_at,OLD.created_at),'+7 days')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))))
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;

CREATE TABLE chat_interaction_requests (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 interaction_id TEXT NOT NULL,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 operation TEXT NOT NULL CHECK(operation IN ('save-draft','submit','cancel')),
 answer_revision INTEGER NOT NULL CHECK(answer_revision>0),
 created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,request_id),
 UNIQUE(interaction_id,answer_revision)
);
CREATE TRIGGER chat_interaction_request_fixed BEFORE UPDATE ON chat_interaction_requests
BEGIN SELECT RAISE(ABORT,'chat_interaction_immutable'); END;
CREATE TABLE chat_interaction_submissions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 interaction_id TEXT NOT NULL UNIQUE,
 answers_json TEXT NOT NULL CHECK(json_valid(answers_json) AND json_type(answers_json)='object' AND length(CAST(answers_json AS BLOB))<=16384),
 answers_digest TEXT NOT NULL CHECK(length(answers_digest)=64),
 answer_revision INTEGER NOT NULL CHECK(answer_revision>0),
 created_at TEXT NOT NULL,
 FOREIGN KEY(user_id,id) REFERENCES chat_interaction_requests(user_id,request_id) ON DELETE CASCADE,
 FOREIGN KEY(interaction_id,user_id) REFERENCES chat_interactions(id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER chat_interaction_submission_scope BEFORE INSERT ON chat_interaction_submissions
WHEN NOT EXISTS(SELECT 1 FROM chat_interaction_requests r JOIN chat_interactions i ON i.id=r.interaction_id
 WHERE r.user_id=NEW.user_id AND r.request_id=NEW.id AND r.operation='submit' AND r.interaction_id=NEW.interaction_id
 AND r.answer_revision=NEW.answer_revision AND i.state='submitted' AND i.answer_revision=NEW.answer_revision)
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;
CREATE TRIGGER chat_interaction_submission_fixed BEFORE UPDATE ON chat_interaction_submissions
BEGIN SELECT RAISE(ABORT,'chat_interaction_immutable'); END;
CREATE TABLE chat_interaction_continuations (
 id TEXT PRIMARY KEY REFERENCES chat_interaction_submissions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'not-started' CHECK(state IN ('not-started','pending','succeeded','failed','unknown')),
 result_turn_id TEXT REFERENCES chat_turns(id) ON DELETE SET NULL,
 reason TEXT CHECK(reason IN ('stopped','changed','unavailable')),
 started_at TEXT,
 finished_at TEXT,
 CHECK((state='not-started' AND started_at IS NULL AND finished_at IS NULL AND result_turn_id IS NULL AND reason IS NULL)
  OR (state IN ('pending','unknown') AND started_at IS NOT NULL AND finished_at IS NULL AND result_turn_id IS NULL AND reason IS NULL)
  OR (state='succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND reason IS NULL)
  OR (state='failed' AND finished_at IS NOT NULL AND result_turn_id IS NULL AND reason IS NOT NULL))
);
CREATE TRIGGER chat_interaction_continuation_transition BEFORE UPDATE ON chat_interaction_continuations
WHEN NEW.id IS NOT OLD.id OR NOT (
 (OLD.state='not-started' AND NEW.state IN ('pending','failed'))
 OR (OLD.state='pending' AND NEW.state IN ('succeeded','failed','unknown') AND NEW.started_at IS OLD.started_at)
 OR (OLD.state='unknown' AND NEW.state IN ('succeeded','failed') AND NEW.started_at IS OLD.started_at)
 OR (OLD.state='succeeded' AND NEW.state='succeeded' AND OLD.result_turn_id IS NOT NULL AND NEW.result_turn_id IS NULL AND NEW.started_at IS OLD.started_at AND NEW.finished_at IS OLD.finished_at))
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;

-- Metadata identities outlive discarded project content, preventing request reuse.
CREATE TRIGGER chat_interaction_request_scope BEFORE INSERT ON chat_interaction_requests
WHEN NOT EXISTS(SELECT 1 FROM chat_interactions WHERE id=NEW.interaction_id AND user_id=NEW.user_id AND answer_revision=NEW.answer_revision
 AND state=CASE NEW.operation WHEN 'save-draft' THEN 'open' WHEN 'submit' THEN 'submitted' ELSE 'canceled' END)
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;
CREATE TRIGGER chat_interaction_request_retained BEFORE DELETE ON chat_interaction_requests
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'chat_interaction_receipt_retained'); END;
-- Check before the account disappears: child cascades can no longer use the
-- parent user row to retain custody once deletion has begun.
CREATE TRIGGER chat_interaction_account_retained BEFORE DELETE ON users
WHEN EXISTS(SELECT 1 FROM chat_interactions i
 JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
 JOIN chat_interaction_continuations c ON c.id=s.id
 WHERE i.user_id=OLD.id AND c.state IN ('pending','unknown'))
BEGIN SELECT RAISE(ABORT,'chat_interaction_receipt_retained'); END;
CREATE TRIGGER chat_interaction_retained BEFORE DELETE ON chat_interactions
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND (OLD.project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
 OR EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interaction_continuations c ON c.id=s.id WHERE s.interaction_id=OLD.id AND c.state IN ('pending','unknown')))
BEGIN SELECT RAISE(ABORT,'chat_interaction_receipt_retained'); END;
CREATE TRIGGER chat_interaction_submission_retained BEFORE DELETE ON chat_interaction_submissions
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM chat_interactions WHERE id=OLD.interaction_id)
BEGIN SELECT RAISE(ABORT,'chat_interaction_receipt_retained'); END;
CREATE TRIGGER chat_interaction_continuation_retained BEFORE DELETE ON chat_interaction_continuations
WHEN EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN users u ON u.id=s.user_id JOIN chat_interactions i ON i.id=s.interaction_id WHERE s.id=OLD.id)
BEGIN SELECT RAISE(ABORT,'chat_interaction_receipt_retained'); END;

CREATE TRIGGER chat_interaction_continuation_new BEFORE INSERT ON chat_interaction_continuations
WHEN NEW.state!='not-started' OR NOT EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id
 WHERE s.id=NEW.id AND json_extract(i.envelope_json,'$.definition.continuationBinding') IN ('site.content-prepare@1','agent.task-continue@1'))
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;
CREATE TRIGGER chat_interaction_continuation_result BEFORE UPDATE ON chat_interaction_continuations
WHEN NEW.state='succeeded' AND NEW.result_turn_id IS NOT NULL AND NOT EXISTS(
 SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id AND i.user_id=s.user_id
 JOIN chat_turns t ON t.id=NEW.result_turn_id AND t.user_id=s.user_id
 WHERE s.id=NEW.id AND t.id=s.id AND t.status='completed' AND (
  (json_extract(i.envelope_json,'$.definition.continuationBinding')='site.content-prepare@1'
   AND EXISTS(SELECT 1 FROM project_spec_chat_links l WHERE l.turn_id=t.id AND l.proposal_id=t.id))
  OR (json_extract(i.envelope_json,'$.definition.continuationBinding')='agent.task-continue@1' AND t.mode='ai'
   AND EXISTS(SELECT 1 FROM standard_ai_requests r WHERE r.id=t.id AND r.user_id=t.user_id AND r.state='completed'))))
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;

-- A form submission identity cannot be borrowed by an ordinary Chat request.
CREATE TRIGGER chat_interaction_model_turn BEFORE INSERT ON chat_turns
WHEN EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id
 WHERE s.id=NEW.id AND json_extract(i.envelope_json,'$.definition.continuationBinding')='agent.task-continue@1')
 AND NOT EXISTS(SELECT 1 FROM chat_interaction_submissions s JOIN chat_interactions i ON i.id=s.interaction_id
 JOIN chat_interaction_continuations c ON c.id=s.id JOIN standard_ai_requests r ON r.id=s.id AND r.user_id=s.user_id
 WHERE s.id=NEW.id AND s.user_id=NEW.user_id AND c.state='pending' AND r.state='reserved'
  AND NEW.mode='ai' AND NEW.status='pending' AND NEW.action_json IS NULL AND NEW.ai_context_allowed=0)
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;

-- Bounded same-task memory, committed with its owner Chat result. It never
-- enters general history or grants publication, execution or spending authority.
CREATE TABLE chat_task_progress (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 task_id TEXT NOT NULL REFERENCES chat_interaction_tasks(id) ON DELETE CASCADE,
 task_revision INTEGER NOT NULL CHECK(task_revision>=0),
 submission_id TEXT NOT NULL REFERENCES chat_interaction_submissions(id) ON DELETE CASCADE,
 previous_turn_id TEXT UNIQUE REFERENCES chat_task_progress(turn_id) ON DELETE CASCADE,
 created_project_id TEXT CHECK(created_project_id IS NULL OR created_project_id=task_id),
 state TEXT NOT NULL CHECK(state IN ('active','finished','canceled')),
 summary TEXT NOT NULL CHECK(length(summary)<=1000),
 questions_json TEXT NOT NULL CHECK(json_valid(questions_json) AND json_type(questions_json)='array' AND json_array_length(questions_json)<=3 AND length(questions_json)<=6000)
);
CREATE UNIQUE INDEX chat_task_progress_root ON chat_task_progress(submission_id) WHERE previous_turn_id IS NULL;
CREATE UNIQUE INDEX chat_task_created_project ON chat_task_progress(task_id) WHERE created_project_id IS NOT NULL;
CREATE INDEX chat_task_progress_owner ON chat_task_progress(user_id,submission_id);
CREATE TRIGGER chat_task_progress_admitted BEFORE INSERT ON chat_task_progress
WHEN NOT EXISTS(
 SELECT 1 FROM chat_interaction_tasks k JOIN chat_interactions i ON i.task_id=k.id AND i.user_id=k.user_id
 JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
 JOIN chat_interaction_continuations c ON c.id=s.id
 JOIN chat_turns t ON t.id=NEW.turn_id AND t.user_id=NEW.user_id
 JOIN standard_ai_requests r ON r.id=t.id AND r.user_id=t.user_id
 WHERE k.id=NEW.task_id AND k.user_id=NEW.user_id AND k.revision=NEW.task_revision AND s.id=NEW.submission_id
  AND i.state='submitted' AND i.removed_at IS NULL AND i.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND json_extract(i.envelope_json,'$.definition.continuationBinding')='agent.task-continue@1'
  AND NOT EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id)
  AND t.status='pending' AND t.mode='ai' AND t.action_json IS NULL AND t.ai_context_allowed=0 AND r.state IN ('dispatched','uncertain')
  AND ((NEW.previous_turn_id IS NULL AND NEW.turn_id=s.id AND c.state='pending') OR
   (c.state='succeeded' AND EXISTS(SELECT 1 FROM chat_task_progress p JOIN chat_turns prior ON prior.id=p.turn_id
    WHERE p.turn_id=NEW.previous_turn_id AND p.user_id=NEW.user_id AND p.task_id=NEW.task_id AND p.submission_id=NEW.submission_id
     AND prior.status='completed' AND prior.revision<t.revision)))
) OR EXISTS(SELECT 1 FROM json_each(NEW.questions_json) q WHERE json_type(q.value)!='object'
 OR json_type(q.value,'$.id') IS NOT 'text' OR length(json_extract(q.value,'$.id')) NOT BETWEEN 1 AND 40
 OR json_type(q.value,'$.question') IS NOT 'text' OR length(json_extract(q.value,'$.question')) NOT BETWEEN 1 AND 300)
 OR (NEW.state!='active' AND json_array_length(NEW.questions_json)!=0)
 OR (NEW.created_project_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM project_spec_creations created JOIN projects p ON p.id=created.project_id AND p.owner_user_id=created.user_id
   JOIN chat_interaction_submissions submitted ON submitted.id=NEW.submission_id AND submitted.user_id=NEW.user_id
   JOIN chat_interactions form ON form.id=submitted.interaction_id AND form.task_id=NEW.task_id
  WHERE created.id=NEW.turn_id AND created.user_id=NEW.user_id AND created.project_id=NEW.created_project_id
   AND json_extract(form.envelope_json,'$.definition.template')='project-brief@1'))
BEGIN SELECT RAISE(ABORT,'chat_interaction_changed'); END;
CREATE TRIGGER chat_task_progress_immutable BEFORE UPDATE ON chat_task_progress
BEGIN SELECT RAISE(ABORT,'chat_task_progress_immutable'); END;

-- A created-project locator survives project deletion; it is not access authority.
CREATE TRIGGER chat_task_created_project_retained BEFORE DELETE ON chat_task_progress
WHEN OLD.created_project_id IS NOT NULL AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 AND EXISTS(SELECT 1 FROM chat_interaction_tasks WHERE id=OLD.task_id)
BEGIN SELECT RAISE(ABORT,'chat_task_project_receipt_retained'); END;

-- WH-015 restricted safety cases and preservation holds (WH-131 contract slice, WH-132 operations).
-- Case records deliberately have no foreign key to users: ordinary account cascades cannot remove them.
-- References are opaque identifiers only; raw content, allegations, imagery, names and credentials never belong here.
-- Actor references are derived from an authenticated Whumpo passkey session (`human:<account id>`), never declared;
-- models, agents and jobs cannot hold a case role. Only the one-time operator bootstrap may grant role administration.
CREATE TABLE safety_case_roles (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 operator_ref TEXT NOT NULL CHECK(operator_ref GLOB 'human:?*' AND length(operator_ref)<=128 AND operator_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 role TEXT NOT NULL CHECK(role IN ('case_reviewer','preservation_approver','case_auditor','disclosure_approver','role_administrator')),
 granted_by TEXT NOT NULL CHECK((granted_by='operator:bootstrap' AND role='role_administrator')
  OR (granted_by GLOB 'human:?*' AND length(granted_by)<=128 AND granted_by NOT GLOB '*[^A-Za-z0-9_.:-]*' AND granted_by<>operator_ref)),
 granted_at INTEGER NOT NULL CHECK(granted_at>=0),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR revoked_at>=granted_at),
 revoked_by TEXT CHECK(revoked_by IS NULL OR (revoked_by GLOB 'human:?*' AND length(revoked_by)<=128 AND revoked_by NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 revoke_ref TEXT CHECK(revoke_ref IS NULL OR (length(revoke_ref) BETWEEN 1 AND 128 AND revoke_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 CHECK((revoked_at IS NULL)=(revoked_by IS NULL) AND (revoked_by IS NULL)=(revoke_ref IS NULL))
);
CREATE UNIQUE INDEX safety_case_roles_active ON safety_case_roles(operator_ref,role) WHERE revoked_at IS NULL;

CREATE TABLE safety_cases (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 subject_user_id TEXT NOT NULL CHECK(length(subject_user_id) BETWEEN 1 AND 128),
 intake_ref TEXT NOT NULL CHECK(length(intake_ref) BETWEEN 1 AND 128 AND intake_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 opened_by TEXT NOT NULL CHECK(opened_by GLOB 'human:?*' AND length(opened_by)<=128 AND opened_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 opened_at INTEGER NOT NULL CHECK(opened_at>=0),
 closed_at INTEGER CHECK(closed_at IS NULL OR closed_at>=opened_at),
 closed_by TEXT CHECK(closed_by IS NULL OR (closed_by GLOB 'human:?*' AND length(closed_by)<=128 AND closed_by NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 close_ref TEXT CHECK(close_ref IS NULL OR (length(close_ref) BETWEEN 1 AND 128 AND close_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 -- WH-132 default retention (owner decision 2026-10-04, pending counsel): set at opening from the source constant
 -- (safetyRetentionDays, one year); at expiry an operator reviews the case (safety_retention_decisions). Nothing lapses.
 retention_due_at INTEGER NOT NULL CHECK(retention_due_at>opened_at),
 CHECK((closed_at IS NULL)=(closed_by IS NULL) AND (closed_by IS NULL)=(close_ref IS NULL)),
 CHECK(opened_by<>'human:'||subject_user_id)
);
CREATE INDEX safety_cases_subject ON safety_cases(subject_user_id);

-- Findings are append-only. Every case starts as an uncertain flag; only a named human reviewer's
-- explicit decision records a confirmed policy finding, and later decisions correct rather than overwrite.
CREATE TABLE safety_case_findings (
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 finding TEXT NOT NULL CHECK(finding IN ('uncertain_flag','confirmed_policy_finding','not_confirmed')),
 reviewer_ref TEXT NOT NULL CHECK(reviewer_ref GLOB 'human:?*' AND length(reviewer_ref)<=128 AND reviewer_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 decision_ref TEXT NOT NULL CHECK(length(decision_ref) BETWEEN 1 AND 128 AND decision_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>=0),
 PRIMARY KEY(case_id,seq),
 UNIQUE(case_id,decision_ref)
);

CREATE TABLE safety_case_evidence (
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 evidence_id TEXT NOT NULL CHECK(length(evidence_id) BETWEEN 1 AND 128),
 linked_by TEXT NOT NULL CHECK(linked_by GLOB 'human:?*' AND length(linked_by)<=128 AND linked_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 linked_at INTEGER NOT NULL CHECK(linked_at>=0),
 PRIMARY KEY(case_id,evidence_id)
);

-- A hold stays in force until an explicit audited release. review_due_at bounds each approval term
-- (at most 366 days); an overdue hold is reported for review and never lapses silently.
-- Scope: the whole subject account, one of the subject's projects, or one project photo object.
CREATE TABLE safety_preservation_holds (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 subject_user_id TEXT NOT NULL CHECK(length(subject_user_id) BETWEEN 1 AND 128),
 scope TEXT NOT NULL CHECK(scope IN ('account','project','object')),
 project_id TEXT CHECK(project_id IS NULL OR length(project_id) BETWEEN 1 AND 128),
 file_id TEXT CHECK(file_id IS NULL OR length(file_id) BETWEEN 1 AND 128),
 legal_basis_ref TEXT NOT NULL CHECK(length(legal_basis_ref) BETWEEN 1 AND 128 AND legal_basis_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 approved_by TEXT NOT NULL CHECK(approved_by GLOB 'human:?*' AND length(approved_by)<=128 AND approved_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 placed_at INTEGER NOT NULL CHECK(placed_at>=0),
 review_due_at INTEGER NOT NULL CHECK(review_due_at>placed_at AND review_due_at<=placed_at+31622400),
 released_at INTEGER CHECK(released_at IS NULL OR released_at>=placed_at),
 released_by TEXT CHECK(released_by IS NULL OR (released_by GLOB 'human:?*' AND length(released_by)<=128 AND released_by NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 release_ref TEXT CHECK(release_ref IS NULL OR (length(release_ref) BETWEEN 1 AND 128 AND release_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 CHECK((released_at IS NULL)=(released_by IS NULL) AND (released_by IS NULL)=(release_ref IS NULL)),
 CHECK((scope='account' AND project_id IS NULL AND file_id IS NULL) OR (scope='project' AND project_id IS NOT NULL AND file_id IS NULL)
  OR (scope='object' AND project_id IS NOT NULL AND file_id IS NOT NULL))
);
CREATE INDEX safety_preservation_holds_active ON safety_preservation_holds(subject_user_id) WHERE released_at IS NULL;
CREATE INDEX safety_preservation_holds_project ON safety_preservation_holds(project_id) WHERE released_at IS NULL AND project_id IS NOT NULL;

-- Every case access attempt and decision, allowed or not. No inputs beyond validated opaque identifiers.
CREATE TABLE safety_case_audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 at INTEGER NOT NULL CHECK(at>=0),
 actor_ref TEXT CHECK(actor_ref IS NULL OR (actor_ref GLOB 'human:?*' AND length(actor_ref)<=128 AND actor_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 action TEXT NOT NULL CHECK(action IN ('bootstrap_administrator','grant_role','revoke_role','open_case','link_evidence','record_finding','place_hold','release_hold','close_case','read_case','read_audit','list_holds',
  'capture_evidence','dispose_evidence','request_disclosure','approve_disclosure','record_disclosure','cancel_disclosure','read_disclosure',
  'list_retention','preview_retention','decide_retention')),
 case_id TEXT CHECK(case_id IS NULL OR (length(case_id) BETWEEN 1 AND 128 AND case_id NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 target_ref TEXT CHECK(target_ref IS NULL OR (length(target_ref) BETWEEN 1 AND 128 AND target_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 outcome TEXT NOT NULL CHECK(outcome IN ('allowed','denied','rejected')),
 reason TEXT NOT NULL CHECK(reason IN ('ok','unauthenticated','missing_role','conflict_of_interest','invalid_input','conflict','not_found','active_hold','case_closed','capacity','unavailable'))
);

-- Projects and project photos currently inside an unreleased hold's scope.
CREATE VIEW safety_held_projects AS
 SELECT p.id AS project_id FROM projects p WHERE EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL
  AND ((h.scope='account' AND h.subject_user_id=p.owner_user_id) OR (h.scope='project' AND h.project_id=p.id)));
CREATE VIEW safety_held_files AS
 SELECT f.id AS file_id,f.project_id,f.object_key FROM project_files f
 WHERE f.project_id IN (SELECT project_id FROM safety_held_projects)
  OR EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL AND h.scope='object' AND h.file_id=f.id);

-- Restricted in-place preservation of small D1 payloads that a customer may overwrite or clear without
-- any visible difference (profile photo replacement, Chat draft discard/expiry, app visitor document overwrites and
-- cleared app recovery-point copies). Written only by triggers
-- while a covering hold is active, never read by customer, Chat or model paths, and removed when the
-- last covering hold is released (ordinary deletion resumes).
CREATE TABLE safety_preserved_records (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 hold_id TEXT NOT NULL REFERENCES safety_preservation_holds(id),
 subject_user_id TEXT NOT NULL CHECK(length(subject_user_id) BETWEEN 1 AND 128),
 project_id TEXT CHECK(project_id IS NULL OR length(project_id) BETWEEN 1 AND 128),
 source TEXT NOT NULL CHECK(source IN ('profile_photo','chat_interaction_draft','app_document','app_recovery_document')),
 source_id TEXT NOT NULL CHECK(length(source_id) BETWEEN 1 AND 128),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(CAST(payload_json AS BLOB))<=65536),
 preserved_at INTEGER NOT NULL CHECK(preserved_at>=0)
);
CREATE INDEX safety_preserved_records_hold ON safety_preserved_records(hold_id);

-- Restricted evidence objects: explicit operator copies into the private FILES bucket under the reserved
-- `restricted/safety-evidence/` prefix, which no ordinary route serves, lists or cleans up. They outlive the
-- customer's data and hold release, and are removed only by an audited disposal after the case is closed.
CREATE TABLE safety_evidence_objects (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 hold_id TEXT NOT NULL REFERENCES safety_preservation_holds(id),
 subject_user_id TEXT NOT NULL CHECK(length(subject_user_id) BETWEEN 1 AND 128),
 source TEXT NOT NULL CHECK(source IN ('project_photo','profile_photo','preserved_record')),
 source_ref TEXT NOT NULL CHECK(length(source_ref) BETWEEN 1 AND 128),
 storage_key TEXT NOT NULL UNIQUE CHECK(storage_key='restricted/safety-evidence/'||case_id||'/'||id),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','application/json')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 1048576),
 captured_by TEXT NOT NULL CHECK(captured_by GLOB 'human:?*' AND length(captured_by)<=128 AND captured_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 captured_at INTEGER NOT NULL CHECK(captured_at>=0),
 -- WH-132: each object's own default retention term (safetyRetentionDays from capture); the case's review covers it.
 retention_due_at INTEGER NOT NULL CHECK(retention_due_at>captured_at),
 stored_at INTEGER CHECK(stored_at IS NULL OR stored_at>=captured_at),
 disposed_at INTEGER CHECK(disposed_at IS NULL OR (stored_at IS NOT NULL AND disposed_at>=stored_at)),
 disposed_by TEXT CHECK(disposed_by IS NULL OR (disposed_by GLOB 'human:?*' AND length(disposed_by)<=128 AND disposed_by NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 dispose_ref TEXT CHECK(dispose_ref IS NULL OR (length(dispose_ref) BETWEEN 1 AND 128 AND dispose_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 CHECK((disposed_at IS NULL)=(disposed_by IS NULL) AND (disposed_by IS NULL)=(dispose_ref IS NULL)),
 UNIQUE(case_id,source,source_ref,sha256)
);

-- Lawful export/disclosure is a separate two-person operation over an exact evidence manifest.
-- The platform never transmits anything: a recorded disclosure states that an out-of-band, counsel-reviewed
-- transfer happened under the approved manifest.
CREATE TABLE safety_disclosures (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128 AND id NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 legal_process_ref TEXT NOT NULL CHECK(length(legal_process_ref) BETWEEN 1 AND 128 AND legal_process_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 recipient_ref TEXT NOT NULL CHECK(length(recipient_ref) BETWEEN 1 AND 128 AND recipient_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 manifest_sha256 TEXT NOT NULL CHECK(length(manifest_sha256)=64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
 item_count INTEGER NOT NULL CHECK(item_count BETWEEN 1 AND 100),
 state TEXT NOT NULL CHECK(state IN ('requested','approved','recorded','cancelled')),
 requested_by TEXT NOT NULL CHECK(requested_by GLOB 'human:?*' AND length(requested_by)<=128 AND requested_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 requested_at INTEGER NOT NULL CHECK(requested_at>=0),
 approved_by TEXT CHECK(approved_by IS NULL OR (approved_by GLOB 'human:?*' AND length(approved_by)<=128 AND approved_by NOT GLOB '*[^A-Za-z0-9_.:-]*' AND approved_by<>requested_by)),
 approved_at INTEGER,
 closed_by TEXT CHECK(closed_by IS NULL OR (closed_by GLOB 'human:?*' AND length(closed_by)<=128 AND closed_by NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 closed_at INTEGER,
 close_ref TEXT CHECK(close_ref IS NULL OR (length(close_ref) BETWEEN 1 AND 128 AND close_ref NOT GLOB '*[^A-Za-z0-9_.:-]*')),
 CHECK((approved_by IS NULL)=(approved_at IS NULL) AND (closed_by IS NULL)=(closed_at IS NULL) AND (closed_by IS NULL)=(close_ref IS NULL)),
 CHECK((state='requested' AND approved_by IS NULL AND closed_by IS NULL) OR (state='approved' AND approved_by IS NOT NULL AND closed_by IS NULL)
  OR (state='recorded' AND approved_by IS NOT NULL AND closed_by IS NOT NULL) OR (state='cancelled' AND closed_by IS NOT NULL))
);
CREATE TABLE safety_disclosure_items (
 disclosure_id TEXT NOT NULL REFERENCES safety_disclosures(id),
 evidence_object_id TEXT NOT NULL REFERENCES safety_evidence_objects(id),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 PRIMARY KEY(disclosure_id,evidence_object_id)
);

-- WH-132 retention review (owner decision 2026-10-04, pending counsel). Cases and their evidence objects have a
-- default one-year term (retention_due_at). At expiry the case appears in the operator review queue as
-- retention_review_due; nothing lapses or is deleted automatically. A preservation approver reviews an exact preview
-- digest and either extends the term (1-366 days from the decision) or releases it. Release is final, needs a closed
-- case with no active hold on the case or its subject, no open disclosure and no unfinished capture, and only then may
-- evidence objects be disposed of (still a separate audited operation). Decisions are append-only.
CREATE TABLE safety_retention_decisions (
 case_id TEXT NOT NULL REFERENCES safety_cases(id),
 seq INTEGER NOT NULL CHECK(seq BETWEEN 1 AND 1000),
 decision TEXT NOT NULL CHECK(decision IN ('extend','release')),
 reviewed_due_at INTEGER NOT NULL CHECK(reviewed_due_at>=0),
 next_due_at INTEGER,
 review_sha256 TEXT NOT NULL CHECK(length(review_sha256)=64 AND review_sha256 NOT GLOB '*[^0-9a-f]*'),
 decision_ref TEXT NOT NULL CHECK(length(decision_ref) BETWEEN 1 AND 128 AND decision_ref NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 decided_by TEXT NOT NULL CHECK(decided_by GLOB 'human:?*' AND length(decided_by)<=128 AND decided_by NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 decided_at INTEGER NOT NULL CHECK(decided_at>=reviewed_due_at),
 PRIMARY KEY(case_id,seq),
 UNIQUE(case_id,decision_ref),
 CHECK((decision='extend' AND next_due_at IS NOT NULL AND next_due_at>decided_at AND next_due_at<=decided_at+31622400) OR (decision='release' AND next_due_at IS NULL))
);
-- The current retention due date of each case: the latest extension (or the case's own term) and never earlier than
-- the term of any evidence object not yet disposed of.
CREATE VIEW safety_case_retention AS
 SELECT c.id AS case_id,c.subject_user_id,
  max(COALESCE((SELECT d.next_due_at FROM safety_retention_decisions d WHERE d.case_id=c.id AND d.decision='extend' ORDER BY d.seq DESC LIMIT 1),c.retention_due_at),
   COALESCE((SELECT max(o.retention_due_at) FROM safety_evidence_objects o WHERE o.case_id=c.id AND o.disposed_at IS NULL),0)) AS due_at,
  EXISTS(SELECT 1 FROM safety_retention_decisions d WHERE d.case_id=c.id AND d.decision='release') AS released
 FROM safety_cases c;

CREATE TRIGGER safety_case_roles_capacity BEFORE INSERT ON safety_case_roles WHEN (SELECT count(*) FROM safety_case_roles)>=1000
BEGIN SELECT RAISE(ABORT,'safety_case_capacity'); END;
CREATE TRIGGER safety_case_roles_update BEFORE UPDATE ON safety_case_roles
WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.operator_ref IS NOT OLD.operator_ref OR NEW.role IS NOT OLD.role
 OR NEW.granted_by IS NOT OLD.granted_by OR NEW.granted_at IS NOT OLD.granted_at
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_case_roles_retained BEFORE DELETE ON safety_case_roles BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_cases_admit BEFORE INSERT ON safety_cases BEGIN
 SELECT RAISE(ABORT,'safety_case_subject_missing') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.subject_user_id);
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_cases)>=10000;
END;
CREATE TRIGGER safety_cases_update BEFORE UPDATE ON safety_cases
WHEN OLD.closed_at IS NOT NULL OR NEW.closed_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.subject_user_id IS NOT OLD.subject_user_id
 OR NEW.intake_ref IS NOT OLD.intake_ref OR NEW.opened_by IS NOT OLD.opened_by OR NEW.opened_at IS NOT OLD.opened_at OR NEW.retention_due_at IS NOT OLD.retention_due_at
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_cases_close_held BEFORE UPDATE ON safety_cases
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE case_id=OLD.id AND released_at IS NULL)
 OR EXISTS(SELECT 1 FROM safety_disclosures WHERE case_id=OLD.id AND state IN ('requested','approved'))
 OR EXISTS(SELECT 1 FROM safety_evidence_objects WHERE case_id=OLD.id AND stored_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_hold_active'); END;
CREATE TRIGGER safety_cases_retained BEFORE DELETE ON safety_cases BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_case_findings_admit BEFORE INSERT ON safety_case_findings BEGIN
 SELECT RAISE(ABORT,'safety_case_closed') WHERE EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NOT NULL);
 SELECT RAISE(ABORT,'safety_case_finding_order') WHERE NEW.seq<>COALESCE((SELECT max(seq) FROM safety_case_findings WHERE case_id=NEW.case_id),0)+1
  OR (NEW.seq=1 AND NEW.finding<>'uncertain_flag')
  OR (NEW.seq>1 AND NEW.finding=(SELECT finding FROM safety_case_findings WHERE case_id=NEW.case_id AND seq=NEW.seq-1));
END;
CREATE TRIGGER safety_case_findings_immutable BEFORE UPDATE ON safety_case_findings BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_case_findings_retained BEFORE DELETE ON safety_case_findings BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_case_evidence_admit BEFORE INSERT ON safety_case_evidence BEGIN
 SELECT RAISE(ABORT,'safety_case_closed') WHERE EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NOT NULL);
 SELECT RAISE(ABORT,'safety_case_evidence_missing') WHERE NOT EXISTS(SELECT 1 FROM content_risk_evidence e JOIN safety_cases c ON c.subject_user_id=e.user_id WHERE c.id=NEW.case_id AND e.id=NEW.evidence_id);
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_case_evidence WHERE case_id=NEW.case_id)>=1000;
END;
CREATE TRIGGER safety_case_evidence_immutable BEFORE UPDATE ON safety_case_evidence BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_case_evidence_retained BEFORE DELETE ON safety_case_evidence BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_preservation_holds_admit BEFORE INSERT ON safety_preservation_holds BEGIN
 SELECT RAISE(ABORT,'safety_case_closed') WHERE EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NOT NULL);
 SELECT RAISE(ABORT,'safety_hold_subject') WHERE NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND subject_user_id=NEW.subject_user_id)
  OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.subject_user_id) OR NEW.released_at IS NOT NULL
  OR (NEW.scope IN ('project','object') AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.subject_user_id))
  OR (NEW.scope='object' AND NOT EXISTS(SELECT 1 FROM project_files WHERE id=NEW.file_id AND project_id=NEW.project_id));
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_preservation_holds)>=10000;
END;
CREATE TRIGGER safety_preservation_holds_update BEFORE UPDATE ON safety_preservation_holds
WHEN OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.case_id IS NOT OLD.case_id
 OR NEW.subject_user_id IS NOT OLD.subject_user_id OR NEW.scope IS NOT OLD.scope OR NEW.project_id IS NOT OLD.project_id OR NEW.file_id IS NOT OLD.file_id
 OR NEW.legal_basis_ref IS NOT OLD.legal_basis_ref OR NEW.approved_by IS NOT OLD.approved_by OR NEW.placed_at IS NOT OLD.placed_at OR NEW.review_due_at IS NOT OLD.review_due_at
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_preservation_holds_retained BEFORE DELETE ON safety_preservation_holds BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
-- Release hands preserved payloads to another covering active hold, otherwise ordinary deletion resumes.
CREATE TRIGGER safety_preservation_holds_release AFTER UPDATE OF released_at ON safety_preservation_holds
WHEN OLD.released_at IS NULL AND NEW.released_at IS NOT NULL BEGIN
 UPDATE safety_preserved_records SET hold_id=(SELECT h.id FROM safety_preservation_holds h WHERE h.released_at IS NULL
   AND ((h.scope='account' AND h.subject_user_id=safety_preserved_records.subject_user_id) OR (h.scope='project' AND h.project_id=safety_preserved_records.project_id))
   ORDER BY h.placed_at,h.id LIMIT 1)
  WHERE hold_id=NEW.id AND EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL
   AND ((h.scope='account' AND h.subject_user_id=safety_preserved_records.subject_user_id) OR (h.scope='project' AND h.project_id=safety_preserved_records.project_id)));
 DELETE FROM safety_preserved_records WHERE hold_id=NEW.id;
END;

CREATE TRIGGER safety_case_audit_capacity BEFORE INSERT ON safety_case_audit WHEN (SELECT count(*) FROM safety_case_audit)>=100000
BEGIN SELECT RAISE(ABORT,'safety_case_capacity'); END;
CREATE TRIGGER safety_case_audit_immutable BEFORE UPDATE ON safety_case_audit BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_case_audit_retained BEFORE DELETE ON safety_case_audit BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_preserved_records_admit BEFORE INSERT ON safety_preserved_records BEGIN
 SELECT RAISE(ABORT,'safety_hold_subject') WHERE NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=NEW.hold_id AND released_at IS NULL);
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_preserved_records)>=50000;
END;
CREATE TRIGGER safety_preserved_records_update BEFORE UPDATE ON safety_preserved_records
WHEN NEW.seq IS NOT OLD.seq OR NEW.subject_user_id IS NOT OLD.subject_user_id OR NEW.project_id IS NOT OLD.project_id OR NEW.source IS NOT OLD.source
 OR NEW.source_id IS NOT OLD.source_id OR NEW.payload_json IS NOT OLD.payload_json OR NEW.preserved_at IS NOT OLD.preserved_at
 OR NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=OLD.hold_id AND released_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=NEW.hold_id AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_preserved_records_retained BEFORE DELETE ON safety_preserved_records
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=OLD.hold_id AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;

CREATE TRIGGER safety_evidence_objects_admit BEFORE INSERT ON safety_evidence_objects BEGIN
 SELECT RAISE(ABORT,'safety_case_closed') WHERE EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NOT NULL);
 SELECT RAISE(ABORT,'safety_hold_subject') WHERE NEW.stored_at IS NOT NULL OR NEW.disposed_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=NEW.hold_id AND case_id=NEW.case_id AND subject_user_id=NEW.subject_user_id AND released_at IS NULL);
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_evidence_objects WHERE case_id=NEW.case_id)>=1000
  OR (SELECT count(*) FROM safety_evidence_objects)>=10000;
END;
CREATE TRIGGER safety_evidence_objects_update BEFORE UPDATE ON safety_evidence_objects
WHEN NEW.id IS NOT OLD.id OR NEW.case_id IS NOT OLD.case_id OR NEW.hold_id IS NOT OLD.hold_id OR NEW.subject_user_id IS NOT OLD.subject_user_id
 OR NEW.source IS NOT OLD.source OR NEW.source_ref IS NOT OLD.source_ref OR NEW.storage_key IS NOT OLD.storage_key OR NEW.content_type IS NOT OLD.content_type
 OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size IS NOT OLD.size OR NEW.captured_by IS NOT OLD.captured_by OR NEW.captured_at IS NOT OLD.captured_at
 OR NEW.retention_due_at IS NOT OLD.retention_due_at
 OR OLD.disposed_at IS NOT NULL OR (OLD.stored_at IS NOT NULL AND NEW.stored_at IS NOT OLD.stored_at)
 OR (NEW.disposed_at IS NOT NULL AND (OLD.stored_at IS NULL
  OR NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=OLD.case_id AND closed_at IS NOT NULL)
  -- WH-132: disposal only after an operator released the case's retention, and never while any hold on the subject is active.
  OR NOT EXISTS(SELECT 1 FROM safety_retention_decisions WHERE case_id=OLD.case_id AND decision='release')
  OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND (case_id=OLD.case_id OR subject_user_id=OLD.subject_user_id))
  OR EXISTS(SELECT 1 FROM safety_disclosure_items i JOIN safety_disclosures d ON d.id=i.disclosure_id WHERE i.evidence_object_id=OLD.id AND d.state IN ('requested','approved'))))
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_evidence_objects_retained BEFORE DELETE ON safety_evidence_objects BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

CREATE TRIGGER safety_disclosures_admit BEFORE INSERT ON safety_disclosures BEGIN
 SELECT RAISE(ABORT,'safety_case_closed') WHERE EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NOT NULL);
 SELECT RAISE(ABORT,'safety_case_immutable') WHERE NEW.state<>'requested';
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_disclosures WHERE case_id=NEW.case_id)>=100;
END;
CREATE TRIGGER safety_disclosures_update BEFORE UPDATE ON safety_disclosures
WHEN NEW.id IS NOT OLD.id OR NEW.case_id IS NOT OLD.case_id OR NEW.legal_process_ref IS NOT OLD.legal_process_ref OR NEW.recipient_ref IS NOT OLD.recipient_ref
 OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.item_count IS NOT OLD.item_count OR NEW.requested_by IS NOT OLD.requested_by OR NEW.requested_at IS NOT OLD.requested_at
 OR OLD.state IN ('recorded','cancelled') OR (OLD.approved_by IS NOT NULL AND (NEW.approved_by IS NOT OLD.approved_by OR NEW.approved_at IS NOT OLD.approved_at))
 OR NOT ((OLD.state='requested' AND NEW.state IN ('approved','cancelled')) OR (OLD.state='approved' AND NEW.state IN ('recorded','cancelled')))
 OR (NEW.state='approved' AND (SELECT count(*) FROM safety_disclosure_items i JOIN safety_evidence_objects o ON o.id=i.evidence_object_id AND o.sha256=i.sha256
  WHERE i.disclosure_id=OLD.id AND o.case_id=OLD.case_id AND o.stored_at IS NOT NULL AND o.disposed_at IS NULL)<>OLD.item_count)
BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_disclosures_retained BEFORE DELETE ON safety_disclosures BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_disclosure_items_admit BEFORE INSERT ON safety_disclosure_items
WHEN NOT EXISTS(SELECT 1 FROM safety_disclosures d JOIN safety_evidence_objects o ON o.case_id=d.case_id
  WHERE d.id=NEW.disclosure_id AND d.state='requested' AND o.id=NEW.evidence_object_id AND o.sha256=NEW.sha256 AND o.stored_at IS NOT NULL AND o.disposed_at IS NULL)
 OR (SELECT count(*) FROM safety_disclosure_items WHERE disclosure_id=NEW.disclosure_id)>=(SELECT item_count FROM safety_disclosures WHERE id=NEW.disclosure_id)
BEGIN SELECT RAISE(ABORT,'safety_case_evidence_missing'); END;
CREATE TRIGGER safety_disclosure_items_immutable BEFORE UPDATE ON safety_disclosure_items BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_disclosure_items_retained BEFORE DELETE ON safety_disclosure_items BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_retention_decisions_admit BEFORE INSERT ON safety_retention_decisions BEGIN
 SELECT RAISE(ABORT,'safety_case_immutable') WHERE NEW.seq<>COALESCE((SELECT max(seq) FROM safety_retention_decisions WHERE case_id=NEW.case_id),0)+1
  OR EXISTS(SELECT 1 FROM safety_retention_decisions WHERE case_id=NEW.case_id AND decision='release');
 SELECT RAISE(ABORT,'safety_retention_changed') WHERE NOT EXISTS(SELECT 1 FROM safety_case_retention r WHERE r.case_id=NEW.case_id AND r.released=0
  AND r.due_at=NEW.reviewed_due_at AND r.due_at<=NEW.decided_at);
 SELECT RAISE(ABORT,'safety_retention_case_open') WHERE NEW.decision='release' AND EXISTS(SELECT 1 FROM safety_cases WHERE id=NEW.case_id AND closed_at IS NULL);
 SELECT RAISE(ABORT,'safety_hold_active') WHERE NEW.decision='release' AND (
  EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL AND (h.case_id=NEW.case_id OR h.subject_user_id=(SELECT subject_user_id FROM safety_cases WHERE id=NEW.case_id)))
  OR EXISTS(SELECT 1 FROM safety_disclosures WHERE case_id=NEW.case_id AND state IN ('requested','approved'))
  OR EXISTS(SELECT 1 FROM safety_evidence_objects WHERE case_id=NEW.case_id AND stored_at IS NULL));
 SELECT RAISE(ABORT,'safety_case_capacity') WHERE (SELECT count(*) FROM safety_retention_decisions)>=100000;
END;
CREATE TRIGGER safety_retention_decisions_immutable BEFORE UPDATE ON safety_retention_decisions BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;
CREATE TRIGGER safety_retention_decisions_retained BEFORE DELETE ON safety_retention_decisions BEGIN SELECT RAISE(ABORT,'safety_case_immutable'); END;

-- WH-181 delete guards for review families that had none: a row leaves only with project or account cleanup, or when it is
-- terminal, unreferenced, outside the safety hold and the 25-row history window, and has its sealed review_receipts row.
CREATE TRIGGER app_page_review_retained BEFORE DELETE ON app_page_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'app_page_retained') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (OLD.config_json IS NULL AND NOT (OLD.status='applied') AND EXISTS(SELECT 1 FROM app_page_reviews x WHERE x.expires_at>OLD.expires_at AND x.config_json IS NULL AND x.project_id=OLD.project_id)))
  OR (EXISTS(SELECT 1 FROM app_page_settings WHERE review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM app_runs WHERE page_review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR (OLD.config_json IS NULL) OR OLD.id NOT IN (SELECT t.id FROM app_page_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' AND NOT (t.config_json IS NULL) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='app_page_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER backend_publication_review_retained BEFORE DELETE ON backend_publication_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'backend_publication_retained') WHERE NOT (OLD.status='applied' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (OLD.operation='unpublish' AND NOT (OLD.status='applied') AND EXISTS(SELECT 1 FROM backend_publication_reviews x WHERE x.expires_at>OLD.expires_at AND x.operation='unpublish' AND x.project_id=OLD.project_id)))
  OR (EXISTS(SELECT 1 FROM backend_publications WHERE review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM backend_form_reviews WHERE backend_publication_id=OLD.id)
   OR EXISTS(SELECT 1 FROM backend_public_usage WHERE publication_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR (OLD.operation='unpublish') OR OLD.id NOT IN (SELECT t.id FROM backend_publication_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' AND NOT (t.operation='unpublish') ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='backend_publication_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER backend_state_review_retained BEFORE DELETE ON backend_state_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'backend_state_retained') WHERE NOT (OLD.status='applied' OR (OLD.status IN ('preparing','ready') AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0 OR OLD.status='failed')
  OR (EXISTS(SELECT 1 FROM backend_state_reviews x WHERE x.restore_review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM backend_state_links WHERE review_id=OLD.id AND kind='export')
   OR (OLD.status='applied' AND OLD.base_revision+1=(SELECT revision FROM backend_state WHERE project_id=OLD.project_id)))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='applied') OR OLD.id NOT IN (SELECT t.id FROM backend_state_reviews t WHERE t.project_id=OLD.project_id AND t.status='applied' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='backend_state_reviews' AND id=OLD.id AND (OLD.status='applied')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER backend_nomination_retained BEFORE DELETE ON backend_nominations
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM backend_versions WHERE id=OLD.version_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'nomination_retained') WHERE NOT ((OLD.state='withdrawn' AND OLD.consent_at IS NOT NULL) OR (OLD.state='review' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0 OR (OLD.state='withdrawn' AND OLD.consent_at IS NULL))
  OR 0
  OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id)
  OR NOT (NOT ((OLD.state='withdrawn' AND OLD.consent_at IS NOT NULL)) OR OLD.id NOT IN (SELECT t.id FROM backend_nominations t WHERE t.user_id=OLD.user_id AND (t.state='withdrawn' AND t.consent_at IS NOT NULL) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='backend_nominations' AND id=OLD.id AND ((OLD.state='withdrawn' AND OLD.consent_at IS NOT NULL))=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER cloudflare_dns_action_retained BEFORE DELETE ON cloudflare_dns_actions
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM domain_claims WHERE id=OLD.claim_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cloudflare_dns_retained') WHERE NOT (OLD.state IN ('applied','unchanged','observed') OR (OLD.state='review' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR 0
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.state IN ('applied','unchanged','observed')) OR OLD.id NOT IN (SELECT t.id FROM cloudflare_dns_actions t WHERE t.project_id=OLD.project_id AND t.state IN ('applied','unchanged','observed') ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cloudflare_dns_actions' AND id=OLD.id AND (OLD.state IN ('applied','unchanged','observed'))=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER domain_connection_retained BEFORE DELETE ON domain_connections
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'domain_connection_retained') WHERE NOT (OLD.state='disconnected' OR (OLD.state='review' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR (EXISTS(SELECT 1 FROM domain_reconciliations WHERE connection_id=OLD.id)
   OR EXISTS(SELECT 1 FROM cloudflare_dns_actions WHERE connection_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.state='disconnected') OR OLD.id NOT IN (SELECT t.id FROM domain_connections t WHERE t.project_id=OLD.project_id AND t.state='disconnected' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='domain_connections' AND id=OLD.id AND (OLD.state='disconnected')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER github_backup_retained BEFORE DELETE ON github_backups
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM site_versions WHERE id=OLD.version_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'github_backup_retained') WHERE NOT (OLD.state='complete' OR (OLD.state='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0 OR OLD.state='failed')
  OR 0
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.state='complete') OR OLD.id NOT IN (SELECT t.id FROM github_backups t WHERE t.project_id=OLD.project_id AND t.state='complete' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='github_backups' AND id=OLD.id AND (OLD.state='complete')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER composition_plan_retained BEFORE DELETE ON composition_plans
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM chat_turns WHERE id=OLD.id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'composition_plan_retained') WHERE NOT (EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=OLD.id) OR (OLD.expires_at<=unixepoch()-3600 AND NOT EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=OLD.id)) OR 0)
  OR 0
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=OLD.id)) OR OLD.id NOT IN (SELECT t.id FROM composition_plans t WHERE t.project_id=OLD.project_id AND EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=t.id) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='composition_plans' AND id=OLD.id AND (EXISTS(SELECT 1 FROM backend_extension_uses u WHERE u.plan_id=OLD.id))=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER cms_setup_review_retained BEFORE DELETE ON cms_setup_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cms_setup_retained') WHERE NOT (OLD.status='approved' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR (EXISTS(SELECT 1 FROM cms_instances WHERE review_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='approved') OR OLD.id NOT IN (SELECT t.id FROM cms_setup_reviews t WHERE t.project_id=OLD.project_id AND t.status='approved' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cms_setup_reviews' AND id=OLD.id AND (OLD.status='approved')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER cms_publication_review_retained BEFORE DELETE ON cms_publication_reviews
WHEN EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id) AND EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM cms_instances WHERE project_id=OLD.project_id) AND EXISTS(SELECT 1 FROM cms_draft_requests WHERE id=OLD.draft_request_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cms_publication_retained') WHERE NOT (OLD.status='published' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR ((OLD.status='published' AND OLD.withdrawn=0)
   OR EXISTS(SELECT 1 FROM cms_publication_reviews x WHERE x.replaces_publication_id=OLD.id)
   OR EXISTS(SELECT 1 FROM cms_publication_media WHERE review_id=OLD.id)
   OR EXISTS(SELECT 1 FROM cms_unpublish_reviews WHERE publication_id=OLD.id)
   OR EXISTS(SELECT 1 FROM cms_discard_reviews WHERE publication_id=OLD.id))
  OR EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
  OR NOT (NOT (OLD.status='published') OR OLD.id NOT IN (SELECT t.id FROM cms_publication_reviews t WHERE t.project_id=OLD.project_id AND t.status='published' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cms_publication_reviews' AND id=OLD.id AND (OLD.status='published')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER cms_unpublish_review_retained BEFORE DELETE ON cms_unpublish_reviews
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=OLD.publication_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cms_unpublish_retained') WHERE NOT (OLD.status='complete' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR (1 AND NOT (OLD.status='complete') AND EXISTS(SELECT 1 FROM cms_unpublish_reviews x WHERE x.expires_at>OLD.expires_at AND 1 AND x.publication_id=OLD.publication_id)))
  OR 0
  OR EXISTS(SELECT 1 FROM cms_publication_reviews x JOIN safety_held_projects h ON h.project_id=x.project_id WHERE x.id=OLD.publication_id) OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id)
  OR NOT (NOT (OLD.status='complete') OR (1) OR OLD.id NOT IN (SELECT t.id FROM cms_unpublish_reviews t WHERE t.user_id=OLD.user_id AND t.status='complete' AND NOT (1) ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cms_unpublish_reviews' AND id=OLD.id AND (OLD.status='complete')=(outcome IN ('applied','withdrawn')));
END;
CREATE TRIGGER cms_discard_review_retained BEFORE DELETE ON cms_discard_reviews
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) AND EXISTS(SELECT 1 FROM cms_publication_reviews WHERE id=OLD.publication_id)
BEGIN
 -- Only a terminal, unreferenced, unheld row outside the history window may leave, and only with its sealed receipt.
 SELECT RAISE(ABORT,'cms_discard_retained') WHERE NOT (OLD.status='complete' OR (OLD.status='pending' AND OLD.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) OR 0)
  OR 0
  OR EXISTS(SELECT 1 FROM cms_publication_reviews x JOIN safety_held_projects h ON h.project_id=x.project_id WHERE x.id=OLD.publication_id) OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id)
  OR NOT (NOT (OLD.status='complete') OR OLD.id NOT IN (SELECT t.id FROM cms_discard_reviews t WHERE t.user_id=OLD.user_id AND t.status='complete' ORDER BY t.expires_at DESC,t.id DESC LIMIT 25))
  OR NOT EXISTS(SELECT 1 FROM review_receipts WHERE family='cms_discard_reviews' AND id=OLD.id AND (OLD.status='complete')=(outcome IN ('applied','withdrawn')));
END;

-- Ordinary deletion paths for held scope. Account holds cover the account cascade and every project of the
-- subject; project holds cover one project; object holds cover one project photo. Customer-facing callers
-- report their existing generic failure without the reason, so a hold is never disclosed.
CREATE TRIGGER safety_hold_account_retained BEFORE DELETE ON users
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE subject_user_id=OLD.id AND released_at IS NULL)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_project_retained BEFORE DELETE ON projects
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND ((scope='account' AND subject_user_id=OLD.owner_user_id) OR (scope IN ('project','object') AND project_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_project_owner BEFORE UPDATE OF owner_user_id ON projects
WHEN NEW.owner_user_id IS NOT OLD.owner_user_id AND EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL
 AND ((scope='account' AND subject_user_id=OLD.owner_user_id) OR (scope IN ('project','object') AND project_id=OLD.id)))
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_contact_retained BEFORE DELETE ON contact_submissions
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_contact_destination_retained BEFORE DELETE ON contact_notification_destinations
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
-- Photo removal (and its R2 cleanup queue entry), saved-version removal and visitor deletion/owner erasure.
CREATE TRIGGER safety_hold_file_retained BEFORE DELETE ON project_files
WHEN EXISTS(SELECT 1 FROM safety_held_files WHERE file_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_version_retained BEFORE DELETE ON site_versions
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
CREATE TRIGGER safety_hold_visitor_retained BEFORE DELETE ON app_visitors
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
-- R2 cleanup: a queued object of held scope (including one removed shortly before the hold) is not deleted.
CREATE TRIGGER safety_hold_file_cleanup_retained BEFORE DELETE ON file_cleanup
WHEN EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL
 AND ((scope='account' AND subject_user_id=OLD.owner_user_id) OR (scope='project' AND project_id=OLD.project_id)))
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;
-- Overwrites/discards that must not visibly fail: preserve the previous payload in restricted storage.
-- BEFORE, so the replaced photo's safety receipt is captured before profile_photo_safety_invalidate removes it.
CREATE TRIGGER safety_hold_profile_photo BEFORE UPDATE OF photo ON user_profiles
WHEN OLD.photo IS NOT NULL AND NEW.photo IS NOT OLD.photo
 AND EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id)
BEGIN
 INSERT INTO safety_preserved_records(hold_id,subject_user_id,project_id,source,source_id,payload_json,preserved_at)
 SELECT id,OLD.user_id,NULL,'profile_photo',OLD.user_id,json_object('photo',OLD.photo,'photoDigest',OLD.photo_digest,'revision',OLD.revision,
  'safety',json((SELECT json_object('digest',digest,'photoRevision',photo_revision,'policyVersion',policy_version,'state',state,'csamCheck',csam_check,'sexualCheck',sexual_check,'createdAt',created_at)
   FROM profile_photo_safety WHERE user_id=OLD.user_id))),unixepoch()
 FROM safety_preservation_holds WHERE released_at IS NULL AND scope='account' AND subject_user_id=OLD.user_id ORDER BY placed_at,id LIMIT 1;
END;
-- App visitor documents (owner decision, October 4, 2026): every overwrite inside a held project (visitor transition,
-- recovery restore or migration apply) keeps the previous revision, and a recovery-point copy cleared by point removal
-- or visitor revocation is kept. The customer action still succeeds; past capacity it fails closed.
CREATE TRIGGER safety_hold_app_document BEFORE UPDATE OF state_json ON app_documents
WHEN NEW.state_json IS NOT OLD.state_json
 AND EXISTS(SELECT 1 FROM app_visitors v JOIN safety_held_projects h ON h.project_id=v.project_id WHERE v.id=OLD.visitor_id)
BEGIN
 INSERT INTO safety_preserved_records(hold_id,subject_user_id,project_id,source,source_id,payload_json,preserved_at)
 SELECT h.id,p.owner_user_id,p.id,'app_document',OLD.visitor_id,json_object('visitor',OLD.visitor_id,'revision',OLD.revision,'state',json(OLD.state_json)),unixepoch()
 FROM app_visitors v JOIN projects p ON p.id=v.project_id JOIN safety_preservation_holds h ON h.released_at IS NULL
  AND ((h.scope='account' AND h.subject_user_id=p.owner_user_id) OR (h.scope='project' AND h.project_id=p.id))
 WHERE v.id=OLD.visitor_id ORDER BY h.placed_at,h.id LIMIT 1;
END;
CREATE TRIGGER safety_hold_app_recovery_document BEFORE DELETE ON app_recovery_documents
WHEN EXISTS(SELECT 1 FROM app_recovery_points r JOIN safety_held_projects h ON h.project_id=r.project_id WHERE r.id=OLD.point_id)
BEGIN
 INSERT INTO safety_preserved_records(hold_id,subject_user_id,project_id,source,source_id,payload_json,preserved_at)
 SELECT h.id,p.owner_user_id,p.id,'app_recovery_document',OLD.point_id,json_object('point',OLD.point_id,'visitor',OLD.visitor_id,'revision',OLD.revision,'state',json(OLD.state_json)),unixepoch()
 FROM app_recovery_points r JOIN projects p ON p.id=r.project_id JOIN safety_preservation_holds h ON h.released_at IS NULL
  AND ((h.scope='account' AND h.subject_user_id=p.owner_user_id) OR (h.scope='project' AND h.project_id=p.id))
 WHERE r.id=OLD.point_id ORDER BY h.placed_at,h.id LIMIT 1;
END;
CREATE TRIGGER safety_hold_chat_draft AFTER UPDATE OF envelope_json ON chat_interactions
WHEN OLD.envelope_json IS NOT NULL AND NEW.envelope_json IS NULL
 AND EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL
  AND ((scope='account' AND subject_user_id=OLD.user_id) OR (OLD.project_id IS NOT NULL AND scope='project' AND project_id=OLD.project_id)))
BEGIN
 INSERT INTO safety_preserved_records(hold_id,subject_user_id,project_id,source,source_id,payload_json,preserved_at)
 SELECT id,OLD.user_id,OLD.project_id,'chat_interaction_draft',OLD.id,json_object('envelope',json(OLD.envelope_json),'draft',json(OLD.draft_json),'answerRevision',OLD.answer_revision),unixepoch()
 FROM safety_preservation_holds WHERE released_at IS NULL
  AND ((scope='account' AND subject_user_id=OLD.user_id) OR (OLD.project_id IS NOT NULL AND scope='project' AND project_id=OLD.project_id)) ORDER BY placed_at,id LIMIT 1;
END;

-- Shadow cost events (WH-170; docs/cost-events.md). Append-only evidence about consumption, never authority to charge, credit,
-- admit or throttle: no customer-facing route reads or writes this table and `customerUnits` is the constant 0. One row per
-- (idempotency key, revision); the key is the SHA-256 of {dimension, source, sourceEventId}, derived by src/cost-events.ts.
-- Rows are immutable. The only deletion is the FK cascade of account closure (owner decision October 28, 2026): the owner's
-- events go with the owner and project, with no closure key and no tombstones; an append for an owner or project that no longer
-- exists is refused. `stale` marks a revision that arrived after a higher one (kept for audit, never counted). Heads are the
-- highest revision per key. Platform-scope rows (shared-account, control-plane) have no owner and are never cascaded.
CREATE TABLE cost_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 idempotency_key TEXT NOT NULL CHECK(length(idempotency_key)=64 AND idempotency_key NOT GLOB '*[^0-9a-f]*'),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 source TEXT NOT NULL CHECK(source IN ('inference-receipt','gateway-settlement','storage-operations','cloudflare-usage-import','liability-register','notification-delivery','connector-call')),
 dimension TEXT NOT NULL CHECK(length(dimension) BETWEEN 3 AND 64),
 scope TEXT NOT NULL CHECK(scope IN ('tenant','platform')),
 owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 resource_id TEXT CHECK(resource_id IS NULL OR length(resource_id)=36),
 pool TEXT CHECK(pool IS NULL OR pool IN ('shared-account','control-plane')),
 workload TEXT NOT NULL CHECK(length(workload) BETWEEN 3 AND 32),
 work_class TEXT NOT NULL CHECK(work_class IN ('task','retry','control','standing')),
 outcome TEXT NOT NULL CHECK(outcome IN ('settled','pending','uncertain','released')),
 quantity_value INTEGER CHECK(quantity_value IS NULL OR (typeof(quantity_value)='integer' AND quantity_value BETWEEN 0 AND 9007199254740991)),
 cost_basis TEXT NOT NULL CHECK(cost_basis IN ('tariff','receipt','provider-reported','shadow','unknown')),
 cost_micros INTEGER CHECK(cost_micros IS NULL OR (typeof(cost_micros)='integer' AND cost_micros BETWEEN 0 AND 9007199254740991)),
 exposure_micros INTEGER CHECK(exposure_micros IS NULL OR (typeof(exposure_micros)='integer' AND exposure_micros BETWEEN 0 AND 9007199254740991)),
 occurred_at TEXT NOT NULL CHECK(length(occurred_at)=24 AND substr(occurred_at,11,1)='T' AND substr(occurred_at,24,1)='Z' AND occurred_at NOT GLOB '*[^0-9TZ:.-]*'),
 observed_at TEXT NOT NULL CHECK(length(observed_at)=24 AND substr(observed_at,11,1)='T' AND substr(observed_at,24,1)='Z' AND observed_at NOT GLOB '*[^0-9TZ:.-]*' AND observed_at>=occurred_at),
 event_json TEXT NOT NULL CHECK(json_valid(event_json) AND json_type(event_json)='object' AND length(CAST(event_json AS BLOB))<=4096
  AND json_extract(event_json,'$.contractVersion')=1 AND json_extract(event_json,'$.customerUnits')=0
  AND json_extract(event_json,'$.idempotencyKey')=idempotency_key AND json_extract(event_json,'$.revision')=revision),
 stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
 received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(idempotency_key,revision),
 CHECK((scope='tenant' AND owner_id IS NOT NULL AND pool IS NULL)
  OR (scope='platform' AND owner_id IS NULL AND project_id IS NULL AND resource_id IS NULL AND pool IS NOT NULL)),
 CHECK(resource_id IS NULL OR project_id IS NOT NULL),
 CHECK((cost_basis='unknown' AND cost_micros IS NULL) OR (cost_basis='tariff' AND cost_micros IS NULL AND quantity_value IS NOT NULL) OR (cost_basis NOT IN ('unknown','tariff') AND cost_micros IS NOT NULL)),
 CHECK(cost_basis='unknown' OR exposure_micros IS NULL),
 CHECK(outcome NOT IN ('pending','uncertain') OR cost_basis='unknown')
);
CREATE INDEX cost_events_owner_period ON cost_events(owner_id,occurred_at) WHERE owner_id IS NOT NULL;
CREATE INDEX cost_events_project ON cost_events(project_id) WHERE project_id IS NOT NULL;
-- A project's registered owner must equal the event's owner, whichever statement writes the row.
CREATE TRIGGER cost_events_tenant_owner BEFORE INSERT ON cost_events
WHEN NEW.project_id IS NOT NULL AND (SELECT owner_user_id FROM projects WHERE id=NEW.project_id) IS NOT NEW.owner_id
BEGIN SELECT RAISE(ABORT,'cost_event_tenant_mismatch'); END;
CREATE TRIGGER cost_events_immutable BEFORE UPDATE ON cost_events
BEGIN SELECT RAISE(ABORT,'cost_event_immutable'); END;
-- Deletion is account closure only: the row's owner (and project, when named) is already gone when the cascade reaches it. A
-- platform row has no owner and is never deleted.
CREATE TRIGGER cost_events_append_only BEFORE DELETE ON cost_events
WHEN OLD.owner_id IS NULL OR (EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id) AND (OLD.project_id IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)))
BEGIN SELECT RAISE(ABORT,'cost_event_append_only'); END;
-- Capacity: restore admission reads at most 10,000 rows of a table, so the ledger refuses new events at 9,000 until WH-171 retires closed
-- periods. A refused emission is logged and never touches the receipt; the maintenance report shows the counter at 50% and 80%.
CREATE TRIGGER cost_events_capacity BEFORE INSERT ON cost_events
WHEN (SELECT count(*) FROM cost_events)>=9000
BEGIN SELECT RAISE(ABORT,'cost_event_capacity'); END;

-- Verified email change, rate limits and security reviews (WH-201; docs/email-change-and-compromise.md sections 2, 3 and 4).
-- An address is an unverified identifier until a change confirms it; verification is never authority, never a sign-in method, a
-- recovery factor or an approval. users.email_verified_at/_via move only together with users.email and only in lockstep with a
-- change row (trigger users_email_lockstep), so a repair or restore cannot revive an earlier verification state. There is no
-- password, recovery-code, link-sign-in or legacy column anywhere here. Times are Unix milliseconds. Every predicate of the
-- contract that the module in src/email-change repeats in application code is repeated below as a constraint or trigger, using
-- the database clock (unixepoch()), because the committing statement is the only place a race can be closed.

-- One row per requested change. Only the SHA-256 verifier of the confirmation token is stored (never the plaintext); the new
-- address is held in plain text only while the change is pending or inside its undo window, then replaced by its hash.
CREATE TABLE owner_email_changes (
 change_id TEXT PRIMARY KEY CHECK(length(change_id) BETWEEN 8 AND 64 AND change_id NOT GLOB '*[^A-Za-z0-9-]*'),
 account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 8 AND 64 AND request_id NOT GLOB '*[^A-Za-z0-9-]*'),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 new_address TEXT CHECK(new_address IS NULL OR (length(new_address) BETWEEN 3 AND 254 AND new_address=lower(new_address) AND new_address NOT GLOB '*[^!-~]*' AND instr(new_address,'@')>1)),
 new_address_hash TEXT NOT NULL CHECK(length(new_address_hash)=64 AND new_address_hash NOT GLOB '*[^0-9a-f]*'),
 epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 1 AND 9007199254740991),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=created_at+3600000),
 state TEXT NOT NULL CHECK(state IN ('pending','confirmed','undone','cancelled','superseded','stale','expired','undeliverable','unavailable')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 history TEXT NOT NULL CHECK(json_valid(history) AND json_type(history)='array' AND json_array_length(history) BETWEEN 1 AND 8 AND length(CAST(history AS BLOB))<=256),
 deliverable INTEGER NOT NULL CHECK(deliverable IN (0,1)),
 token_verifier TEXT CHECK(token_verifier IS NULL OR (length(token_verifier)=64 AND token_verifier NOT GLOB '*[^0-9a-f]*')),
 previous_address TEXT CHECK(previous_address IS NULL OR (length(previous_address) BETWEEN 3 AND 254 AND previous_address=lower(previous_address) AND previous_address NOT GLOB '*[^!-~]*' AND instr(previous_address,'@')>1)),
 previous_verified_at INTEGER CHECK(previous_verified_at IS NULL OR (typeof(previous_verified_at)='integer' AND previous_verified_at>0)),
 previous_verified_via TEXT CHECK(previous_verified_via IS NULL OR previous_verified_via='notify@whumpo.com'),
 receipt_verified_at INTEGER CHECK(receipt_verified_at IS NULL OR (typeof(receipt_verified_at)='integer' AND receipt_verified_at>0)),
 undo_until INTEGER CHECK(undo_until IS NULL OR (typeof(undo_until)='integer' AND undo_until=receipt_verified_at+604800000)),
 UNIQUE(account_id,request_id),
 CHECK((previous_verified_at IS NULL)=(previous_verified_via IS NULL)),
 CHECK((state IN ('confirmed','undone'))=(receipt_verified_at IS NOT NULL AND undo_until IS NOT NULL)),
 CHECK(state IN ('confirmed','undone') OR (previous_address IS NULL AND previous_verified_at IS NULL)),
 CHECK(state!='pending' OR new_address IS NOT NULL)
);
-- One pending change per account; a verifier identifies one change.
CREATE UNIQUE INDEX owner_email_changes_pending ON owner_email_changes(account_id) WHERE state='pending';
CREATE UNIQUE INDEX owner_email_changes_verifier ON owner_email_changes(token_verifier) WHERE token_verifier IS NOT NULL;
CREATE INDEX owner_email_changes_reserved ON owner_email_changes(previous_address) WHERE previous_address IS NOT NULL;
CREATE INDEX owner_email_changes_retention ON owner_email_changes(expires_at);

-- Rate-limit evidence (48 hours): the account's request and failure times, and hashed per-address daily send keys. A send key
-- carries no account and no address, only the hash that bounds messages to one destination across all accounts.
CREATE TABLE owner_email_change_limits (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 kind TEXT NOT NULL CHECK(kind IN ('request','send','failure')),
 account_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 address_key TEXT CHECK(address_key IS NULL OR (length(address_key)=64 AND address_key NOT GLOB '*[^0-9a-f]*')),
 at INTEGER NOT NULL CHECK(typeof(at)='integer' AND at>0),
 CHECK((kind='send' AND address_key IS NOT NULL AND account_id IS NULL) OR (kind IN ('request','failure') AND account_id IS NOT NULL AND address_key IS NULL))
);
CREATE INDEX owner_email_change_limits_account ON owner_email_change_limits(kind,account_id,at) WHERE account_id IS NOT NULL;
CREATE INDEX owner_email_change_limits_address ON owner_email_change_limits(address_key,at) WHERE address_key IS NOT NULL;
CREATE INDEX owner_email_change_limits_retention ON owner_email_change_limits(at);
-- At most 3 change requests per account and day, 3 confirmation messages per destination and day, 5 failed confirmations per
-- account and hour.
CREATE TRIGGER owner_email_change_limit_rate BEFORE INSERT ON owner_email_change_limits
WHEN NEW.at>unixepoch()*1000+60000
 OR (NEW.kind='request' AND (SELECT count(*) FROM owner_email_change_limits WHERE kind='request' AND account_id=NEW.account_id AND at>unixepoch()*1000-86400000)>=3)
 OR (NEW.kind='send' AND (SELECT count(*) FROM owner_email_change_limits WHERE kind='send' AND address_key=NEW.address_key AND at>unixepoch()*1000-86400000)>=3)
 OR (NEW.kind='failure' AND (SELECT count(*) FROM owner_email_change_limits WHERE kind='failure' AND account_id=NEW.account_id AND at>unixepoch()*1000-3600000)>=5)
BEGIN SELECT RAISE(ABORT,'email_change_rate_limited'); END;
CREATE TRIGGER owner_email_change_limit_immutable BEFORE UPDATE ON owner_email_change_limits
BEGIN SELECT RAISE(ABORT,'email_change_limit_immutable'); END;
-- Evidence is kept 48 hours (a deletion earlier than that would reset a limit); it goes sooner only with its account.
CREATE TRIGGER owner_email_change_limit_retained BEFORE DELETE ON owner_email_change_limits
WHEN OLD.at>unixepoch()*1000-172800000 AND (OLD.account_id IS NULL OR EXISTS(SELECT 1 FROM users WHERE id=OLD.account_id))
BEGIN SELECT RAISE(ABORT,'email_change_limit_retained'); END;

-- Insert: a new change is pending at revision 1 with no token, for a ready account at its current epoch, to an address that is
-- not the current one, and it comes with this account's request-limit row; a deliverable one also with its send-limit row.
CREATE TRIGGER owner_email_change_new BEFORE INSERT ON owner_email_changes
WHEN NEW.state!='pending' OR NEW.revision!=1 OR NEW.history!='["pending"]' OR NEW.token_verifier IS NOT NULL
 OR NEW.previous_address IS NOT NULL OR NEW.receipt_verified_at IS NOT NULL OR NEW.new_address IS NULL
BEGIN SELECT RAISE(ABORT,'email_change_new'); END;
CREATE TRIGGER owner_email_change_identity BEFORE INSERT ON owner_email_changes
WHEN NOT EXISTS(SELECT 1 FROM identity_accounts a JOIN users u ON u.id=a.account_id
  WHERE a.account_id=NEW.account_id AND a.stage='ready' AND a.auth_epoch=NEW.epoch AND u.email!=NEW.new_address)
BEGIN SELECT RAISE(ABORT,'email_change_identity'); END;
CREATE TRIGGER owner_email_change_limits_present BEFORE INSERT ON owner_email_changes
WHEN NOT EXISTS(SELECT 1 FROM owner_email_change_limits WHERE kind='request' AND account_id=NEW.account_id AND at>unixepoch()*1000-60000)
 OR (NEW.deliverable=1 AND NOT EXISTS(SELECT 1 FROM owner_email_change_limits WHERE kind='send' AND address_key=NEW.new_address_hash AND at>unixepoch()*1000-60000))
BEGIN SELECT RAISE(ABORT,'email_change_limits'); END;

-- Update: identity, binding and expiry never change; every write is revision+1; states only move forward.
CREATE TRIGGER owner_email_change_immutable BEFORE UPDATE ON owner_email_changes
WHEN NEW.change_id IS NOT OLD.change_id OR NEW.account_id IS NOT OLD.account_id OR NEW.request_id IS NOT OLD.request_id
 OR NEW.request_hash IS NOT OLD.request_hash OR NEW.new_address_hash IS NOT OLD.new_address_hash OR NEW.epoch IS NOT OLD.epoch
 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR NEW.deliverable IS NOT OLD.deliverable
BEGIN SELECT RAISE(ABORT,'email_change_immutable'); END;
CREATE TRIGGER owner_email_change_revision BEFORE UPDATE ON owner_email_changes
WHEN NEW.revision IS NOT OLD.revision+1
BEGIN SELECT RAISE(ABORT,'email_change_revision'); END;
CREATE TRIGGER owner_email_change_transition BEFORE UPDATE ON owner_email_changes
WHEN NEW.state IS NOT OLD.state AND NOT ((OLD.state='pending' AND NEW.state IN ('confirmed','cancelled','superseded','stale','expired','undeliverable','unavailable'))
 OR (OLD.state='confirmed' AND NEW.state='undone'))
BEGIN SELECT RAISE(ABORT,'email_change_transition'); END;
-- History grows by exactly one entry per transition, naming the new state, and never otherwise.
CREATE TRIGGER owner_email_change_history BEFORE UPDATE ON owner_email_changes
WHEN (NEW.state IS NOT OLD.state AND (json_array_length(NEW.history)!=json_array_length(OLD.history)+1 OR json_extract(NEW.history,'$[#-1]') NOT GLOB NEW.state||'*'
  OR substr(NEW.history,1,length(OLD.history)-1)!=substr(OLD.history,1,length(OLD.history)-1)))
 OR (NEW.state IS OLD.state AND NEW.history IS NOT OLD.history)
BEGIN SELECT RAISE(ABORT,'email_change_history'); END;
-- A pending change changes only its token verifier. A verifier is minted for a deliverable, unexpired change and cleared again by a
-- definite non-delivery; the plaintext token is never a column.
CREATE TRIGGER owner_email_change_claim BEFORE UPDATE ON owner_email_changes
WHEN OLD.state='pending' AND NEW.state='pending' AND (NEW.new_address IS NOT OLD.new_address OR NEW.previous_address IS NOT OLD.previous_address
  OR NEW.previous_verified_at IS NOT OLD.previous_verified_at OR NEW.previous_verified_via IS NOT OLD.previous_verified_via
  OR NEW.receipt_verified_at IS NOT OLD.receipt_verified_at OR NEW.undo_until IS NOT OLD.undo_until
  OR (NEW.token_verifier IS NOT NULL AND NEW.token_verifier IS NOT OLD.token_verifier AND (OLD.deliverable=0 OR unixepoch()*1000>=OLD.expires_at)))
BEGIN SELECT RAISE(ABORT,'email_change_claim'); END;
-- Confirmation: token verifier present and unchanged, unexpired, account ready at the unchanged epoch, address not the current one,
-- not another account's address and not another account's reserved previous address; the previous address and verification state
-- are the account's current ones; the undo window is seven days from the receipt time.
CREATE TRIGGER owner_email_change_confirm BEFORE UPDATE ON owner_email_changes
WHEN OLD.state='pending' AND NEW.state='confirmed' AND NOT (
 OLD.token_verifier IS NOT NULL AND NEW.token_verifier IS OLD.token_verifier AND NEW.new_address IS OLD.new_address
 AND unixepoch()*1000<OLD.expires_at
 AND NEW.receipt_verified_at BETWEEN unixepoch()*1000-60000 AND unixepoch()*1000+60000
 AND EXISTS(SELECT 1 FROM identity_accounts a JOIN users u ON u.id=a.account_id
  WHERE a.account_id=OLD.account_id AND a.stage='ready' AND a.auth_epoch=OLD.epoch AND u.email!=OLD.new_address AND u.email IS NEW.previous_address
   AND u.email_verified_at IS NEW.previous_verified_at AND u.email_verified_via IS NEW.previous_verified_via)
 AND NOT EXISTS(SELECT 1 FROM users o WHERE o.email=OLD.new_address AND o.id!=OLD.account_id)
 AND NOT EXISTS(SELECT 1 FROM owner_email_changes r WHERE r.account_id!=OLD.account_id AND r.state='confirmed' AND r.previous_address=OLD.new_address AND r.undo_until>unixepoch()*1000))
BEGIN SELECT RAISE(ABORT,'email_change_confirm'); END;
-- The other pending exits: expiry needs the expiry time, stale needs a moved epoch, unavailable needs a holder, undeliverable
-- clears the verifier, and none of them carries a receipt.
CREATE TRIGGER owner_email_change_close BEFORE UPDATE ON owner_email_changes
WHEN OLD.state='pending' AND NEW.state IN ('cancelled','superseded','stale','expired','undeliverable','unavailable') AND NOT (
 NEW.receipt_verified_at IS NULL AND NEW.undo_until IS NULL AND NEW.previous_address IS NULL AND NEW.new_address IS OLD.new_address
 AND (NEW.state!='expired' OR unixepoch()*1000>=OLD.expires_at)
 AND (NEW.state!='stale' OR NOT EXISTS(SELECT 1 FROM identity_accounts a WHERE a.account_id=OLD.account_id AND a.stage='ready' AND a.auth_epoch=OLD.epoch))
 AND (NEW.state!='unavailable' OR EXISTS(SELECT 1 FROM users o WHERE o.email=OLD.new_address AND o.id!=OLD.account_id)
  OR EXISTS(SELECT 1 FROM owner_email_changes r WHERE r.account_id!=OLD.account_id AND r.state='confirmed' AND r.previous_address=OLD.new_address AND r.undo_until>unixepoch()*1000))
 AND (NEW.state!='undeliverable' OR NEW.token_verifier IS NULL)
 AND (NEW.state IN ('undeliverable') OR NEW.token_verifier IS OLD.token_verifier))
BEGIN SELECT RAISE(ABORT,'email_change_close'); END;
-- Undo: inside the window, only while the account still holds the new address; it restores the recorded previous state.
CREATE TRIGGER owner_email_change_undo BEFORE UPDATE ON owner_email_changes
WHEN OLD.state='confirmed' AND NEW.state='undone' AND NOT (
 unixepoch()*1000<OLD.undo_until AND OLD.previous_address IS NOT NULL AND NEW.previous_address IS OLD.previous_address
 AND NEW.previous_verified_at IS OLD.previous_verified_at AND NEW.previous_verified_via IS OLD.previous_verified_via
 AND NEW.receipt_verified_at IS OLD.receipt_verified_at AND NEW.undo_until IS OLD.undo_until AND NEW.token_verifier IS OLD.token_verifier
 AND NEW.new_address IS OLD.new_address
 AND EXISTS(SELECT 1 FROM identity_accounts a JOIN users u ON u.id=a.account_id WHERE a.account_id=OLD.account_id AND a.stage='ready' AND u.email=OLD.new_address))
BEGIN SELECT RAISE(ABORT,'email_change_undo'); END;
-- A closed change (confirmed, undone or any terminal state) keeps its facts; the only write is the redaction of the plaintext
-- addresses: the new address once the change is closed (a confirmed one when its undo window ends) and the previous address when
-- the window has ended or the change was undone.
CREATE TRIGGER owner_email_change_frozen BEFORE UPDATE ON owner_email_changes
WHEN NEW.state IS OLD.state AND OLD.state!='pending' AND (NEW.token_verifier IS NOT OLD.token_verifier
  OR NEW.previous_verified_at IS NOT OLD.previous_verified_at OR NEW.previous_verified_via IS NOT OLD.previous_verified_via
  OR NEW.receipt_verified_at IS NOT OLD.receipt_verified_at OR NEW.undo_until IS NOT OLD.undo_until
  OR (NEW.new_address IS NOT OLD.new_address AND (NEW.new_address IS NOT NULL OR (OLD.state='confirmed' AND unixepoch()*1000<OLD.undo_until)))
  OR (NEW.previous_address IS NOT OLD.previous_address AND (NEW.previous_address IS NOT NULL OR (OLD.state='confirmed' AND unixepoch()*1000<OLD.undo_until))))
BEGIN SELECT RAISE(ABORT,'email_change_frozen'); END;
-- Deletion is retention or closure only: a pending change, a change inside its undo window, or one closed less than 30 days ago
-- (counted from the later of its expiry and its undo deadline) stays while its account exists.
CREATE TRIGGER owner_email_change_retained BEFORE DELETE ON owner_email_changes
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.account_id)
 AND (OLD.state='pending' OR max(OLD.expires_at,COALESCE(OLD.undo_until,0))>unixepoch()*1000-2592000000)
BEGIN SELECT RAISE(ABORT,'email_change_retained'); END;

-- The account's address and its verification state move only together, and only in lockstep with a change row: forward to the
-- confirmed change's new address verified at its receipt time by the platform sender, or back to exactly the recorded previous
-- address and state of an undone change. No profile write, repair or restore can set, advance or revive them any other way.
CREATE TRIGGER users_email_lockstep BEFORE UPDATE OF email,email_verified_at,email_verified_via ON users
WHEN (NEW.email IS NOT OLD.email OR NEW.email_verified_at IS NOT OLD.email_verified_at OR NEW.email_verified_via IS NOT OLD.email_verified_via)
 AND NOT (
  EXISTS(SELECT 1 FROM owner_email_changes c WHERE c.account_id=OLD.id AND c.state='confirmed' AND c.new_address=NEW.email AND c.previous_address IS OLD.email
   AND c.previous_verified_at IS OLD.email_verified_at AND c.previous_verified_via IS OLD.email_verified_via AND c.receipt_verified_at=NEW.email_verified_at
   AND NEW.email_verified_via='notify@whumpo.com')
  OR EXISTS(SELECT 1 FROM owner_email_changes c WHERE c.account_id=OLD.id AND c.state='undone' AND c.new_address IS OLD.email AND c.previous_address=NEW.email
   AND c.previous_verified_at IS NEW.email_verified_at AND c.previous_verified_via IS NEW.email_verified_via))
BEGIN SELECT RAISE(ABORT,'users_email_lockstep'); END;
-- A new account starts unverified, and cannot take an address another account holds as its reserved previous address.
CREATE TRIGGER users_email_new BEFORE INSERT ON users
WHEN NEW.email_verified_at IS NOT NULL
 OR EXISTS(SELECT 1 FROM owner_email_changes c WHERE c.state='confirmed' AND c.previous_address=NEW.email AND c.undo_until>unixepoch()*1000)
BEGIN SELECT RAISE(ABORT,'users_email_new'); END;

-- Compromise review snapshot, its replacement kit offer (verifier only) and its commit receipt (WH-203 reads and writes these rows).
-- The receipt carries identifiers, counts and states; it has no content-recovery field and claims account recovery only.
CREATE TABLE owner_security_reviews (
 review_id TEXT PRIMARY KEY CHECK(length(review_id) BETWEEN 1 AND 64 AND review_id NOT GLOB '*[^A-Za-z0-9-]*'),
 account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 1 AND 9007199254740991),
 credential_revision INTEGER NOT NULL CHECK(typeof(credential_revision)='integer' AND credential_revision BETWEEN 0 AND 9007199254740991),
 kit_generation INTEGER NOT NULL CHECK(typeof(kit_generation)='integer' AND kit_generation BETWEEN 0 AND 9007199254740991),
 credentials TEXT NOT NULL CHECK(json_valid(credentials) AND json_type(credentials)='array' AND length(CAST(credentials AS BLOB))<=2048),
 connections TEXT NOT NULL CHECK(json_valid(connections) AND json_type(connections)='array' AND length(CAST(connections AS BLOB))<=2048),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at=created_at+600000),
 state TEXT NOT NULL CHECK(state IN ('open','committed')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 kit_offer_id TEXT CHECK(kit_offer_id IS NULL OR (length(kit_offer_id) BETWEEN 1 AND 64 AND kit_offer_id NOT GLOB '*[^A-Za-z0-9-]*')),
 kit_verifier TEXT CHECK(kit_verifier IS NULL OR (length(kit_verifier)=64 AND kit_verifier NOT GLOB '*[^0-9a-f]*')),
 kit_offer_created_at INTEGER CHECK(kit_offer_created_at IS NULL OR typeof(kit_offer_created_at)='integer'),
 kit_offer_expires_at INTEGER CHECK(kit_offer_expires_at IS NULL OR typeof(kit_offer_expires_at)='integer'),
 kit_saved_at INTEGER CHECK(kit_saved_at IS NULL OR typeof(kit_saved_at)='integer'),
 commit_request_id TEXT CHECK(commit_request_id IS NULL OR (length(commit_request_id) BETWEEN 8 AND 64 AND commit_request_id NOT GLOB '*[^A-Za-z0-9-]*')),
 commit_request_hash TEXT CHECK(commit_request_hash IS NULL OR (length(commit_request_hash)=64 AND commit_request_hash NOT GLOB '*[^0-9a-f]*')),
 receipt TEXT CHECK(receipt IS NULL OR (json_valid(receipt) AND json_type(receipt)='object' AND length(CAST(receipt AS BLOB))<=4096 AND json_extract(receipt,'$.accountRecoveryOnly')=1 AND json_extract(receipt,'$.sessionsRevoked')='all')),
 committed_at INTEGER CHECK(committed_at IS NULL OR typeof(committed_at)='integer'),
 UNIQUE(account_id,commit_request_id),
 CHECK((kit_offer_id IS NULL)=(kit_verifier IS NULL) AND (kit_offer_id IS NULL)=(kit_offer_created_at IS NULL) AND (kit_offer_id IS NULL)=(kit_offer_expires_at IS NULL)),
 CHECK(kit_saved_at IS NULL OR kit_offer_id IS NOT NULL),
 CHECK(kit_offer_id IS NULL OR (kit_offer_expires_at>kit_offer_created_at AND kit_offer_created_at>=created_at AND kit_offer_expires_at<=kit_offer_created_at+1800000 AND kit_offer_expires_at<=expires_at)),
 CHECK(kit_saved_at IS NULL OR (kit_saved_at>=kit_offer_created_at AND kit_saved_at<kit_offer_expires_at)),
 CHECK((state='open' AND commit_request_id IS NULL AND commit_request_hash IS NULL AND receipt IS NULL AND committed_at IS NULL)
  OR (state='committed' AND commit_request_id IS NOT NULL AND commit_request_hash IS NOT NULL AND receipt IS NOT NULL AND committed_at IS NOT NULL)),
 -- A kit that the receipt says was rotated must have been saved first (save-before-rotation).
 CHECK(receipt IS NULL OR json_extract(receipt,'$.kitRotated')=0 OR kit_saved_at IS NOT NULL)
);
CREATE INDEX owner_security_reviews_account ON owner_security_reviews(account_id);
CREATE INDEX owner_security_reviews_retention ON owner_security_reviews(expires_at);
-- A review binds the account's current epoch, credential revision and kit generation; an account keeps at most 20 committed or unexpired (a storage bound); expired open reviews do not count and may be deleted.
CREATE TRIGGER owner_security_review_new BEFORE INSERT ON owner_security_reviews
WHEN NEW.state!='open' OR NEW.revision!=1 OR NEW.kit_offer_id IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM identity_accounts a WHERE a.account_id=NEW.account_id AND a.stage='ready' AND a.auth_epoch=NEW.epoch
  AND a.credential_revision=NEW.credential_revision AND a.kit_generation=NEW.kit_generation)
 OR (SELECT count(*) FROM owner_security_reviews WHERE account_id=NEW.account_id AND (state='committed' OR expires_at>unixepoch()*1000))>=20
BEGIN SELECT RAISE(ABORT,'security_review_new'); END;
CREATE TRIGGER owner_security_review_guard BEFORE UPDATE ON owner_security_reviews
WHEN OLD.state='committed' OR NEW.revision IS NOT OLD.revision+1 OR NEW.review_id IS NOT OLD.review_id OR NEW.account_id IS NOT OLD.account_id
 OR NEW.epoch IS NOT OLD.epoch OR NEW.credential_revision IS NOT OLD.credential_revision OR NEW.kit_generation IS NOT OLD.kit_generation
 OR NEW.credentials IS NOT OLD.credentials OR NEW.connections IS NOT OLD.connections OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR (OLD.kit_offer_id IS NOT NULL AND (NEW.kit_offer_id IS NOT OLD.kit_offer_id OR NEW.kit_verifier IS NOT OLD.kit_verifier OR NEW.kit_offer_created_at IS NOT OLD.kit_offer_created_at OR NEW.kit_offer_expires_at IS NOT OLD.kit_offer_expires_at))
 OR (OLD.kit_saved_at IS NOT NULL AND NEW.kit_saved_at IS NOT OLD.kit_saved_at)
BEGIN SELECT RAISE(ABORT,'security_review_guard'); END;
-- Commit: the review is open and unexpired, the epoch advanced by exactly one in the same batch (which also deleted the older
-- sessions, grants, challenges and kit offers), and the receipt names that epoch.
CREATE TRIGGER owner_security_review_commit BEFORE UPDATE ON owner_security_reviews
WHEN NEW.state='committed' AND NOT (
 OLD.state='open' AND unixepoch()*1000<OLD.expires_at AND NEW.committed_at BETWEEN unixepoch()*1000-60000 AND unixepoch()*1000+60000
 AND json_extract(NEW.receipt,'$.reviewId')=OLD.review_id AND json_extract(NEW.receipt,'$.epoch')=OLD.epoch+1
 AND EXISTS(SELECT 1 FROM identity_accounts a WHERE a.account_id=OLD.account_id AND a.auth_epoch=OLD.epoch+1))
BEGIN SELECT RAISE(ABORT,'security_review_commit'); END;
CREATE TRIGGER owner_security_review_retained BEFORE DELETE ON owner_security_reviews
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.account_id) AND COALESCE(OLD.committed_at,OLD.expires_at)>unixepoch()*1000-7776000000
 AND NOT (OLD.state='open' AND OLD.expires_at<=unixepoch()*1000)
BEGIN SELECT RAISE(ABORT,'security_review_retained'); END;

-- WH-143 request-bound lookup consent (docs/connectors.md "Request-bound lookup and data-use consent"). One row is one exact lookup the
-- owner confirmed: owner, provider, operation, credential, parameter digest and destination are fixed at issue, the row lives at most
-- 15 minutes, and it is used once. Disconnect or reconnection voids open rows (adapter wiring is later; the state exists now).
CREATE TABLE lookup_consents (
 consent_id TEXT PRIMARY KEY CHECK(length(consent_id) BETWEEN 1 AND 64 AND consent_id NOT GLOB '*[^A-Za-z0-9-]*'),
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('gmail','google-calendar','outlook-email','microsoft-calendar','hubspot')),
 operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 64 AND operation_id NOT GLOB '*[^A-Za-z0-9.]*'),
 credential_id TEXT NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 128 AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 params_digest TEXT NOT NULL CHECK(length(params_digest)=64 AND params_digest NOT GLOB '*[^0-9a-f]*'),
 destination TEXT NOT NULL CHECK(destination IN ('owner-panel','model-context')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at<=created_at+900000),
 state TEXT NOT NULL CHECK(state IN ('issued','confirmed','used','voided')),
 confirmed_at INTEGER CHECK(confirmed_at IS NULL OR typeof(confirmed_at)='integer'),
 settled_at INTEGER CHECK(settled_at IS NULL OR typeof(settled_at)='integer'),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 CHECK((state='issued' AND confirmed_at IS NULL AND settled_at IS NULL)
  OR (state='confirmed' AND confirmed_at IS NOT NULL AND confirmed_at>=created_at AND settled_at IS NULL)
  OR (state='used' AND confirmed_at IS NOT NULL AND confirmed_at>=created_at AND settled_at>=confirmed_at)
  OR (state='voided' AND settled_at>=created_at))
);
CREATE INDEX lookup_consents_owner ON lookup_consents(owner_id,state);
CREATE INDEX lookup_consents_retention ON lookup_consents(expires_at);
-- Issue: a fresh unconfirmed row; an owner holds at most 20 unexpired ones (a storage bound).
CREATE TRIGGER lookup_consent_new BEFORE INSERT ON lookup_consents
WHEN NEW.state!='issued' OR NEW.revision!=1
 OR (SELECT count(*) FROM lookup_consents WHERE owner_id=NEW.owner_id AND state IN ('issued','confirmed') AND expires_at>unixepoch()*1000)>=20
BEGIN SELECT RAISE(ABORT,'lookup_consent_new'); END;
-- Binding columns never change. issued->confirmed->used is the only path to use, each step needs an unexpired row, and used or voided is final.
CREATE TRIGGER lookup_consent_guard BEFORE UPDATE ON lookup_consents
WHEN OLD.state IN ('used','voided') OR NEW.revision IS NOT OLD.revision+1 OR NEW.consent_id IS NOT OLD.consent_id OR NEW.owner_id IS NOT OLD.owner_id
 OR NEW.provider IS NOT OLD.provider OR NEW.operation_id IS NOT OLD.operation_id OR NEW.credential_id IS NOT OLD.credential_id
 OR NEW.params_digest IS NOT OLD.params_digest OR NEW.destination IS NOT OLD.destination OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NOT ((OLD.state='issued' AND NEW.state IN ('confirmed','voided')) OR (OLD.state='confirmed' AND NEW.state IN ('used','voided')))
 OR (NEW.state IN ('confirmed','used') AND unixepoch()*1000>=OLD.expires_at)
 OR (NEW.state IN ('used','voided') AND OLD.state='confirmed' AND NEW.confirmed_at IS NOT OLD.confirmed_at)
BEGIN SELECT RAISE(ABORT,'lookup_consent_guard'); END;
-- Rows are kept seven days after they were used, voided or expired, then deleted by bounded maintenance (the account cascade also removes them).
CREATE TRIGGER lookup_consent_retained BEFORE DELETE ON lookup_consents
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id) AND COALESCE(OLD.settled_at,OLD.expires_at)>unixepoch()*1000-604800000
BEGIN SELECT RAISE(ABORT,'lookup_consent_retained'); END;

-- WH-143 minimized connector action receipts for the new providers (docs/connectors.md "Data classification"). Identifiers, digests,
-- price, state and a bounded detail code only: no message, event or contact body, recipient list, provider error body or credential.
-- States are the frozen receipt states; the reviewed body itself would live only in the planned connector-content class.
CREATE TABLE connector_receipts (
 receipt_id TEXT PRIMARY KEY CHECK(length(receipt_id) BETWEEN 1 AND 64 AND receipt_id NOT GLOB '*[^A-Za-z0-9-]*'),
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 provider TEXT NOT NULL CHECK(provider IN ('gmail','google-calendar','outlook-email','microsoft-calendar','hubspot')),
 operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 64 AND operation_id NOT GLOB '*[^A-Za-z0-9.]*'),
 authority TEXT NOT NULL CHECK(authority IN ('owner-request','approved-rule')),
 rule_revision INTEGER CHECK(rule_revision IS NULL OR (typeof(rule_revision)='integer' AND rule_revision>=1)),
 credential_id TEXT NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 128 AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 provider_account_id TEXT NOT NULL CHECK(length(provider_account_id) BETWEEN 1 AND 128 AND provider_account_id NOT GLOB '*[^ -~]*'),
 destination_id TEXT NOT NULL CHECK(length(destination_id) BETWEEN 1 AND 256 AND destination_id NOT GLOB '*[^ -~]*'),
 operation_digest TEXT NOT NULL CHECK(length(operation_digest)=64 AND operation_digest NOT GLOB '*[^0-9a-f]*'),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64 AND request_digest NOT GLOB '*[^0-9a-f]*'),
 review_digest TEXT NOT NULL CHECK(length(review_digest)=64 AND review_digest NOT GLOB '*[^0-9a-f]*'),
 price_units INTEGER NOT NULL CHECK(typeof(price_units)='integer' AND price_units BETWEEN 0 AND 1000000),
 price_basis TEXT NOT NULL CHECK(price_basis IN ('plan-inclusion','quoted')),
 state TEXT NOT NULL CHECK(state IN ('review','dispatching','applied','unchanged','uncertain','observed','failed','expired','cancelled')),
 provider_object_id TEXT CHECK(provider_object_id IS NULL OR (length(provider_object_id) BETWEEN 1 AND 256 AND provider_object_id NOT GLOB '*[^ -~]*')),
 detail_code TEXT CHECK(detail_code IS NULL OR (length(detail_code) BETWEEN 1 AND 40 AND detail_code NOT GLOB '*[^a-z0-9-]*')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>created_at AND expires_at<=created_at+3600000),
 updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=created_at),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 CHECK((authority='approved-rule')=(rule_revision IS NOT NULL)),
 CHECK(price_basis='quoted' OR price_units=0),
 CHECK(provider_object_id IS NULL OR state IN ('applied','unchanged','uncertain','observed'))
);
CREATE INDEX connector_receipts_owner ON connector_receipts(owner_id,state);
CREATE INDEX connector_receipts_retention ON connector_receipts(updated_at);
-- A new receipt starts in review; an owner keeps at most 2000 (a storage bound, deletion is by maintenance and account closure).
CREATE TRIGGER connector_receipt_new BEFORE INSERT ON connector_receipts
WHEN NEW.state!='review' OR NEW.revision!=1 OR NEW.provider_object_id IS NOT NULL OR NEW.detail_code IS NOT NULL OR NEW.updated_at!=NEW.created_at
 OR (SELECT count(*) FROM connector_receipts WHERE owner_id=NEW.owner_id)>=2000
BEGIN SELECT RAISE(ABORT,'connector_receipt_new'); END;
-- Binding columns never change. review->dispatching needs an unexpired review (the claim); a dispatched receipt only settles;
-- uncertain is resolved only by reconciliation (observed or failed); applied, unchanged, observed, failed, expired and cancelled are final.
CREATE TRIGGER connector_receipt_guard BEFORE UPDATE ON connector_receipts
WHEN OLD.state IN ('applied','unchanged','observed','failed','expired','cancelled') OR NEW.revision IS NOT OLD.revision+1
 OR NEW.receipt_id IS NOT OLD.receipt_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.provider IS NOT OLD.provider OR NEW.operation_id IS NOT OLD.operation_id
 OR NEW.authority IS NOT OLD.authority OR NEW.rule_revision IS NOT OLD.rule_revision OR NEW.credential_id IS NOT OLD.credential_id
 OR NEW.provider_account_id IS NOT OLD.provider_account_id OR NEW.destination_id IS NOT OLD.destination_id OR NEW.operation_digest IS NOT OLD.operation_digest
 OR NEW.request_digest IS NOT OLD.request_digest OR NEW.review_digest IS NOT OLD.review_digest OR NEW.price_units IS NOT OLD.price_units
 OR NEW.price_basis IS NOT OLD.price_basis OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
 OR NEW.updated_at<OLD.updated_at
 OR NOT ((OLD.state='review' AND NEW.state IN ('dispatching','expired','cancelled'))
  OR (OLD.state='dispatching' AND NEW.state IN ('applied','unchanged','uncertain','failed'))
  OR (OLD.state='uncertain' AND NEW.state IN ('observed','failed')))
 OR (NEW.state='dispatching' AND unixepoch()*1000>=OLD.expires_at)
 OR (NEW.state='expired' AND unixepoch()*1000<OLD.expires_at)
BEGIN SELECT RAISE(ABORT,'connector_receipt_guard'); END;
-- Receipts are kept 400 days after their last change, then deleted by bounded maintenance; a dispatching or uncertain receipt is never
-- deleted while the account exists. The account cascade removes the rest.
CREATE TRIGGER connector_receipt_retained BEFORE DELETE ON connector_receipts
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id)
 AND (OLD.state IN ('dispatching','uncertain') OR OLD.updated_at>unixepoch()*1000-34560000000)
BEGIN SELECT RAISE(ABORT,'connector_receipt_retained'); END;

-- WH-018 account closure record (docs/account-closure.md "Slice 1"). Platform-scoped and deliberately without a foreign key to users:
-- the record outlives the account it closes, so the account cascade neither blocks on nor erases it. No route, job or store reads it yet.
-- States only move forward: requested -> reviewed -> confirmed -> quiescing -> closed, cancelled before closed, failed from confirmed or
-- quiescing; closed, cancelled and failed are final. The same predicates live in src/account-closure/machine.ts.
CREATE TABLE account_closures (
 closure_id TEXT PRIMARY KEY CHECK(length(closure_id) BETWEEN 1 AND 64 AND closure_id NOT GLOB '*[^A-Za-z0-9-]*'),
 account_id TEXT NOT NULL CHECK(length(account_id) BETWEEN 1 AND 128),
 state TEXT NOT NULL CHECK(state IN ('requested','reviewed','confirmed','quiescing','closed','cancelled','failed')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 requested_at INTEGER NOT NULL CHECK(typeof(requested_at)='integer' AND requested_at>0),
 updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>=requested_at),
 review_digest TEXT CHECK(review_digest IS NULL OR (length(review_digest)=64 AND review_digest NOT GLOB '*[^0-9a-f]*')),
 quiesced_at INTEGER CHECK(quiesced_at IS NULL OR (typeof(quiesced_at)='integer' AND quiesced_at>=requested_at)),
 closed_at INTEGER CHECK(closed_at IS NULL OR (typeof(closed_at)='integer' AND closed_at>=requested_at)),
 failure_code TEXT CHECK(failure_code IS NULL OR (length(failure_code) BETWEEN 1 AND 64 AND failure_code NOT GLOB '*[^a-z-]*')),
 history TEXT NOT NULL CHECK(json_valid(history) AND json_type(history)='array' AND json_array_length(history) BETWEEN 1 AND 8 AND length(history)<=200),
 CHECK((state IN ('reviewed','confirmed','quiescing','closed')) <= (review_digest IS NOT NULL)),
 CHECK((state IN ('quiescing','closed')) <= (quiesced_at IS NOT NULL)),
 CHECK((state='closed')=(closed_at IS NOT NULL)),
 CHECK((state='failed')=(failure_code IS NOT NULL))
);
CREATE UNIQUE INDEX account_closures_open ON account_closures(account_id) WHERE state IN ('requested','reviewed','confirmed','quiescing');
CREATE INDEX account_closures_account ON account_closures(account_id);
-- A closure starts requested at revision 1 with its own history.
CREATE TRIGGER account_closure_new BEFORE INSERT ON account_closures
WHEN NEW.state!='requested' OR NEW.revision!=1 OR NEW.updated_at!=NEW.requested_at OR NEW.history!='["requested"]'
BEGIN SELECT RAISE(ABORT,'account_closure_new'); END;
-- Identity never changes; every update is one forward step that appends exactly that state to the history; a terminal row is immutable.
CREATE TRIGGER account_closure_guard BEFORE UPDATE ON account_closures
WHEN OLD.state IN ('closed','cancelled','failed') OR NEW.revision IS NOT OLD.revision+1
 OR NEW.closure_id IS NOT OLD.closure_id OR NEW.account_id IS NOT OLD.account_id OR NEW.requested_at IS NOT OLD.requested_at
 OR NEW.updated_at<OLD.updated_at
 OR NOT ((OLD.state='requested' AND NEW.state IN ('reviewed','cancelled'))
  OR (OLD.state='reviewed' AND NEW.state IN ('confirmed','cancelled'))
  OR (OLD.state='confirmed' AND NEW.state IN ('quiescing','cancelled','failed'))
  OR (OLD.state='quiescing' AND NEW.state IN ('closed','cancelled','failed')))
 OR NEW.history IS NOT json_insert(OLD.history,'$[#]',NEW.state)
 OR (NEW.review_digest IS NOT OLD.review_digest AND NOT (OLD.state='requested' AND NEW.state='reviewed'))
 OR (NEW.quiesced_at IS NOT OLD.quiesced_at AND NOT (OLD.state='confirmed' AND NEW.state='quiescing'))
BEGIN SELECT RAISE(ABORT,'account_closure_guard'); END;
-- No age-based retention is approved (docs/data-lifecycle.json); the record is kept until a later reviewed decision.
CREATE TRIGGER account_closure_retained BEFORE DELETE ON account_closures
BEGIN SELECT RAISE(ABORT,'account_closure_retained'); END;

-- WH-145 rule approval (docs/connectors.md "Rule authority"). One row is the owner's approval of one deterministic rule revision to run
-- one connector action: operation, destination digest, body template digest, per-period limit and credential are fixed at issue.
-- The use counter belongs to the current UTC day on the database clock and only moves one step at a time, never past the limit.
-- Digests and identifiers only: no destination, body or credential. src/connector-catalog/rule-authority.ts decides; the job runner (WH-069) is not wired.
CREATE TABLE rule_approvals (
 approval_id TEXT PRIMARY KEY CHECK(length(approval_id) BETWEEN 1 AND 64 AND approval_id NOT GLOB '*[^A-Za-z0-9-]*'),
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 rule_id TEXT NOT NULL CHECK(length(rule_id) BETWEEN 1 AND 64 AND rule_id NOT GLOB '*[^A-Za-z0-9-]*'),
 rule_revision INTEGER NOT NULL CHECK(typeof(rule_revision)='integer' AND rule_revision BETWEEN 1 AND 9007199254740991),
 provider TEXT NOT NULL CHECK(provider IN ('gmail','google-calendar','outlook-email','microsoft-calendar','hubspot')),
 operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 64 AND operation_id NOT GLOB '*[^A-Za-z0-9.]*'),
 destination_digest TEXT NOT NULL CHECK(length(destination_digest)=64 AND destination_digest NOT GLOB '*[^0-9a-f]*'),
 template_digest TEXT NOT NULL CHECK(length(template_digest)=64 AND template_digest NOT GLOB '*[^0-9a-f]*'),
 credential_id TEXT NOT NULL CHECK(length(credential_id) BETWEEN 1 AND 128 AND credential_id NOT GLOB '*[^A-Za-z0-9_-]*'),
 max_per_period INTEGER NOT NULL CHECK(typeof(max_per_period)='integer' AND max_per_period BETWEEN 1 AND 1000),
 period_start INTEGER NOT NULL CHECK(typeof(period_start)='integer' AND period_start>=0 AND period_start%86400000=0),
 used_count INTEGER NOT NULL CHECK(typeof(used_count)='integer' AND used_count BETWEEN 0 AND 1000 AND used_count<=max_per_period),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 revoked_at INTEGER CHECK(revoked_at IS NULL OR (typeof(revoked_at)='integer' AND revoked_at>=created_at)),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 UNIQUE(owner_id,rule_id,rule_revision)
);
CREATE INDEX rule_approvals_owner ON rule_approvals(owner_id);
-- Issue: unused and unrevoked; an owner holds at most 200 approvals (a storage bound; a revoked one may be deleted).
CREATE TRIGGER rule_approval_new BEFORE INSERT ON rule_approvals
WHEN NEW.revision!=1 OR NEW.used_count!=0 OR NEW.revoked_at IS NOT NULL OR NEW.period_start!=0
 OR (SELECT count(*) FROM rule_approvals WHERE owner_id=NEW.owner_id)>=200
BEGIN SELECT RAISE(ABORT,'rule_approval_new'); END;
-- Binding columns never change. An update is either one use (the counter moves by exactly one inside today's UTC period, or restarts
-- at one when the period rolled over) or the revocation, which is final and stops further use.
CREATE TRIGGER rule_approval_guard BEFORE UPDATE ON rule_approvals
WHEN OLD.revoked_at IS NOT NULL OR NEW.revision IS NOT OLD.revision+1
 OR NEW.approval_id IS NOT OLD.approval_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.rule_id IS NOT OLD.rule_id OR NEW.rule_revision IS NOT OLD.rule_revision
 OR NEW.provider IS NOT OLD.provider OR NEW.operation_id IS NOT OLD.operation_id OR NEW.destination_digest IS NOT OLD.destination_digest
 OR NEW.template_digest IS NOT OLD.template_digest OR NEW.credential_id IS NOT OLD.credential_id OR NEW.max_per_period IS NOT OLD.max_per_period
 OR NEW.created_at IS NOT OLD.created_at
 OR NOT (
  (NEW.revoked_at IS NOT NULL AND NEW.used_count=OLD.used_count AND NEW.period_start=OLD.period_start)
  OR (NEW.revoked_at IS NULL AND NEW.period_start=(unixepoch()*1000)/86400000*86400000
   AND ((NEW.period_start=OLD.period_start AND NEW.used_count=OLD.used_count+1) OR (NEW.period_start>OLD.period_start AND NEW.used_count=1))))
BEGIN SELECT RAISE(ABORT,'rule_approval_guard'); END;
-- Only a revoked approval may be deleted while the account exists; the account cascade removes the rest.
CREATE TRIGGER rule_approval_retained BEFORE DELETE ON rule_approvals
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_id) AND OLD.revoked_at IS NULL
BEGIN SELECT RAISE(ABORT,'rule_approval_retained'); END;

-- WH-052 P-2 job journal (docs/job-orchestration.md). Ported from tools/prototypes/job-journal.mjs. D1 cannot read and then branch inside
-- one commit, so every check the prototype ran inside its transaction lives here: identity, outbox and the state machine are triggers,
-- and each caller transition is one UPDATE whose WHERE clause is the fence/lease compare-and-set (src/job-journal.ts). A stale caller
-- updates zero rows; a forged one is refused by job_journal_transition. Terminal states: complete, cancelled, expired.
-- The row holds the immutable envelope (contract version 1, docs/job-envelope.md) and its digest; indexed columns are derived from it
-- and checked against it on insert. Every state change writes exactly one immutable event from last_event/last_at/last_ref.
CREATE TABLE job_journal (
 id TEXT PRIMARY KEY CHECK(length(id)=36 AND id NOT GLOB '*[^0-9a-f-]*'),
 owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('platform-email','deterministic-rule','owner-push','account-cleanup','project-build')),
 envelope_json TEXT NOT NULL CHECK(json_valid(envelope_json) AND length(envelope_json)<=8192),
 envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=64 AND envelope_digest NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>0),
 max_attempts INTEGER NOT NULL CHECK(typeof(max_attempts)='integer' AND max_attempts BETWEEN 1 AND 3),
 due INTEGER NOT NULL CHECK(typeof(due)='integer' AND due>=0),
 initial_due INTEGER NOT NULL CHECK(typeof(initial_due)='integer' AND initial_due>=0),
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN ('ready','leased','awaiting','uncertain','complete','cancelled','operator','expired')),
 fence INTEGER NOT NULL DEFAULT 0 CHECK(typeof(fence)='integer' AND fence BETWEEN 0 AND 9007199254740991),
 lease_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(lease_until)='integer' AND lease_until>=0),
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempt)='integer' AND attempt BETWEEN 0 AND 3 AND attempt<=max_attempts),
 attempt_id TEXT CHECK(attempt_id IS NULL OR (length(attempt_id) BETWEEN 1 AND 128 AND attempt_id NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
 cursor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cursor)='integer' AND cursor>=0),
 result_ref TEXT CHECK(result_ref IS NULL OR (length(result_ref) BETWEEN 1 AND 128 AND result_ref NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 last_event TEXT NOT NULL CHECK(last_event IN ('enqueued','claimed','intent','uncertain','expired','external_result','confirmed_not_sent','cancel_requested','chunk_committed','operator_hold','operator_release')),
 last_at INTEGER NOT NULL CHECK(typeof(last_at)='integer' AND last_at>=0),
 last_ref TEXT CHECK(last_ref IS NULL OR (length(last_ref) BETWEEN 1 AND 128 AND last_ref NOT GLOB '*[^a-zA-Z0-9_.:-]*')),
 CHECK(state!='awaiting' OR attempt_id IS NOT NULL),
 CHECK(state!='leased' OR lease_until>0),
 CHECK(state!='complete' OR result_ref IS NOT NULL OR purpose='account-cleanup')
);
CREATE INDEX job_journal_due ON job_journal(state,due,id);
CREATE INDEX job_journal_owner ON job_journal(owner_user_id,state);

-- Immutable receipts of every journal transition, written by the triggers below.
CREATE TABLE job_journal_events (
 sequence INTEGER PRIMARY KEY,
 job_id TEXT NOT NULL REFERENCES job_journal(id) ON DELETE CASCADE,
 event TEXT NOT NULL CHECK(event IN ('enqueued','claimed','intent','uncertain','expired','external_result','confirmed_not_sent','cancel_requested','chunk_committed','operator_hold','operator_release')),
 fence INTEGER NOT NULL CHECK(typeof(fence)='integer' AND fence>=0),
 attempt INTEGER NOT NULL CHECK(typeof(attempt)='integer' AND attempt BETWEEN 0 AND 3),
 at INTEGER NOT NULL CHECK(typeof(at)='integer' AND at>=0),
 reference TEXT CHECK(reference IS NULL OR (length(reference) BETWEEN 1 AND 128 AND reference NOT GLOB '*[^a-zA-Z0-9_.:-]*'))
);
-- One receipt per transition (and the foreign-key index): a repeated claim has a new fence, a repeated intent a new attempt.
CREATE UNIQUE INDEX job_journal_events_once ON job_journal_events(job_id,event,fence,attempt);

-- One stable delivery identity per job (docs/job-envelope.md "Delivery, fences and honest recovery"). acknowledged_at is the producer's
-- transport acknowledgement only, set once; it is never domain completion.
CREATE TABLE job_outbox (
 delivery_id TEXT PRIMARY KEY CHECK(length(delivery_id)=36 AND delivery_id NOT GLOB '*[^0-9a-f-]*'),
 job_id TEXT NOT NULL UNIQUE REFERENCES job_journal(id) ON DELETE CASCADE,
 envelope_digest TEXT NOT NULL CHECK(length(envelope_digest)=64 AND envelope_digest NOT GLOB '*[^0-9a-f]*'),
 acknowledged_at INTEGER CHECK(acknowledged_at IS NULL OR (typeof(acknowledged_at)='integer' AND acknowledged_at>=0))
);
CREATE INDEX job_outbox_acknowledged ON job_outbox(acknowledged_at);

-- Admission: a ready, never-attempted job whose derived columns agree with the envelope it stores.
CREATE TRIGGER job_journal_new BEFORE INSERT ON job_journal
WHEN NEW.state!='ready' OR NEW.fence!=0 OR NEW.lease_until!=0 OR NEW.attempt!=0 OR NEW.attempt_id IS NOT NULL OR NEW.cancel_requested!=0
 OR NEW.cursor!=0 OR NEW.result_ref IS NOT NULL OR NEW.due!=NEW.initial_due OR NEW.last_event!='enqueued' OR NEW.last_at!=NEW.created_at
 OR NEW.last_ref IS NOT NULL OR NEW.created_at>NEW.due OR NEW.due>=NEW.expires_at
 OR json_extract(NEW.envelope_json,'$.jobId') IS NOT NEW.id OR json_extract(NEW.envelope_json,'$.ownerAccountId') IS NOT NEW.owner_user_id
 OR json_extract(NEW.envelope_json,'$.purpose') IS NOT NEW.purpose OR json_extract(NEW.envelope_json,'$.schedule.createdAt') IS NOT NEW.created_at
 OR json_extract(NEW.envelope_json,'$.schedule.notBefore') IS NOT NEW.due OR json_extract(NEW.envelope_json,'$.schedule.expiresAt') IS NOT NEW.expires_at
 OR json_extract(NEW.envelope_json,'$.limits.maxAttempts') IS NOT NEW.max_attempts
BEGIN SELECT RAISE(ABORT,'job_journal_new'); END;
-- The outbox entry and the first event are written by the admission itself, so neither can be missing.
CREATE TRIGGER job_journal_enqueued AFTER INSERT ON job_journal
BEGIN
 INSERT INTO job_outbox(delivery_id,job_id,envelope_digest) VALUES(
  lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
  NEW.id,NEW.envelope_digest);
 INSERT INTO job_journal_events(job_id,event,fence,attempt,at,reference) VALUES(NEW.id,NEW.last_event,NEW.fence,NEW.attempt,NEW.last_at,NEW.last_ref);
END;
CREATE TRIGGER job_journal_identity BEFORE UPDATE ON job_journal
WHEN NEW.id IS NOT OLD.id OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.purpose IS NOT OLD.purpose OR NEW.envelope_json IS NOT OLD.envelope_json
 OR NEW.envelope_digest IS NOT OLD.envelope_digest OR NEW.created_at IS NOT OLD.created_at OR NEW.initial_due IS NOT OLD.initial_due
 OR NEW.expires_at IS NOT OLD.expires_at OR NEW.max_attempts IS NOT OLD.max_attempts
BEGIN SELECT RAISE(ABORT,'job_journal_identity'); END;
-- The state machine. NEW.last_event names the transition and NEW.last_at is its time; each branch lists what must hold in OLD and
-- what must (and must not) change. The fence moves only on the events that end a holder's right to act; a lease is bounded to 60 s;
-- once an attempt is recorded (attempt_id) an expired lease can only become uncertain, never ready.
CREATE TRIGGER job_journal_transition BEFORE UPDATE ON job_journal
WHEN NOT (CASE NEW.last_event
 WHEN 'claimed' THEN OLD.state IN ('ready','leased') AND NEW.state='leased' AND OLD.cancel_requested=0 AND OLD.expires_at>NEW.last_at
  AND ((OLD.state='ready' AND OLD.due<=NEW.last_at) OR (OLD.state='leased' AND OLD.lease_until<=NEW.last_at))
  AND NEW.fence=OLD.fence+1 AND NEW.lease_until>NEW.last_at AND NEW.lease_until<=NEW.last_at+60000
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NULL
 WHEN 'intent' THEN OLD.state='leased' AND NEW.state='awaiting' AND OLD.cancel_requested=0 AND OLD.lease_until>NEW.last_at
  AND OLD.expires_at>NEW.last_at AND OLD.attempt<OLD.max_attempts AND NEW.fence=OLD.fence AND NEW.lease_until=OLD.lease_until
  AND NEW.attempt=OLD.attempt+1 AND NEW.attempt_id=OLD.id||'.'||NEW.attempt AND NEW.last_ref=NEW.attempt_id AND NEW.due=OLD.due
  AND NEW.cursor=OLD.cursor AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested
 WHEN 'uncertain' THEN OLD.state='awaiting' AND NEW.state='uncertain' AND NEW.fence=OLD.fence AND NEW.lease_until=OLD.lease_until
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NULL
 WHEN 'expired' THEN OLD.state IN ('ready','leased') AND NEW.state='expired' AND OLD.expires_at<=NEW.last_at AND NEW.fence=OLD.fence+1
  AND NEW.lease_until=0 AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NULL
 WHEN 'external_result' THEN OLD.state IN ('awaiting','uncertain','operator') AND OLD.attempt_id IS NOT NULL AND OLD.result_ref IS NULL
  AND NEW.state=CASE OLD.cancel_requested WHEN 1 THEN 'cancelled' ELSE 'complete' END AND NEW.fence=OLD.fence AND NEW.lease_until=0
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.cancel_requested=OLD.cancel_requested AND NEW.result_ref IS NOT NULL AND NEW.last_ref=NEW.result_ref
 WHEN 'confirmed_not_sent' THEN OLD.state IN ('awaiting','uncertain','operator') AND OLD.attempt_id IS NOT NULL AND OLD.result_ref IS NULL
  AND NEW.attempt_id IS NULL AND NEW.attempt=OLD.attempt AND NEW.fence=OLD.fence+1 AND NEW.lease_until=0
  AND NEW.state=CASE WHEN OLD.cancel_requested=1 THEN 'cancelled' WHEN OLD.expires_at<=NEW.last_at THEN 'expired' WHEN OLD.attempt>=OLD.max_attempts THEN 'operator' ELSE 'ready' END
  AND NEW.due=NEW.last_at+min(3600000,60000*(1<<(OLD.attempt-1))) AND NEW.cursor=OLD.cursor AND NEW.result_ref IS NULL
  AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NOT NULL
 WHEN 'cancel_requested' THEN OLD.cancel_requested=0 AND NEW.cancel_requested=1 AND OLD.state NOT IN ('complete','cancelled','expired')
  AND NEW.fence=OLD.fence+1 AND NEW.lease_until=OLD.lease_until
  AND NEW.state=CASE WHEN OLD.state IN ('awaiting','uncertain') OR (OLD.state='operator' AND OLD.attempt_id IS NOT NULL) THEN OLD.state ELSE 'cancelled' END
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.result_ref IS OLD.result_ref AND NEW.last_ref IS NULL
 WHEN 'chunk_committed' THEN OLD.state='leased' AND OLD.purpose='account-cleanup' AND OLD.cancel_requested=0 AND OLD.lease_until>NEW.last_at
  AND OLD.expires_at>NEW.last_at AND NEW.cursor>OLD.cursor AND NEW.state IN ('complete','ready') AND NEW.fence=OLD.fence+1
  AND NEW.lease_until=0 AND NEW.due=NEW.last_at AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id
  AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NULL
 WHEN 'operator_hold' THEN OLD.state IN ('ready','leased','uncertain') AND NEW.state='operator' AND NEW.fence=OLD.fence+1 AND NEW.lease_until=0
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS OLD.attempt_id AND NEW.due=OLD.due AND NEW.cursor=OLD.cursor
  AND NEW.result_ref IS OLD.result_ref AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NOT NULL
 WHEN 'operator_release' THEN OLD.state='operator' AND NEW.state='ready' AND OLD.attempt_id IS NULL AND OLD.cancel_requested=0
  AND OLD.attempt<OLD.max_attempts AND OLD.expires_at>NEW.last_at AND NEW.fence=OLD.fence+1 AND NEW.lease_until=0 AND NEW.due=NEW.last_at
  AND NEW.attempt=OLD.attempt AND NEW.attempt_id IS NULL AND NEW.cursor=OLD.cursor AND NEW.result_ref IS OLD.result_ref
  AND NEW.cancel_requested=OLD.cancel_requested AND NEW.last_ref IS NOT NULL
 ELSE 0 END)
BEGIN SELECT RAISE(ABORT,'job_journal_transition'); END;
CREATE TRIGGER job_journal_event AFTER UPDATE ON job_journal
BEGIN INSERT INTO job_journal_events(job_id,event,fence,attempt,at,reference) VALUES(NEW.id,NEW.last_event,NEW.fence,NEW.attempt,NEW.last_at,NEW.last_ref); END;
-- Only a finished job may be deleted while the account exists (30-day pruning is src/job-journal.ts); the account cascade removes the rest.
CREATE TRIGGER job_journal_retained BEFORE DELETE ON job_journal
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.owner_user_id) AND OLD.state NOT IN ('complete','cancelled','expired')
BEGIN SELECT RAISE(ABORT,'job_journal_retained'); END;

-- An event can only restate the job's own last transition, so no caller can write a receipt for something that did not happen.
CREATE TRIGGER job_journal_event_new BEFORE INSERT ON job_journal_events
WHEN NOT EXISTS(SELECT 1 FROM job_journal j WHERE j.id=NEW.job_id AND j.last_event=NEW.event AND j.last_at=NEW.at AND j.fence=NEW.fence
 AND j.attempt=NEW.attempt AND j.last_ref IS NEW.reference)
BEGIN SELECT RAISE(ABORT,'job_journal_event_new'); END;
CREATE TRIGGER job_journal_event_update BEFORE UPDATE ON job_journal_events
BEGIN SELECT RAISE(ABORT,'job_journal_event_immutable'); END;
-- Deleted only with a finished job (or by the account cascade, when neither the job nor its owner remains).
CREATE TRIGGER job_journal_event_retained BEFORE DELETE ON job_journal_events
WHEN EXISTS(SELECT 1 FROM job_journal j JOIN users u ON u.id=j.owner_user_id WHERE j.id=OLD.job_id AND j.state NOT IN ('complete','cancelled','expired'))
BEGIN SELECT RAISE(ABORT,'job_journal_event_retained'); END;

CREATE TRIGGER job_outbox_new BEFORE INSERT ON job_outbox
WHEN NEW.acknowledged_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM job_journal j WHERE j.id=NEW.job_id AND j.envelope_digest=NEW.envelope_digest)
BEGIN SELECT RAISE(ABORT,'job_outbox_new'); END;
CREATE TRIGGER job_outbox_identity BEFORE UPDATE ON job_outbox
WHEN NEW.delivery_id IS NOT OLD.delivery_id OR NEW.job_id IS NOT OLD.job_id OR NEW.envelope_digest IS NOT OLD.envelope_digest
 OR OLD.acknowledged_at IS NOT NULL OR NEW.acknowledged_at IS NULL
BEGIN SELECT RAISE(ABORT,'job_outbox_identity'); END;
CREATE TRIGGER job_outbox_retained BEFORE DELETE ON job_outbox
WHEN EXISTS(SELECT 1 FROM job_journal j JOIN users u ON u.id=j.owner_user_id WHERE j.id=OLD.job_id AND j.state NOT IN ('complete','cancelled','expired'))
BEGIN SELECT RAISE(ABORT,'job_outbox_retained'); END;

-- WH-156 shared notification outbox (docs/notifications.md; schema batch 3e). One receipt row per (template, event, recipient) for every notice kind;
-- each provider attempt is ONE `platform-email` job-journal envelope (maxAttempts 1), so the journal supplies the lease/fence and the `uncertain`
-- handling. Times are epoch milliseconds, like the journal. A template is validated against the source catalog in code (src/notification-outbox.ts),
-- not by a CHECK list here. This replaces the contact outbox, the contact send ledger and the support delivery table (current-version
-- policy: no legacy reader; the cutover resets data). Destinations, reviews and suppressions are unchanged.
CREATE TABLE notification_notices (
 id TEXT PRIMARY KEY CHECK(length(id)=36 AND id NOT GLOB '*[^0-9a-f-]*'),
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 scope TEXT NOT NULL CHECK(scope IN ('owner-destination','account-email','project-staff','submitter')),
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 destination_id TEXT REFERENCES contact_notification_destinations(id) ON DELETE CASCADE,
 recipient_ref TEXT CHECK(recipient_ref IS NULL OR length(recipient_ref) BETWEEN 1 AND 128),
 recipient_key TEXT NOT NULL,
 template TEXT NOT NULL CHECK(length(template)<=80 AND template GLOB '*@[0-9]*'),
 event_ref TEXT NOT NULL CHECK(length(event_ref) BETWEEN 1 AND 128),
 provider TEXT NOT NULL DEFAULT 'cloudflare-email' CHECK(provider='cloudflare-email'),
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatching','deferred','accepted','delivered','unknown-outcome','bounced','complained','failed','cancelled','unresolved')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6),
 job_id TEXT UNIQUE REFERENCES job_journal(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+86400000),
 dispatched_at INTEGER CHECK(dispatched_at IS NULL OR dispatched_at>=created_at),
 outcome_at INTEGER CHECK(outcome_at IS NULL OR outcome_at>0),
 provider_ref TEXT CHECK(provider_ref IS NULL OR length(provider_ref) BETWEEN 1 AND 100),
 reason TEXT CHECK(reason IS NULL OR reason IN ('rejected','unavailable','exhausted','suppressed','expired','contained','uncertain','ceiling','recipient-revoked','record-removed','template-withdrawn','unreconciled','ceiling-unset','configuration-changed')),
 lookups INTEGER NOT NULL DEFAULT 0 CHECK(lookups BETWEEN 0 AND 3),
 reconcile_until INTEGER CHECK(reconcile_until IS NULL OR reconcile_until>0),
 -- PERSONAL DATA: the exact address the last attempt was sent to (set when the attempt is claimed). A bounce, complaint or unsubscribe suppresses only this, and nothing when it is NULL.
 -- It stays with the notice (30 days after the outcome, 90 for unresolved evidence, longer under a safety hold) and is cleared at once when a visitor's address is removed or changed or the visitor is deleted (triggers in src/shared-modules/schema.sql).
 sent_to TEXT CHECK(sent_to IS NULL OR length(sent_to) BETWEEN 3 AND 254),
 UNIQUE(template,event_ref,recipient_key),
 CHECK((scope='owner-destination' AND project_id IS NOT NULL AND destination_id IS NOT NULL AND recipient_ref IS NULL)
  OR (scope='account-email' AND project_id IS NULL AND destination_id IS NULL)
  OR (scope IN ('project-staff','submitter') AND project_id IS NOT NULL AND destination_id IS NULL AND recipient_ref IS NOT NULL)),
 CHECK(recipient_key=scope||':'||coalesce(destination_id,recipient_ref,user_id)),
 CHECK((state IN ('queued','dispatching'))=(outcome_at IS NULL)),
 CHECK((state IN ('deferred','failed','cancelled','unknown-outcome','unresolved'))=(reason IS NOT NULL)),
 CHECK(provider_ref IS NULL OR state IN ('accepted','delivered','bounced','complained')),
 CHECK(state!='queued' OR (dispatched_at IS NULL AND attempts=0)),
 CHECK(state IN ('queued','cancelled') OR (dispatched_at IS NOT NULL AND attempts>0)),
 CHECK(state!='unknown-outcome' OR (reconcile_until IS NOT NULL AND outcome_at IS NOT NULL)),
 CHECK(reconcile_until IS NULL OR outcome_at IS NULL OR reconcile_until<=outcome_at+259200000)
) STRICT;
CREATE INDEX notification_notices_recipient ON notification_notices(recipient_key,created_at);
CREATE INDEX notification_notices_user ON notification_notices(user_id,template,created_at);
CREATE INDEX notification_notices_open ON notification_notices(state,reconcile_until);
CREATE INDEX notification_notices_destination ON notification_notices(destination_id);
CREATE INDEX notification_notices_project ON notification_notices(project_id);
CREATE INDEX notification_notices_expiry ON notification_notices(expires_at);

-- One ledger and ceiling per provider across ALL notice kinds (the $5/month bound). A provider call is counted by notification_notices_counted
-- when its notice enters `dispatching`; the 32 most recent UTC days may never exceed the day's ceiling (which can only be lowered).
CREATE TABLE notification_send_ledger (
 provider TEXT NOT NULL CHECK(provider='cloudflare-email'),
 day TEXT NOT NULL CHECK(length(day)=10),
 sends INTEGER NOT NULL DEFAULT 0 CHECK(sends>=0),
 ceiling INTEGER NOT NULL CHECK(ceiling BETWEEN 0 AND 100000),
 PRIMARY KEY(provider,day)
) STRICT;

CREATE TRIGGER notification_send_ledger_insert BEFORE INSERT ON notification_send_ledger BEGIN
 SELECT RAISE(ABORT,'notification_send_final') WHERE NEW.sends!=0;
END;
CREATE TRIGGER notification_send_ledger_update BEFORE UPDATE ON notification_send_ledger BEGIN
 SELECT RAISE(ABORT,'notification_send_final') WHERE NEW.provider IS NOT OLD.provider OR NEW.day IS NOT OLD.day OR NEW.ceiling>OLD.ceiling OR NEW.sends<OLD.sends;
 SELECT RAISE(ABORT,'notification_send_ceiling') WHERE NEW.sends>OLD.sends AND (SELECT coalesce(sum(sends),0) FROM notification_send_ledger WHERE provider=NEW.provider AND day>date(NEW.day,'-32 days') AND day<=NEW.day)-OLD.sends+NEW.sends>NEW.ceiling;
END;

-- Admission: queued only, owned, with the recipient the scope names. Caps of 10 an hour and 50 a day per recipient_key are a backstop behind the
-- guarded INSERT ... SELECT in src/notification-outbox.ts. job_id is linked in the same batch by the admission of the attempt's journal envelope.
CREATE TRIGGER notification_notices_new BEFORE INSERT ON notification_notices BEGIN
 SELECT RAISE(ABORT,'notification_notice_initial') WHERE NEW.state!='queued' OR NEW.attempts!=0 OR NEW.lookups!=0 OR NEW.dispatched_at IS NOT NULL OR NEW.outcome_at IS NOT NULL
  OR NEW.provider_ref IS NOT NULL OR NEW.reason IS NOT NULL OR NEW.reconcile_until IS NOT NULL OR NEW.job_id IS NOT NULL;
 SELECT RAISE(ABORT,'notification_notice_scope') WHERE
  (NEW.scope='owner-destination' AND NOT EXISTS(SELECT 1 FROM contact_notification_destinations d WHERE d.id=NEW.destination_id AND d.user_id=NEW.user_id AND d.project_id=NEW.project_id AND d.state IN ('unverified','verified')))
  OR (NEW.scope IN ('project-staff','submitter') AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_user_id=NEW.user_id));
 -- Customer-configured appointment notices (WH-158) count in their own bucket per recipient, so a form burst cannot use up the contact notice caps.
 SELECT RAISE(ABORT,'notification_notice_rate') WHERE (SELECT count(*) FROM notification_notices WHERE recipient_key=NEW.recipient_key AND (template GLOB 'appointment.*')=(NEW.template GLOB 'appointment.*') AND created_at>NEW.created_at-3600000)>=10
  OR (SELECT count(*) FROM notification_notices WHERE recipient_key=NEW.recipient_key AND (template GLOB 'appointment.*')=(NEW.template GLOB 'appointment.*') AND created_at>NEW.created_at-86400000)>=50;
END;

-- The frozen state table (docs/notifications.md). Nothing leaves unknown-outcome for queued, deferred or dispatching; it goes to an evidence state,
-- or to unresolved once three lookups are used or reconcile_until has passed. Identity never changes; only job_id (linked once, replaced when a refused
-- attempt is deferred, or cleared by the journal's ON DELETE SET NULL) and lookups move without a state change.
CREATE TRIGGER notification_notices_transition BEFORE UPDATE ON notification_notices BEGIN
 SELECT RAISE(ABORT,'notification_notice_identity') WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.scope IS NOT OLD.scope OR NEW.project_id IS NOT OLD.project_id
  OR NEW.destination_id IS NOT OLD.destination_id OR NEW.recipient_ref IS NOT OLD.recipient_ref OR NEW.recipient_key IS NOT OLD.recipient_key OR NEW.template IS NOT OLD.template
  OR NEW.event_ref IS NOT OLD.event_ref OR NEW.provider IS NOT OLD.provider OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at;
 SELECT RAISE(ABORT,'notification_notice_transition') WHERE NEW.state=OLD.state AND NOT (
  NEW.attempts=OLD.attempts AND NEW.dispatched_at IS OLD.dispatched_at AND NEW.outcome_at IS OLD.outcome_at AND NEW.provider_ref IS OLD.provider_ref AND NEW.reason IS OLD.reason
  AND NEW.reconcile_until IS OLD.reconcile_until
  AND ((OLD.state='unknown-outcome' AND NEW.job_id IS OLD.job_id AND NEW.lookups=OLD.lookups+1)
   OR (NEW.lookups=OLD.lookups AND (NEW.job_id IS OLD.job_id OR NEW.job_id IS NULL OR (OLD.job_id IS NULL AND OLD.state='queued')))));
 SELECT RAISE(ABORT,'notification_notice_transition') WHERE NEW.state!=OLD.state AND NOT (
  (OLD.state||'>'||NEW.state) IN ('queued>dispatching','queued>cancelled','deferred>dispatching','deferred>cancelled','deferred>failed','dispatching>accepted','dispatching>deferred',
   'dispatching>failed','dispatching>unknown-outcome','dispatching>cancelled','accepted>delivered','accepted>bounced','accepted>complained','delivered>complained',
   'unknown-outcome>accepted','unknown-outcome>delivered','unknown-outcome>bounced','unknown-outcome>complained','unknown-outcome>unresolved')
  AND NEW.attempts=OLD.attempts+(NEW.state='dispatching')
  AND (NEW.state='dispatching' OR NEW.dispatched_at IS OLD.dispatched_at)
  AND (NEW.job_id IS OLD.job_id OR (OLD.state='dispatching' AND NEW.state='deferred' AND NEW.job_id IS NOT NULL))
  AND (NEW.state='unknown-outcome' OR NEW.reconcile_until IS OLD.reconcile_until)
  AND (OLD.provider_ref IS NULL OR NEW.provider_ref IS OLD.provider_ref)
  AND (NEW.lookups=OLD.lookups OR (OLD.state='unknown-outcome' AND NEW.state='unresolved' AND NEW.lookups=OLD.lookups+1))
  AND (NEW.state!='unresolved' OR NEW.lookups>=3 OR NEW.outcome_at>=OLD.reconcile_until)
  AND (NEW.state!='dispatching' OR (NEW.job_id IS NOT NULL AND NEW.dispatched_at<NEW.expires_at)));
END;

-- No provider call goes uncounted: entering dispatching adds one send to the day's ledger row (which the claim creates first), and the ledger's
-- own trigger refuses the whole claim past the 32-day ceiling.
CREATE TRIGGER notification_notices_counted AFTER UPDATE OF state ON notification_notices
WHEN NEW.state='dispatching' AND OLD.state!='dispatching'
BEGIN
 SELECT RAISE(ABORT,'notification_ledger_missing') WHERE NOT EXISTS(SELECT 1 FROM notification_send_ledger WHERE provider=NEW.provider AND day=date(NEW.dispatched_at/1000,'unixepoch'));
 UPDATE notification_send_ledger SET sends=sends+1 WHERE provider=NEW.provider AND day=date(NEW.dispatched_at/1000,'unixepoch');
END;

-- An interrupted worker or a lost reply: when the journal holds a platform-email attempt as uncertain, its notice moves from dispatching to
-- unknown-outcome in the same statement, with the 72-hour reconciliation bound. It is never redispatched.
CREATE TRIGGER notification_notices_uncertain AFTER UPDATE OF state ON job_journal
WHEN NEW.state='uncertain' AND OLD.state!='uncertain' AND NEW.purpose='platform-email'
BEGIN
 UPDATE notification_notices SET state='unknown-outcome',outcome_at=NEW.last_at,reason='uncertain',reconcile_until=NEW.last_at+259200000 WHERE job_id=NEW.id AND state='dispatching';
END;

-- A notice stopped before any attempt takes its still-unclaimed envelope with it, so a cancelled notice never costs a dispatcher slot.
CREATE TRIGGER notification_notices_job_cancelled AFTER UPDATE OF state ON notification_notices
WHEN NEW.state='cancelled' AND OLD.state IN ('queued','deferred') AND NEW.job_id IS NOT NULL
BEGIN
 UPDATE job_journal SET cancel_requested=1,fence=fence+1,last_event='cancel_requested',last_at=NEW.outcome_at,last_ref=NULL,state='cancelled'
  WHERE id=NEW.job_id AND state IN ('ready','leased') AND cancel_requested=0;
END;

-- Cancel on suppression (owner-destination and account-email) using the existing per-account list; contact_suppression_apply marks the destination.
CREATE TRIGGER notification_notices_suppressed AFTER INSERT ON contact_notification_suppressions BEGIN
 UPDATE notification_notices SET state='cancelled',reason='suppressed',outcome_at=CAST(strftime('%s','now') AS INTEGER)*1000
  WHERE state IN ('queued','deferred') AND user_id=NEW.user_id AND (
   (scope='owner-destination' AND destination_id IN (SELECT id FROM contact_notification_destinations WHERE user_id=NEW.user_id AND address=NEW.address))
   OR (scope='account-email' AND recipient_ref IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND lower(email)=NEW.address)));
END;
-- A removed or replaced destination, or a removed project, stops its unsent notices; a notice with an attempt in flight blocks the delete (below).
CREATE TRIGGER notification_notices_destination_removed BEFORE DELETE ON contact_notification_destinations BEGIN
 UPDATE notification_notices SET state='cancelled',reason='recipient-revoked',outcome_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE destination_id=OLD.id AND state IN ('queued','deferred');
END;
CREATE TRIGGER notification_notices_project_removed BEFORE DELETE ON projects BEGIN
 UPDATE notification_notices SET state='cancelled',reason='record-removed',outcome_at=CAST(strftime('%s','now') AS INTEGER)*1000 WHERE project_id=OLD.id AND state IN ('queued','deferred');
END;

-- No delete while a notice is open; unresolved evidence is kept at least 90 days (interim default pending an owner decision). A deleted account
-- takes its notices with it, like the job journal. Held projects keep their notices (WH-015).
CREATE TRIGGER notification_notices_retained BEFORE DELETE ON notification_notices
WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id)
 AND (OLD.state IN ('queued','dispatching','deferred','unknown-outcome') OR (OLD.state='unresolved' AND OLD.outcome_at>CAST(strftime('%s','now') AS INTEGER)*1000-7776000000))
BEGIN SELECT RAISE(ABORT,'notification_notice_retained'); END;
CREATE TRIGGER safety_hold_notification_notices_retained BEFORE DELETE ON notification_notices
WHEN EXISTS(SELECT 1 FROM safety_held_projects WHERE project_id=OLD.project_id)
BEGIN SELECT RAISE(ABORT,'safety_preservation_hold'); END;

-- The opaque event behind a push. The notification carries only this id and its kind; the app reads the target through GET /events/{id}, which answers
-- from the owner's own rows. Content-free: ids and a kind only. An event lives seven days at most (maintenance prunes it); a deleted project leaves the event with no destination (state unavailable).
CREATE TABLE push_events (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('review_pending','operation_completed','attention_required')),
 project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
 review_id TEXT CHECK(review_id IS NULL OR (kind='review_pending' AND length(review_id)=36)),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+604800)
) STRICT;
CREATE INDEX push_events_account ON push_events(account_id,created_at);
CREATE INDEX push_events_expiry ON push_events(expires_at);
CREATE TRIGGER push_event_limit BEFORE INSERT ON push_events
WHEN (SELECT count(*) FROM push_events WHERE account_id=NEW.account_id AND created_at>NEW.created_at-3600)>=20
 OR (SELECT count(*) FROM push_events WHERE account_id=NEW.account_id AND created_at>NEW.created_at-86400)>=100
BEGIN SELECT RAISE(ABORT,'push_event_limit'); END;
CREATE TRIGGER push_event_immutable BEFORE UPDATE ON push_events
WHEN NEW.id!=OLD.id OR NEW.account_id!=OLD.account_id OR NEW.kind!=OLD.kind OR NEW.review_id IS NOT OLD.review_id OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
 OR (NEW.project_id IS NOT OLD.project_id AND NEW.project_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'push_event_immutable'); END;

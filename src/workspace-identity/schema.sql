-- Isolated WH-114/115 schema. Not an automatic migration or a second live policy.
-- Admit into the platform schema only with the coordinated current-policy cutover.
-- Atomic admission assertion. Successful checks insert nothing; denial aborts the
-- entire D1 batch before any workspace effect. This table must always be empty.
CREATE TABLE identity_admission_checks (denied INTEGER NOT NULL CHECK(denied=1)) STRICT;
CREATE TRIGGER identity_admission_denied BEFORE INSERT ON identity_admission_checks
BEGIN SELECT RAISE(ABORT,'identity_admission_denied'); END;

CREATE TABLE identity_accounts (
 account_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 policy_version INTEGER NOT NULL CHECK(policy_version=1),
 stage TEXT NOT NULL CHECK(stage IN ('enrolling','ready','recovering')),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch BETWEEN 1 AND 9007199254740991),
 credential_revision INTEGER NOT NULL DEFAULT 0 CHECK(credential_revision BETWEEN 0 AND 9007199254740991),
 current_attempt_id TEXT,
 kit_generation INTEGER NOT NULL DEFAULT 0 CHECK(kit_generation BETWEEN 0 AND 9007199254740991),
 kit_verifier TEXT CHECK(kit_verifier IS NULL OR (length(kit_verifier)=64 AND kit_verifier NOT GLOB '*[^0-9a-f]*')),
 completion_receipt_id TEXT,
 CHECK((kit_generation=0 AND kit_verifier IS NULL) OR (kit_generation>0 AND kit_verifier IS NOT NULL)),
 CHECK(stage!='ready' OR (kit_generation>0 AND completion_receipt_id IS NOT NULL AND current_attempt_id IS NULL))
) STRICT;

CREATE TABLE identity_attempts (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('enrollment','recovery')),
 status TEXT NOT NULL CHECK(status IN ('open','secured','complete','cancelled')),
 revision INTEGER NOT NULL CHECK(revision BETWEEN 0 AND 9007199254740991),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch BETWEEN 1 AND 9007199254740991),
 kit_generation INTEGER NOT NULL CHECK(kit_generation BETWEEN 0 AND 9007199254740991),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 CHECK(kind='recovery' OR status!='secured'),
 UNIQUE(id,account_id)
) STRICT;
CREATE UNIQUE INDEX identity_attempts_current ON identity_attempts(account_id) WHERE status IN ('open','secured');

CREATE TABLE identity_credentials (
 id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 1024 AND id NOT GLOB '*[^A-Za-z0-9_-]*'),
 account_id TEXT NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 public_key BLOB NOT NULL CHECK(length(public_key) BETWEEN 1 AND 4096),
 counter INTEGER NOT NULL CHECK(counter BETWEEN 0 AND 9007199254740991),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 status TEXT NOT NULL CHECK(status IN ('staged','active')),
 attempt_id TEXT,
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 last_used_at INTEGER CHECK(last_used_at IS NULL OR last_used_at>=created_at),
 CHECK(status='active' OR attempt_id IS NOT NULL),
 FOREIGN KEY(attempt_id,account_id) REFERENCES identity_attempts(id,account_id),
 UNIQUE(id,account_id)
) STRICT;
CREATE INDEX identity_credentials_account ON identity_credentials(account_id);

CREATE TABLE identity_sessions (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 policy_version INTEGER NOT NULL CHECK(policy_version=1),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch BETWEEN 1 AND 9007199254740991),
 client TEXT NOT NULL CHECK(client='web'),
 credential_id TEXT NOT NULL,
 proof_method TEXT NOT NULL CHECK(proof_method='passkey'),
 proof_at INTEGER NOT NULL CHECK(proof_at>=0),
 issued_at INTEGER NOT NULL CHECK(issued_at>=proof_at),
 expires_at INTEGER NOT NULL CHECK(expires_at>issued_at AND expires_at<=proof_at+604800),
 FOREIGN KEY(credential_id,account_id) REFERENCES identity_credentials(id,account_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX identity_sessions_account ON identity_sessions(account_id,issued_at);
CREATE INDEX identity_sessions_expiry ON identity_sessions(expires_at);

CREATE TABLE identity_grants (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 account_id TEXT NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 policy_version INTEGER NOT NULL CHECK(policy_version=1),
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch BETWEEN 1 AND 9007199254740991),
 client TEXT NOT NULL CHECK(client='web'),
 purpose TEXT NOT NULL CHECK(purpose IN ('enrollment','recovery')),
 attempt_id TEXT NOT NULL,
 proof_method TEXT NOT NULL CHECK(proof_method IN ('registration','passkey','recovery-key','recovery-commit')),
 proof_at INTEGER NOT NULL CHECK(proof_at>=0),
 proof_revision INTEGER NOT NULL CHECK(proof_revision BETWEEN 0 AND 9007199254740991),
 credential_id TEXT,
 kit_generation INTEGER,
 issued_at INTEGER NOT NULL CHECK(issued_at>=proof_at),
 expires_at INTEGER NOT NULL CHECK(expires_at>issued_at AND expires_at<=proof_at+1800),
 CHECK((proof_method IN ('recovery-key','recovery-commit') AND purpose='recovery' AND credential_id IS NULL AND kit_generation IS NOT NULL AND kit_generation>0)
    OR (proof_method IN ('registration','passkey') AND credential_id IS NOT NULL AND kit_generation IS NULL)),
 CHECK(proof_method!='registration' OR purpose='enrollment'),
 FOREIGN KEY(attempt_id,account_id) REFERENCES identity_attempts(id,account_id) ON DELETE CASCADE,
 FOREIGN KEY(credential_id,account_id) REFERENCES identity_credentials(id,account_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX identity_grants_account ON identity_grants(account_id);
CREATE INDEX identity_grants_expiry ON identity_grants(expires_at);

CREATE TABLE identity_challenges (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
 challenge TEXT NOT NULL CHECK(length(challenge) BETWEEN 32 AND 256),
 kind TEXT NOT NULL CHECK(kind IN ('signup','login','add','reauth','recovery_complete')),
 policy_version INTEGER NOT NULL CHECK(policy_version=1),
 client TEXT NOT NULL CHECK(client='web'),
 origin TEXT NOT NULL CHECK(origin IN ('https://whumpo.com','http://localhost:8787')),
 rp_id TEXT NOT NULL CHECK((origin='https://whumpo.com' AND rp_id='whumpo.com') OR (origin='http://localhost:8787' AND rp_id='localhost')),
 account_id TEXT,
 email TEXT,
 invite_hash TEXT,
 eligibility_version TEXT,
 authority_id TEXT,
 authority_kind TEXT CHECK(authority_kind IN ('session','grant')),
 auth_epoch INTEGER,
 credential_revision INTEGER,
 attempt_id TEXT,
 attempt_revision INTEGER,
 request_id TEXT NOT NULL CHECK(length(request_id)=36),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 credential_name TEXT,
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+300),
 CHECK((kind='signup' AND account_id IS NOT NULL AND email IS NOT NULL AND invite_hash IS NOT NULL AND eligibility_version IS NOT NULL AND authority_id IS NULL)
  OR (kind='login' AND account_id IS NULL AND authority_id IS NULL)
  OR (kind IN ('add','reauth','recovery_complete') AND account_id IS NOT NULL AND authority_id IS NOT NULL AND authority_kind IS NOT NULL AND auth_epoch IS NOT NULL AND credential_revision IS NOT NULL)),
 UNIQUE(account_id,request_id)
) STRICT;
CREATE INDEX identity_challenges_expiry ON identity_challenges(expires_at);
CREATE TRIGGER identity_challenge_limit BEFORE INSERT ON identity_challenges
WHEN (SELECT count(*) FROM identity_challenges)>=5000
 OR (NEW.account_id IS NOT NULL AND (SELECT count(*) FROM identity_challenges WHERE account_id=NEW.account_id)>=20)
BEGIN SELECT RAISE(ABORT,'identity_challenge_limit'); END;
CREATE TRIGGER identity_challenge_immutable BEFORE UPDATE ON identity_challenges
BEGIN SELECT RAISE(ABORT,'identity_challenge_immutable'); END;

-- An execution nonce fences a losing/replayed commit. No tokens or proof bodies are retained.
CREATE TABLE identity_ceremony_receipts (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 execution_nonce TEXT NOT NULL CHECK(length(execution_nonce)=36),
 account_id TEXT NOT NULL REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('signup','login','add','reauth')),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 credential_id TEXT NOT NULL,
 attempt_id TEXT,
 created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;
CREATE INDEX identity_ceremony_receipts_account ON identity_ceremony_receipts(account_id,created_at);
CREATE TRIGGER identity_ceremony_receipt_immutable BEFORE UPDATE ON identity_ceremony_receipts
BEGIN SELECT RAISE(ABORT,'identity_ceremony_receipt_immutable'); END;
CREATE TRIGGER identity_ceremony_receipt_limit BEFORE INSERT ON identity_ceremony_receipts
WHEN (SELECT count(*) FROM identity_ceremony_receipts)>=50000
BEGIN SELECT RAISE(ABORT,'identity_receipt_limit'); END;
CREATE TRIGGER identity_challenges_account_delete BEFORE DELETE ON users
BEGIN DELETE FROM identity_challenges WHERE account_id=OLD.id; END;

CREATE TABLE identity_kit_offers (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 account_id TEXT NOT NULL UNIQUE REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 purpose TEXT NOT NULL CHECK(purpose IN ('workspace','enrollment','recovery')),
 attempt_id TEXT,
 auth_epoch INTEGER NOT NULL CHECK(auth_epoch BETWEEN 1 AND 9007199254740991),
 credential_revision INTEGER NOT NULL CHECK(credential_revision BETWEEN 0 AND 9007199254740991),
 attempt_revision INTEGER,
 generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991),
 verifier TEXT NOT NULL CHECK(length(verifier)=64 AND verifier NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+1800),
 saved_at INTEGER CHECK(saved_at IS NULL OR (saved_at>=created_at AND saved_at<expires_at)),
 CHECK((purpose='workspace' AND attempt_id IS NULL AND attempt_revision IS NULL)
  OR (purpose!='workspace' AND attempt_id IS NOT NULL AND attempt_revision IS NOT NULL AND attempt_revision>=0)),
 FOREIGN KEY(attempt_id,account_id) REFERENCES identity_attempts(id,account_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX identity_kit_offers_expiry ON identity_kit_offers(expires_at);
CREATE TRIGGER identity_kit_offer_immutable BEFORE UPDATE ON identity_kit_offers
WHEN NEW.id!=OLD.id OR NEW.account_id!=OLD.account_id OR NEW.purpose!=OLD.purpose OR NEW.attempt_id IS NOT OLD.attempt_id
 OR NEW.auth_epoch!=OLD.auth_epoch OR NEW.credential_revision!=OLD.credential_revision OR NEW.attempt_revision IS NOT OLD.attempt_revision
 OR NEW.generation!=OLD.generation OR NEW.verifier!=OLD.verifier OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
 OR (OLD.saved_at IS NOT NULL AND NEW.saved_at IS NOT OLD.saved_at)
BEGIN SELECT RAISE(ABORT,'identity_kit_offer_immutable'); END;

-- Account deletion anonymizes terminal receipts; they cannot authenticate or recreate access.
CREATE TABLE identity_effect_receipts (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 execution_nonce TEXT NOT NULL CHECK(length(execution_nonce)=36),
 account_id TEXT REFERENCES identity_accounts(account_id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('kit_prepare','kit_save','kit_rotate','enrollment_complete','enrollment_cancel','recovery_start','recovery_review','recovery_secure','recovery_complete','passkey_remove')),
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
 offer_id TEXT,
 kit_generation INTEGER,
 attempt_id TEXT,
 created_at INTEGER NOT NULL CHECK(created_at>=0)
) STRICT;
CREATE INDEX identity_effect_receipts_account ON identity_effect_receipts(account_id,created_at);
CREATE INDEX identity_effect_receipts_expiry ON identity_effect_receipts(created_at);
CREATE TRIGGER identity_effect_receipt_immutable BEFORE UPDATE ON identity_effect_receipts
WHEN NEW.id!=OLD.id OR NEW.execution_nonce!=OLD.execution_nonce OR NEW.kind!=OLD.kind OR NEW.request_hash!=OLD.request_hash
 OR NEW.offer_id IS NOT OLD.offer_id OR NEW.kit_generation IS NOT OLD.kit_generation OR NEW.attempt_id IS NOT OLD.attempt_id
 OR NEW.created_at!=OLD.created_at OR (NEW.account_id IS NOT OLD.account_id AND NEW.account_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'identity_effect_receipt_immutable'); END;
CREATE TRIGGER identity_effect_receipt_limit BEFORE INSERT ON identity_effect_receipts
WHEN (SELECT count(*) FROM identity_effect_receipts)>=50000
BEGIN SELECT RAISE(ABORT,'identity_receipt_limit'); END;
CREATE TRIGGER identity_effect_request_unique BEFORE INSERT ON identity_effect_receipts
WHEN EXISTS(SELECT 1 FROM identity_ceremony_receipts WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'identity_request_conflict'); END;
CREATE TRIGGER identity_ceremony_request_unique BEFORE INSERT ON identity_ceremony_receipts
WHEN EXISTS(SELECT 1 FROM identity_effect_receipts WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'identity_request_conflict'); END;

CREATE TABLE identity_recovery_reviews (
 attempt_id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 review_id TEXT NOT NULL UNIQUE CHECK(length(review_id)=36),
 loss_mode TEXT NOT NULL CHECK(loss_mode IN ('all','some','none')),
 credential_revision INTEGER NOT NULL CHECK(credential_revision BETWEEN 0 AND 9007199254740991),
 lost_ids TEXT NOT NULL CHECK(json_valid(lost_ids) AND json_type(lost_ids)='array' AND json_array_length(lost_ids)<=10),
 retained_ids TEXT NOT NULL CHECK(json_valid(retained_ids) AND json_type(retained_ids)='array' AND json_array_length(retained_ids)<=10),
 reviewed_at INTEGER NOT NULL CHECK(reviewed_at>=0),
 kit_generation INTEGER,
 kit_saved_at INTEGER,
 secured_at INTEGER,
 CHECK((kit_generation IS NULL AND kit_saved_at IS NULL AND secured_at IS NULL)
  OR (kit_generation IS NOT NULL AND kit_saved_at IS NOT NULL AND secured_at IS NOT NULL
   AND kit_generation>0 AND kit_saved_at>=reviewed_at AND secured_at>=kit_saved_at)),
 FOREIGN KEY(attempt_id,account_id) REFERENCES identity_attempts(id,account_id) ON DELETE CASCADE
) STRICT;
CREATE INDEX identity_recovery_reviews_account ON identity_recovery_reviews(account_id);
CREATE TRIGGER identity_recovery_review_immutable BEFORE UPDATE ON identity_recovery_reviews
WHEN NEW.attempt_id!=OLD.attempt_id OR NEW.account_id!=OLD.account_id OR NEW.review_id!=OLD.review_id
 OR NEW.loss_mode!=OLD.loss_mode OR NEW.credential_revision!=OLD.credential_revision OR NEW.lost_ids!=OLD.lost_ids
 OR NEW.retained_ids!=OLD.retained_ids OR NEW.reviewed_at!=OLD.reviewed_at
 OR (OLD.kit_generation IS NOT NULL AND (NEW.kit_generation IS NULL OR NEW.kit_generation<=OLD.kit_generation))
BEGIN SELECT RAISE(ABORT,'identity_recovery_review_immutable'); END;

-- Completion depends on the saved current kit and the reviewed retained IDs, not client counts.
CREATE VIEW identity_recovery_ready AS
SELECT r.* FROM identity_recovery_reviews r
JOIN identity_accounts a ON a.account_id=r.account_id
JOIN identity_attempts t ON t.id=r.attempt_id AND t.account_id=a.account_id
WHERE a.policy_version=1 AND a.stage='recovering' AND a.current_attempt_id=t.id
 AND t.kind='recovery' AND t.status='secured' AND t.auth_epoch=a.auth_epoch AND t.kit_generation=a.kit_generation
 AND r.kit_generation=a.kit_generation AND r.kit_saved_at IS NOT NULL AND r.secured_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM identity_credentials c WHERE c.account_id=a.account_id AND c.status='active' AND c.id NOT IN (SELECT value FROM json_each(r.retained_ids)))
 AND (SELECT count(*) FROM identity_credentials c WHERE c.account_id=a.account_id AND c.status='active')=json_array_length(r.retained_ids)
 AND ((r.loss_mode='all' AND json_array_length(r.retained_ids)=0
   AND (SELECT count(*) FROM identity_credentials c WHERE c.account_id=a.account_id AND c.status='staged' AND c.attempt_id=t.id)>=2)
  OR (r.loss_mode IN ('some','none') AND json_array_length(r.retained_ids)>=1
   AND (SELECT count(*) FROM identity_credentials c WHERE c.account_id=a.account_id AND c.status='staged' AND c.attempt_id=t.id)>=1));

CREATE VIEW identity_current_kit_offers AS
SELECT o.* FROM identity_kit_offers o
JOIN identity_accounts a ON a.account_id=o.account_id
LEFT JOIN identity_attempts t ON t.id=o.attempt_id AND t.account_id=o.account_id
WHERE a.policy_version=1 AND a.auth_epoch=o.auth_epoch AND a.credential_revision=o.credential_revision
 AND o.generation=a.kit_generation+1 AND o.expires_at>unixepoch()
 AND ((o.purpose='workspace' AND a.stage='ready' AND a.current_attempt_id IS NULL AND o.attempt_id IS NULL)
  OR (t.auth_epoch=a.auth_epoch AND t.kit_generation=a.kit_generation AND t.revision=o.attempt_revision AND t.kind=o.purpose AND (
   (o.purpose='enrollment' AND a.stage='enrolling' AND a.current_attempt_id=t.id AND t.status='open')
   OR (o.purpose='recovery' AND (
    (a.stage IN ('ready','recovering') AND a.current_attempt_id IS NULL AND t.status='open' AND a.kit_generation>0)
    OR (a.stage='recovering' AND a.current_attempt_id=t.id AND t.status='secured' AND a.kit_generation>0))))));

-- Current keys that may prove returning access; staged keys only resume their own flow.
CREATE VIEW identity_authentication_candidates AS
SELECT c.id,c.account_id,c.public_key,c.counter,c.status,c.attempt_id AS credential_attempt_id,
 a.stage,a.auth_epoch,a.credential_revision,a.kit_generation,t.id AS attempt_id,t.revision AS attempt_revision
FROM identity_credentials c JOIN identity_accounts a ON a.account_id=c.account_id
LEFT JOIN identity_attempts t ON t.id=a.current_attempt_id AND t.account_id=a.account_id
WHERE a.policy_version=1 AND (
 (a.stage='ready' AND c.status='active' AND a.current_attempt_id IS NULL AND a.kit_generation>0 AND a.completion_receipt_id IS NOT NULL)
 OR (t.auth_epoch=a.auth_epoch AND t.kit_generation=a.kit_generation AND (
  (a.stage='enrolling' AND t.kind='enrollment' AND t.status='open' AND c.status='staged' AND c.attempt_id=t.id)
  OR (a.stage='recovering' AND t.kind='recovery' AND t.status='secured' AND a.kit_generation>0 AND
   (c.status='active' OR (c.status='staged' AND c.attempt_id=t.id))))));

CREATE TRIGGER identity_account_monotonic BEFORE UPDATE ON identity_accounts
WHEN NEW.account_id!=OLD.account_id OR NEW.policy_version!=OLD.policy_version
 OR NEW.auth_epoch<OLD.auth_epoch OR NEW.credential_revision<OLD.credential_revision OR NEW.kit_generation<OLD.kit_generation
 OR (OLD.stage!='enrolling' AND NEW.stage='enrolling')
 OR (OLD.stage='ready' AND NEW.stage='recovering' AND NEW.auth_epoch<=OLD.auth_epoch)
 OR (NEW.kit_verifier IS NOT OLD.kit_verifier AND NEW.kit_generation<=OLD.kit_generation)
 OR (OLD.kit_generation>0 AND NEW.kit_generation!=OLD.kit_generation AND NEW.auth_epoch<=OLD.auth_epoch)
BEGIN SELECT RAISE(ABORT,'identity_account_immutable_or_decreased'); END;

CREATE TRIGGER identity_attempt_monotonic BEFORE UPDATE ON identity_attempts
WHEN NEW.id!=OLD.id OR NEW.account_id!=OLD.account_id OR NEW.kind!=OLD.kind OR NEW.created_at!=OLD.created_at
 OR NEW.auth_epoch<OLD.auth_epoch OR NEW.kit_generation<OLD.kit_generation OR NEW.revision<OLD.revision
 OR (OLD.status IN ('complete','cancelled') AND NEW.status!=OLD.status)
 OR (OLD.status='secured' AND NEW.status='open')
 OR ((NEW.status!=OLD.status OR NEW.auth_epoch!=OLD.auth_epoch OR NEW.kit_generation!=OLD.kit_generation) AND NEW.revision<=OLD.revision)
BEGIN SELECT RAISE(ABORT,'identity_attempt_immutable_or_stale_revision'); END;

CREATE TRIGGER identity_credential_limit BEFORE INSERT ON identity_credentials
WHEN (SELECT count(*) FROM identity_credentials WHERE account_id=NEW.account_id)>=10
BEGIN SELECT RAISE(ABORT,'identity_credential_limit'); END;
CREATE TRIGGER identity_credential_immutable BEFORE UPDATE ON identity_credentials
WHEN NEW.id!=OLD.id OR NEW.account_id!=OLD.account_id OR NEW.public_key!=OLD.public_key
 OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.created_at!=OLD.created_at OR NEW.counter<OLD.counter
 OR (OLD.status='active' AND NEW.status!='active')
BEGIN SELECT RAISE(ABORT,'identity_credential_immutable'); END;
CREATE TRIGGER identity_credential_insert_revision AFTER INSERT ON identity_credentials
BEGIN
 UPDATE identity_accounts SET credential_revision=credential_revision+1 WHERE account_id=NEW.account_id;
 UPDATE identity_attempts SET revision=revision+1 WHERE account_id=NEW.account_id AND status IN ('open','secured');
END;
CREATE TRIGGER identity_credential_delete_revision AFTER DELETE ON identity_credentials
BEGIN
 UPDATE identity_accounts SET credential_revision=credential_revision+1 WHERE account_id=OLD.account_id;
 UPDATE identity_attempts SET revision=revision+1 WHERE account_id=OLD.account_id AND status IN ('open','secured');
END;
CREATE TRIGGER identity_credential_activate_revision AFTER UPDATE OF status ON identity_credentials
WHEN NEW.status!=OLD.status
BEGIN
 UPDATE identity_accounts SET credential_revision=credential_revision+1 WHERE account_id=NEW.account_id;
 UPDATE identity_attempts SET revision=revision+1 WHERE account_id=NEW.account_id AND status IN ('open','secured');
END;

CREATE TRIGGER identity_session_immutable BEFORE UPDATE ON identity_sessions
WHEN NEW.id!=OLD.id OR NEW.token_hash!=OLD.token_hash OR NEW.account_id!=OLD.account_id
 OR NEW.policy_version!=OLD.policy_version OR NEW.client!=OLD.client OR NEW.credential_id!=OLD.credential_id
 OR NEW.proof_method!=OLD.proof_method OR NEW.proof_at!=OLD.proof_at OR NEW.issued_at!=OLD.issued_at
 OR NEW.expires_at!=OLD.expires_at OR NEW.auth_epoch<OLD.auth_epoch
BEGIN SELECT RAISE(ABORT,'identity_session_immutable'); END;
CREATE TRIGGER identity_session_limit AFTER INSERT ON identity_sessions
BEGIN
 DELETE FROM identity_sessions WHERE account_id=NEW.account_id AND id!=NEW.id AND id NOT IN
 (SELECT id FROM identity_sessions WHERE account_id=NEW.account_id AND id!=NEW.id ORDER BY issued_at DESC,id DESC LIMIT 9);
END;
CREATE TRIGGER identity_grant_immutable BEFORE UPDATE ON identity_grants
BEGIN SELECT RAISE(ABORT,'identity_grant_immutable'); END;
CREATE TRIGGER identity_grant_limit BEFORE INSERT ON identity_grants
WHEN (SELECT count(*) FROM identity_grants WHERE account_id=NEW.account_id)>=20
 OR (SELECT count(*) FROM identity_grants)>=20000
BEGIN SELECT RAISE(ABORT,'identity_grant_limit'); END;

-- One current resolver source. No reference to prior sessions, passwords or recovery codes.
-- Prepared kit/review/completion receipts are separate effects, not authority in this view.
CREATE VIEW identity_current_authorities AS
SELECT s.id AS authority_id,'session' AS kind,s.token_hash,s.account_id,'workspace' AS purpose,
 s.policy_version,s.auth_epoch,s.client,a.stage,a.credential_revision,
 NULL AS attempt_id,NULL AS attempt_revision,s.proof_method,s.proof_at,NULL AS proof_revision,s.credential_id,s.expires_at
FROM identity_sessions s
JOIN identity_accounts a ON a.account_id=s.account_id
JOIN identity_credentials c ON c.id=s.credential_id AND c.account_id=s.account_id
WHERE a.policy_version=1 AND s.policy_version=1 AND s.client='web' AND s.auth_epoch=a.auth_epoch
 AND a.stage='ready' AND a.current_attempt_id IS NULL AND a.kit_generation>0 AND a.completion_receipt_id IS NOT NULL
 AND c.status='active' AND s.proof_method='passkey'
 AND s.proof_at<=unixepoch() AND s.issued_at<=unixepoch() AND s.expires_at>unixepoch()
UNION ALL
SELECT g.id,'grant',g.token_hash,g.account_id,g.purpose,g.policy_version,g.auth_epoch,g.client,a.stage,a.credential_revision,
 t.id,t.revision,g.proof_method,g.proof_at,g.proof_revision,g.credential_id,g.expires_at
FROM identity_grants g
JOIN identity_accounts a ON a.account_id=g.account_id
JOIN identity_attempts t ON t.id=g.attempt_id AND t.account_id=g.account_id
LEFT JOIN identity_credentials c ON c.id=g.credential_id AND c.account_id=g.account_id
WHERE a.policy_version=1 AND g.policy_version=1 AND g.client='web' AND g.auth_epoch=a.auth_epoch
 AND t.auth_epoch=a.auth_epoch AND t.kit_generation=a.kit_generation AND t.kind=g.purpose
 AND g.proof_at<=unixepoch() AND g.issued_at<=unixepoch() AND g.expires_at>unixepoch()
 AND ((g.purpose='enrollment' AND a.stage='enrolling' AND a.current_attempt_id=t.id AND t.status='open')
   OR (g.purpose='recovery' AND (
     (a.stage IN ('ready','recovering') AND a.current_attempt_id IS NULL AND t.status='open' AND a.kit_generation>0)
     OR (a.stage='recovering' AND a.current_attempt_id=t.id AND t.status='secured' AND a.kit_generation>0))))
 AND ((g.proof_method IN ('recovery-key','recovery-commit') AND g.kit_generation=a.kit_generation AND g.credential_id IS NULL)
   OR (g.proof_method IN ('registration','passkey') AND c.id IS NOT NULL
     AND ((c.status='staged' AND c.attempt_id=t.id) OR (c.status='active' AND g.proof_method='passkey' AND g.purpose='recovery'))));

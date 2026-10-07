-- Current native browser handoff. No bearer, verifier, code or browser token is stored.
CREATE TABLE mobile_identity_handoffs (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 browser_hash TEXT NOT NULL UNIQUE CHECK(length(browser_hash)=64),
 purpose TEXT NOT NULL CHECK(purpose IN ('signin','signup','recovery')),
 state_hash TEXT NOT NULL CHECK(length(state_hash)=64),
 code_challenge TEXT NOT NULL CHECK(length(code_challenge)=43),
 redirect_uri TEXT NOT NULL CHECK(redirect_uri='https://whumpo.com/app/return'),
 signing_origin TEXT NOT NULL CHECK(length(signing_origin)=64),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at AND expires_at<=created_at+300),
 account_id TEXT REFERENCES identity_accounts(account_id) ON DELETE CASCADE,
 source_session_id TEXT REFERENCES identity_sessions(id) ON DELETE CASCADE,
 auth_epoch INTEGER,
 code_hash TEXT UNIQUE CHECK(code_hash IS NULL OR length(code_hash)=64),
 code_expires_at INTEGER,
 consumed_at INTEGER,
 exchange_nonce TEXT,
 CHECK((account_id IS NULL AND source_session_id IS NULL AND auth_epoch IS NULL) OR (account_id IS NOT NULL AND source_session_id IS NOT NULL AND auth_epoch IS NOT NULL)),
 CHECK((code_hash IS NULL AND code_expires_at IS NULL) OR (source_session_id IS NOT NULL AND code_hash IS NOT NULL AND code_expires_at<=expires_at)),
 CHECK((consumed_at IS NULL AND exchange_nonce IS NULL) OR (code_hash IS NOT NULL AND consumed_at IS NOT NULL AND exchange_nonce IS NOT NULL))
) STRICT;
CREATE INDEX mobile_identity_handoffs_expiry ON mobile_identity_handoffs(expires_at);
CREATE INDEX mobile_identity_handoffs_account ON mobile_identity_handoffs(account_id);
CREATE TRIGGER mobile_identity_handoff_limit BEFORE INSERT ON mobile_identity_handoffs
WHEN (SELECT count(*) FROM mobile_identity_handoffs)>=5000
BEGIN SELECT RAISE(ABORT,'mobile_handoff_limit'); END;
CREATE TRIGGER mobile_identity_handoff_immutable BEFORE UPDATE ON mobile_identity_handoffs
WHEN NEW.id!=OLD.id OR NEW.browser_hash!=OLD.browser_hash OR NEW.purpose!=OLD.purpose
 OR NEW.state_hash!=OLD.state_hash OR NEW.code_challenge!=OLD.code_challenge OR NEW.redirect_uri!=OLD.redirect_uri
 OR NEW.signing_origin!=OLD.signing_origin OR NEW.created_at!=OLD.created_at OR NEW.expires_at!=OLD.expires_at
 OR (OLD.source_session_id IS NOT NULL AND (NEW.source_session_id IS NOT OLD.source_session_id OR NEW.account_id IS NOT OLD.account_id OR NEW.auth_epoch IS NOT OLD.auth_epoch))
 OR (OLD.code_hash IS NOT NULL AND (NEW.code_hash IS NOT OLD.code_hash OR NEW.code_expires_at IS NOT OLD.code_expires_at))
 OR OLD.consumed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'mobile_handoff_immutable'); END;

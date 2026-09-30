-- Internal adjudicated evidence, not detector output or a legal preservation archive.
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
CREATE INDEX content_risk_evidence_owner ON content_risk_evidence(user_id,incident_id);
CREATE TRIGGER content_risk_evidence_admit BEFORE INSERT ON content_risk_evidence BEGIN
 SELECT RAISE(ABORT,'risk_event_future') WHERE NEW.occurred_at>unixepoch('now')*1000+999;
 SELECT RAISE(ABORT,'risk_event_capacity') WHERE (SELECT count(*) FROM content_risk_evidence WHERE user_id=NEW.user_id)>=10000 OR (SELECT count(*) FROM content_risk_evidence)>=100000;
END;
CREATE TRIGGER content_risk_evidence_immutable BEFORE UPDATE ON content_risk_evidence BEGIN SELECT RAISE(ABORT,'risk_event_immutable'); END;
CREATE TRIGGER content_risk_evidence_retained BEFORE DELETE ON content_risk_evidence WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'risk_event_retained'); END;
CREATE TABLE content_risk_reversals (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 incident_id TEXT NOT NULL,
 evidence_ref TEXT NOT NULL CHECK(length(evidence_ref) BETWEEN 1 AND 128),
 reviewer_ref TEXT NOT NULL CHECK(length(reviewer_ref) BETWEEN 1 AND 128),
 recorded_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,incident_id)
);
CREATE TRIGGER content_risk_reversal_admit BEFORE INSERT ON content_risk_reversals WHEN NOT EXISTS(SELECT 1 FROM content_risk_evidence WHERE user_id=NEW.user_id AND incident_id=NEW.incident_id) BEGIN SELECT RAISE(ABORT,'risk_incident_missing'); END;
CREATE TRIGGER content_risk_reversal_immutable BEFORE UPDATE ON content_risk_reversals BEGIN SELECT RAISE(ABORT,'risk_reversal_immutable'); END;
CREATE TRIGGER content_risk_reversal_retained BEFORE DELETE ON content_risk_reversals WHEN EXISTS(SELECT 1 FROM users WHERE id=OLD.user_id) BEGIN SELECT RAISE(ABORT,'risk_reversal_retained'); END;

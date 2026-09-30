-- Internal screening requirements, never approval receipts.
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

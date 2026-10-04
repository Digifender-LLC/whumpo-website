-- WH-025 consent-aware, content-free funnel measurements (current schema input).
-- Opt-in only: rows are derived solely for accounts whose profile records
-- measurement_consent=1, and only from receipts dated at or after that consent.
-- Withdrawal deletes that account's rows; account deletion cascades. Rows carry one
-- allowlisted event, one enumerated dimension, a same-account deduplication key
-- naming the existing receipt it was derived from, and a UTC minute.
-- Deliberately no recorder triggers: D1 meta.changes counts trigger writes, and
-- current handlers assert exact changes on their receipt statements.
-- Never store briefs, source, Chat text, answers, labels, emails, credential IDs,
-- recovery data, file contents, provider values or another account's identifiers.
CREATE TABLE funnel_events (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event TEXT NOT NULL,
 dimension TEXT NOT NULL,
 source_key TEXT NOT NULL CHECK(length(source_key) BETWEEN 1 AND 160 AND source_key NOT GLOB '*[^A-Za-z0-9_.:-]*'),
 occurred_at TEXT NOT NULL CHECK(length(occurred_at)=17 AND strftime('%Y-%m-%dT%H:%MZ',occurred_at) IS occurred_at),
 CHECK(CASE event
  WHEN 'welcome_completed' THEN dimension='welcome'
  WHEN 'draft_created' THEN dimension IN ('website','application')
  WHEN 'edit_accepted' THEN dimension IN ('website_content','website_services')
  WHEN 'review_prepared' THEN dimension IN ('website_publish','website_restore','application','app_page','app_restore','backend_publication','backend_form')
  WHEN 'publication_confirmed' THEN dimension IN ('website_publish','website_restore')
  WHEN 'workspace_returned' THEN dimension IN ('day_7','day_30')
  WHEN 'interaction_started' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_draft_saved' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_resumed' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_submitted' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_canceled' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_expired' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_validation_failed' THEN dimension IN ('content_change','project_brief','project_select','choice','custom','status_view','other')
  WHEN 'interaction_continued' THEN dimension IN ('succeeded','failed_stopped','failed_changed','failed_unavailable')
  WHEN 'passkey_registered' THEN dimension IN ('signup_first','enrollment_additional','recovery_replacement','workspace_added')
  WHEN 'recovery_kit_saved' THEN dimension IN ('enrollment','recovery','workspace')
  WHEN 'enrollment_completed' THEN dimension='enrollment'
  WHEN 'enrollment_cancelled' THEN dimension='enrollment'
  WHEN 'recovery_started' THEN dimension='recovery'
  WHEN 'recovery_secured' THEN dimension='recovery'
  WHEN 'recovery_completed' THEN dimension='recovery'
  ELSE 0 END),
 PRIMARY KEY(user_id,event,source_key)
) STRICT;
CREATE INDEX funnel_events_retention ON funnel_events(occurred_at);
CREATE INDEX funnel_events_event ON funnel_events(event,dimension,occurred_at);
CREATE TRIGGER funnel_events_immutable BEFORE UPDATE ON funnel_events
BEGIN SELECT RAISE(ABORT,'funnel_event_immutable'); END;

-- One consent and per-account quota predicate for every recorder. The users
-- table quota (50 accounts) bounds the total to about 100,000 rows.
CREATE VIEW funnel_measured_accounts AS
SELECT p.user_id,p.measurement_consented_at AS consented_at FROM user_profiles p
WHERE p.measurement_consent=1 AND (SELECT count(*) FROM funnel_events e WHERE e.user_id=p.user_id)<2000;

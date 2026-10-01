-- Reviews contain authority metadata only; visitor data is read for the exact revision.
-- Revoking the session or erasing the visitor also invalidates the review.
CREATE TABLE app_deletion_reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES app_spaces(project_id),
 visitor_id TEXT NOT NULL REFERENCES app_visitors(id) ON DELETE CASCADE,
 session_hash TEXT NOT NULL UNIQUE REFERENCES app_sessions(token_hash) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>=0),
 expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'))
);
CREATE INDEX app_deletion_review_expiry ON app_deletion_reviews(expires_at);
CREATE TRIGGER app_deletion_review_immutable BEFORE UPDATE ON app_deletion_reviews
 BEGIN SELECT RAISE(ABORT,'app_deletion_review_immutable'); END;
-- One review per extant session, itself limited to five per visitor / 5,000 total.
CREATE TRIGGER app_deletion_review_capacity BEFORE INSERT ON app_deletion_reviews
 WHEN (SELECT count(*) FROM app_deletion_reviews)>=5000
 BEGIN SELECT RAISE(ABORT,'app_deletion_review_capacity'); END;

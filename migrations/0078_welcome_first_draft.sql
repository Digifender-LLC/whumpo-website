-- Another build can finish while the first-draft model call is in flight.
-- Reject that stale result in the same transaction as draft/receipt persistence.
CREATE TABLE welcome_first_drafts (
 turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TRIGGER welcome_first_draft_claim BEFORE INSERT ON welcome_first_drafts
 WHEN NOT EXISTS(SELECT 1 FROM chat_turns t JOIN welcome_onboarding w ON w.user_id=t.user_id
  JOIN projects p ON p.id=w.project_id AND p.owner_user_id=w.user_id
  WHERE t.id=NEW.turn_id AND t.user_id=NEW.user_id AND t.mode='ai' AND t.status='pending'
   AND t.user_text='/first-draft '||NEW.project_id AND p.id=NEW.project_id AND w.completed_at IS NOT NULL)
 OR EXISTS(SELECT 1 FROM site_versions WHERE project_id=NEW.project_id)
 OR EXISTS(SELECT 1 FROM welcome_first_drafts WHERE project_id=NEW.project_id)
 BEGIN SELECT RAISE(ABORT,'welcome_first_draft_changed'); END;
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

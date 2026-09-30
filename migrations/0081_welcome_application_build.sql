-- Website and application starts share one immutable welcome claim.
DROP TRIGGER welcome_first_draft_claim;
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

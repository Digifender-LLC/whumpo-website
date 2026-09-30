ALTER TABLE user_profiles ADD COLUMN avatar_id TEXT NOT NULL DEFAULT 'cloud' CHECK(avatar_id IN ('cloud','sun','moon','leaf','star','planet'));
CREATE TABLE welcome_onboarding (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0,
 stage TEXT NOT NULL DEFAULT 'profile' CHECK(stage IN ('profile','project','review','complete')),
 project_id TEXT NOT NULL UNIQUE,
 project_name TEXT NOT NULL DEFAULT '' CHECK(length(project_name)<=100),
 idea TEXT NOT NULL DEFAULT '' CHECK(length(idea)<=1000),
 audience TEXT NOT NULL DEFAULT '' CHECK(length(audience)<=1000),
 preferred_theme TEXT NOT NULL DEFAULT 'ocean' CHECK(preferred_theme IN ('ocean','clay','forest')),
 completed_at TEXT
);
CREATE TRIGGER welcome_revision BEFORE UPDATE ON welcome_onboarding
 WHEN NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.revision<>OLD.revision+1 OR OLD.completed_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'welcome_revision'); END;
CREATE TRIGGER welcome_complete_guard BEFORE UPDATE ON welcome_onboarding
 WHEN (NEW.stage='complete')<>(NEW.completed_at IS NOT NULL) OR
 (NEW.completed_at IS NOT NULL AND (OLD.stage<>'review' OR length(trim(NEW.project_name))=0 OR length(trim(NEW.idea))=0 OR NOT EXISTS(SELECT 1 FROM user_profiles WHERE user_id=NEW.user_id AND length(trim(name))>0)))
 BEGIN SELECT RAISE(ABORT,'welcome_incomplete'); END;
CREATE TRIGGER welcome_create_project AFTER UPDATE ON welcome_onboarding WHEN NEW.completed_at IS NOT NULL
 BEGIN
 INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at,audience,preferred_theme)
 VALUES(NEW.project_id,NEW.user_id,NEW.project_name,NEW.idea,'draft',NEW.completed_at,NEW.completed_at,NEW.audience,NEW.preferred_theme);
 INSERT INTO workspace_state(user_id,revision,step,idea) VALUES(NEW.user_id,1,'ready','')
 ON CONFLICT(user_id) DO UPDATE SET revision=revision+1,step='ready',idea='',brief_project_id=NULL,brief_stage=NULL;
 INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status)
 SELECT NEW.project_id,NEW.user_id,revision,'Start my first project.',
 'Your project “'||NEW.project_name||'” is ready to work on. I saved your idea and preferences privately. Tell me what you would like to build first, or use /build for a private starter preview. Nothing is published, and no services have been purchased.',NEW.completed_at,'guided','completed'
 FROM workspace_state WHERE user_id=NEW.user_id;
 INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at)
 VALUES('welcome:'||NEW.project_id,NEW.user_id,NEW.project_id,'project.created','Started first project during welcome',NEW.completed_at);
 END;

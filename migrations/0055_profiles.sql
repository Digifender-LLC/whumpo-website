CREATE TABLE user_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 name TEXT NOT NULL DEFAULT '' CHECK(length(name)<=80),
 about_me TEXT NOT NULL DEFAULT '' CHECK(length(about_me)<=1200),
 share_context INTEGER NOT NULL DEFAULT 0 CHECK(share_context IN(0,1)),
 theme TEXT NOT NULL DEFAULT 'system' CHECK(theme IN('system','light','dark')),
 photo TEXT CHECK(photo IS NULL OR length(photo)<=45000)
);
CREATE TRIGGER user_profiles_revision BEFORE UPDATE ON user_profiles
WHEN NEW.user_id!=OLD.user_id OR NEW.revision!=OLD.revision+1
BEGIN SELECT RAISE(ABORT,'profile_revision'); END;

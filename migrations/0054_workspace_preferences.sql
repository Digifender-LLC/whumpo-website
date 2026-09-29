-- Layout is declarative; no scripts, URLs, data queries or spending authority.
CREATE TABLE workspace_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 layout_json TEXT NOT NULL CHECK(json_valid(layout_json) AND length(CAST(layout_json AS BLOB)) <= 12000),
 updated_at TEXT NOT NULL
);
CREATE TRIGGER workspace_preferences_revision BEFORE UPDATE ON workspace_preferences
WHEN NEW.user_id != OLD.user_id OR NEW.revision != OLD.revision+1
BEGIN SELECT RAISE(ABORT,'workspace_revision'); END;
CREATE TABLE capacity_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
 preferred_plan TEXT NOT NULL DEFAULT 'starter' CHECK(preferred_plan IN ('starter','personal','business','business-pro')),
 billing_interval TEXT NOT NULL DEFAULT 'month' CHECK(billing_interval IN ('month','year')),
 draft_overage_cents INTEGER NOT NULL DEFAULT 0 CHECK(draft_overage_cents BETWEEN 0 AND 100000),
 updated_at TEXT NOT NULL
);
CREATE TRIGGER capacity_preferences_revision BEFORE UPDATE ON capacity_preferences
WHEN NEW.user_id != OLD.user_id OR NEW.revision != OLD.revision+1
BEGIN SELECT RAISE(ABORT,'capacity_revision'); END;

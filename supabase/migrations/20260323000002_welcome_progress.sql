-- Welcome banner progress tracking
-- Stores per-card completion state for the post-signup welcome banner on Intelligence page.
-- NULL = new user (show banner), completed_at set = fully dismissed (never show again).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS welcome_progress JSONB DEFAULT NULL;

-- Example value:
-- {
--   "automations": "visited",   -- or "skipped" or null
--   "app": "skipped",
--   "ai": null,
--   "completed_at": null        -- set when all 3 are done
-- }

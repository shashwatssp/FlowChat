-- ============================================================
-- FlowChat: Bots Calendar Fields Migration
-- ============================================================
-- Your project: lwqfwtficdosccpledqw
-- Run this in the Supabase SQL Editor (project-wide, public schema)
-- ============================================================

-- 1. Add calendar_enabled — defaults to false so existing bots
--    keep their current behavior until a user opts in.
ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS calendar_enabled boolean NOT NULL DEFAULT false;

-- 2. Add timezone — stores the IANA timezone string for the bot
--    so calendar events are scheduled in the correct time zone.
--    Defaults to 'UTC' for existing rows.
ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- 3. Index on calendar_enabled for efficient filtering of
--    bots that have appointment scheduling enabled.
CREATE INDEX IF NOT EXISTS idx_bots_calendar_enabled ON bots(calendar_enabled);

-- ============================================================
-- After running this migration, the bots table will have:
--   calendar_enabled  boolean  NOT NULL  DEFAULT false
--   timezone          text     NOT NULL  DEFAULT 'UTC'
-- ============================================================
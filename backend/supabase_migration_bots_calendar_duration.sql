-- ============================================================
-- FlowChat: Bots appointment_duration_minutes column
-- ============================================================
-- Project: lwqfwtficdosccpledqw
-- Run via the Supabase Management API "run SQL" endpoint
-- (POST /v1/projects/<ref>/database/query) with a PAT.
-- The service_role key cannot run DDL, so this must be applied
-- with a personal access token (see apply_migrations.ps1).
--
-- This is idempotent: ADD COLUMN IF NOT EXISTS is a no-op once
-- the column exists, so re-running is safe.
-- ============================================================

-- Default appointment slot duration (minutes) that the bot owner can
-- configure in Calendar Settings. Existing bots default to 30 minutes
-- (the historic, code-level default) so behaviour is unchanged until
-- an owner opts to change it.
ALTER TABLE bots
    ADD COLUMN IF NOT EXISTS appointment_duration_minutes integer
    NOT NULL DEFAULT 30;

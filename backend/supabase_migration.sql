-- ============================================================
-- FlowChat: Local Auth Migration
-- ============================================================
-- Your project: lwqfwtficdosccpledqw
-- Run this in the Supabase SQL Editor (project-wide, public schema)
-- ============================================================

-- 1. Drop the FK constraint from users.id → auth.users
--    Local users are created directly in the 'users' table now;
--    they do NOT need a matching row in auth.users.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- 2. Ensure users.id gets a locally-generated UUID when we insert
--    (so Register doesn't need to supply one)
ALTER TABLE users ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- 3. Add the password_hash column for bcrypt password storage
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

-- 4. (Optional but recommended) Drop the trigger that auto-creates
--    profile rows from auth.users — we create them directly now.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 5. Also make sure the RLS policies won't block service-role inserts.
--    The service_role key bypasses RLS, but for completeness ensure an
--    insert policy exists for the 'users' table (in case RLS is on).
--    If no insert policy exists, service role still works, so this
--    is only for explicit safety.
DROP POLICY IF EXISTS "Service role can insert users" ON users;
CREATE POLICY "Service role can insert users" ON users
    FOR INSERT WITH CHECK (true);

-- ============================================================
-- After running this migration, your users table will have:
--   id            uuid (default uuid_generate_v4()) — FK to auth.users REMOVED
--   email         text unique not null
--   full_name     text
--   avatar_url    text
--   password_hash text ← bcrypt hashed passwords
--   created_at    timestamp default now()
--   updated_at    timestamp default now()
-- ============================================================

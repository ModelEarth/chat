-- =====================================================
-- Database Functions (Neon)
-- File: neon/0002_functions.sql
-- Description: Runs after 0002_functions.sql on Neon. Users live in
--   BetterAuth's "user" table (CloudRoot auth/db/0001), not Supabase's
--   auth.users, so the two user functions are redefined against it, and the
--   functions built on Supabase's auth.uid() and JWT claims are dropped.
--   The user functions are used only when "user" is in the same database
--   (see neon/0004_triggers.sql).
-- =====================================================

-- Validate that user_id exists in BetterAuth's "user" table.
-- "user".id is text, while chat's user_id columns are uuid, so a real
-- foreign key isn't possible; this trigger function stands in for one.
CREATE OR REPLACE FUNCTION public.validate_user_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."user" WHERE id = NEW.user_id::text) THEN
    RAISE EXCEPTION 'user_id % does not exist in "user"', NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Delete a user's chat data when their "user" row is deleted (fired by
-- on_user_deleted in neon/0004_triggers.sql). Ids that aren't UUIDs can't
-- own chat rows, so they're skipped.
CREATE OR REPLACE FUNCTION public.handle_auth_user_deletion()
RETURNS TRIGGER AS $$
DECLARE
  uid UUID;
BEGIN
  IF OLD.id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN OLD;
  END IF;
  uid := OLD.id::uuid;

  -- Chats cascade to messages, votes and streams through their FKs.
  DELETE FROM public."Chat" WHERE user_id = uid;
  -- Documents cascade to suggestions.
  DELETE FROM public."Document" WHERE user_id = uid;
  DELETE FROM public."Suggestion" WHERE user_id = uid;
  DELETE FROM public.usage_logs WHERE user_id = uid;
  DELETE FROM public.rate_limit_tracking WHERE user_id = uid;
  DELETE FROM public.github_repositories WHERE user_id = uid;

  -- Logs and config persist; only the reference is cleared.
  UPDATE public.error_logs SET resolved_by = NULL WHERE resolved_by = uid;
  UPDATE public.admin_config SET updated_by = NULL WHERE updated_by = uid;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Supabase-only: these read auth.uid(), auth.users or Supabase's JWT
-- claims, and relied on RLS to filter rows. chat doesn't call them; it
-- checks access in lib/auth/server.ts.
DROP FUNCTION IF EXISTS public.get_user_role();
DROP FUNCTION IF EXISTS public.is_current_user_admin();
DROP FUNCTION IF EXISTS public.get_current_user_usage_summary(DATE, DATE);

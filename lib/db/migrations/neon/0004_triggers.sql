-- =====================================================
-- Database Triggers (Neon)
-- File: neon/0004_triggers.sql
-- Description: Neon version of 0004_triggers.sql. The user triggers use
--   BetterAuth's "user" table instead of Supabase's auth.users, and only when
--   it's in the same database; the rest matches 0004_triggers.sql.
-- =====================================================

-- User triggers, only when BetterAuth's "user" table is in this database.
-- With the user database separate (CloudRoot's "cloudroot" Neon project;
-- chat's data in its own "chat" project), Postgres can't check or cascade
-- across databases, so these are skipped and chat accepts any user_id.
DO $$
DECLARE
  tables TEXT[] := ARRAY['Chat', 'Document', 'Suggestion', 'usage_logs', 'rate_limit_tracking', 'github_repositories'];
  names TEXT[] := ARRAY['validate_chat_user_id', 'validate_document_user_id', 'validate_suggestion_user_id',
                        'validate_usage_logs_user_id', 'validate_rate_limit_user_id', 'validate_github_repos_user_id'];
BEGIN
  FOR i IN 1 .. array_length(tables, 1) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', names[i], tables[i]);
  END LOOP;

  IF to_regclass('public."user"') IS NULL THEN
    RAISE NOTICE 'No "user" table in this database: skipping user_id triggers';
    RETURN;
  END IF;

  -- Clean up a user's chat data when their "user" row is deleted
  DROP TRIGGER IF EXISTS on_user_deleted ON public."user";
  CREATE TRIGGER on_user_deleted
    BEFORE DELETE ON public."user"
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auth_user_deletion();

  -- Ensure user_id exists before INSERT/UPDATE
  FOR i IN 1 .. array_length(tables, 1) LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION public.validate_user_id()',
      names[i], tables[i]);
  END LOOP;
END $$;

-- Keep admin_config.updated_at current
DROP TRIGGER IF EXISTS trigger_admin_config_updated_at ON admin_config;
CREATE TRIGGER trigger_admin_config_updated_at
    BEFORE UPDATE ON admin_config
    FOR EACH ROW
    EXECUTE FUNCTION update_admin_config_timestamp();

-- Validate admin config JSON structure
DROP TRIGGER IF EXISTS trigger_validate_admin_config ON admin_config;
CREATE TRIGGER trigger_validate_admin_config
    BEFORE INSERT OR UPDATE ON admin_config
    FOR EACH ROW
    EXECUTE FUNCTION validate_admin_config_data();

-- Keep model_config.updated_at current
DROP TRIGGER IF EXISTS trigger_model_config_updated_at ON model_config;
CREATE TRIGGER trigger_model_config_updated_at
    BEFORE UPDATE ON model_config
    FOR EACH ROW
    EXECUTE FUNCTION update_model_config_timestamp();

-- Only one default model per provider
DROP TRIGGER IF EXISTS trigger_ensure_single_default_model ON model_config;
CREATE TRIGGER trigger_ensure_single_default_model
    BEFORE INSERT OR UPDATE ON model_config
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_default_model_per_provider();

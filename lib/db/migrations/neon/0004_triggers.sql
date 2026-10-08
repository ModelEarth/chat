-- =====================================================
-- Database Triggers (Neon)
-- File: neon/0004_triggers.sql
-- Description: Neon version of 0004_triggers.sql. The delete trigger sits
--   on BetterAuth's "user" table instead of Supabase's auth.users; the rest
--   matches 0004_triggers.sql. Requires the "user" table.
-- =====================================================

-- Clean up a user's chat data when their "user" row is deleted
DROP TRIGGER IF EXISTS on_user_deleted ON public."user";
CREATE TRIGGER on_user_deleted
  BEFORE DELETE ON public."user"
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auth_user_deletion();

-- Validation triggers - ensure user_id exists before INSERT/UPDATE
DROP TRIGGER IF EXISTS validate_chat_user_id ON "Chat";
CREATE TRIGGER validate_chat_user_id
  BEFORE INSERT OR UPDATE ON "Chat"
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

DROP TRIGGER IF EXISTS validate_document_user_id ON "Document";
CREATE TRIGGER validate_document_user_id
  BEFORE INSERT OR UPDATE ON "Document"
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

DROP TRIGGER IF EXISTS validate_suggestion_user_id ON "Suggestion";
CREATE TRIGGER validate_suggestion_user_id
  BEFORE INSERT OR UPDATE ON "Suggestion"
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

DROP TRIGGER IF EXISTS validate_usage_logs_user_id ON usage_logs;
CREATE TRIGGER validate_usage_logs_user_id
  BEFORE INSERT OR UPDATE ON usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

DROP TRIGGER IF EXISTS validate_rate_limit_user_id ON rate_limit_tracking;
CREATE TRIGGER validate_rate_limit_user_id
  BEFORE INSERT OR UPDATE ON rate_limit_tracking
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

DROP TRIGGER IF EXISTS validate_github_repos_user_id ON github_repositories;
CREATE TRIGGER validate_github_repos_user_id
  BEFORE INSERT OR UPDATE ON github_repositories
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_user_id();

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

-- =====================================================
-- Row Level Security (Neon)
-- File: neon/0005_rls.sql
-- Description: Neon version of 0005_rls.sql. Supabase's policies compare
--   rows with auth.uid() and grant access to its anon, authenticated and
--   service_role roles, none of which exist on Neon.
--
--   chat connects as the database owner, which RLS doesn't restrict, and
--   checks who may see what in lib/auth/server.ts. So RLS is enabled with no
--   policies: chat works as before, and any other role that connects is
--   denied every row by default.
-- =====================================================

ALTER TABLE "Chat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Vote_v2" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Suggestion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Stream" ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_activity_logs ENABLE ROW LEVEL SECURITY;

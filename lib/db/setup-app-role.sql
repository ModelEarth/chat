-- Create the limited app_user role for the running application.
-- Run once in: Supabase Dashboard → SQL Editor
--
-- After running, get the app_user connection string from:
--   Project Settings → Database → Connection pooling → Transaction mode (port 6543)
--   Change the username from "postgres" to "app_user" in that URL.
--   Set POSTGRES_URL in your local env file (see automation/paths.yaml) to that connection string.

-- 1. Create the role — generate a strong password with no special characters:
--    openssl rand -hex 32
CREATE ROLE app_user WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';

-- 2. Allow connecting to the database
GRANT CONNECT ON DATABASE postgres TO app_user;

-- 3. Allow using the public schema
GRANT USAGE ON SCHEMA public TO app_user;

-- 4. Grant DML (read/write rows) but no DDL (no create/drop table)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- 5. Sequence access (for any serial columns; UUIDs don't need this but harmless)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- 6. When drizzle-kit migrations (running as postgres) add new tables in future,
--    app_user inherits access automatically without re-running this script.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;

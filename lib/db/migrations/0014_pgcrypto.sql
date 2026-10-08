-- =====================================================
-- Enable pgcrypto for password hashing
-- File: 0014_pgcrypto.sql
-- Description: BetterAuth passwords are hashed in Postgres with crypt() and
--   gen_salt('bf') (bcrypt), the same as the CloudRoot Worker, so both can
--   share one database. See lib/auth/password.ts.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

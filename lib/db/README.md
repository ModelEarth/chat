# Database Setup Guide

This directory contains the database schema and migration tools for the AI Code Chatbot application.

## Quick Start

```bash
# 1. Run migration
npm run db:migrate

# 2. Verify setup
npm run db:verify
```

## Files Overview

### Migration Files

- **`migrations/0001_initial_schema.sql`** - Complete initial schema
  - All table definitions (10 tables)
  - RLS policies (27 policies)
  - Indexes (12 indexes)
  - Triggers for referential integrity (7 triggers)
  - Helper functions (3 functions)
  - Seed data (6 admin configs)

### Core Files

- **`migrate.ts`** - Migration runner (`npm run db:migrate`)
- **`verify-migration.ts`** - Verification script (`npm run db:verify`)
- **`schema.ts`** - TypeScript schema definitions (Drizzle ORM)
- **`supabase-client.ts`** - Supabase client utilities
- **`supabase-queries.ts`** - Helper functions for common queries

## Database Schema

### Core Tables
- **Chat** - Main conversation container
- **Message_v2** - Individual messages
- **Vote_v2** - Message votes
- **Document** - Artifacts (text, code, diagrams)
- **Suggestion** - Document edit suggestions
- **Stream** - Active stream tracking

### Admin & Analytics Tables
- **admin_config** - Agent configurations
- **usage_logs** - API usage analytics
- **rate_limit_tracking** - Rate limit enforcement
- **github_repositories** - Connected GitHub repos

## Foreign Key Constraints

**Important:** Foreign keys to `auth.users` cannot be created in Supabase due to cross-schema restrictions.

### Solution: Triggers
The schema uses database triggers to enforce referential integrity:

1. **CASCADE DELETE**: `handle_auth_user_deletion()` trigger on `auth.users`
   - Automatically deletes user data when user is deleted from `auth.users`

2. **User Validation**: `validate_user_id()` trigger on all tables with `user_id`
   - Prevents INSERT/UPDATE with non-existent user_id
   - Throws error if user doesn't exist

3. **RLS Policies**: Row-level security ensures users only access their own data

### On Neon

On Neon, users are in BetterAuth's `"user"` table (CloudRoot
`auth/db/0001_create_better_auth_tables.sql`), and `migrate.ts` runs the
versions in `migrations/neon/` (see `migrations/README.md`):

- `validate_user_id()` checks `"user"`, and `handle_auth_user_deletion()`
  runs from an `on_user_deleted` trigger on `"user"`. `"user".id` is `text`
  while chat's `user_id` columns are `uuid`, so these triggers stand in for
  foreign keys here too.
- RLS is enabled with no policies. chat connects as the database owner, which
  RLS doesn't restrict, and checks access in `lib/auth/server.ts`; any other
  role is denied every row.

## Verification

After running migrations:

```bash
npm run db:verify
```

Expected output:
```
✅ ALL CHECKS PASSED - Database migration successful!

✅ 10/10 Tables created
✅ 27/27 RLS policies enabled
✅ 12/12 Indexes created
✅ 6/6 Seed configs loaded
✅ 3/3 Helper functions created
✅ 7/7 Triggers created
```

## Environment Variables

Required in `.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://[PROJECT_REF].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[ANON_KEY]
SUPABASE_SERVICE_ROLE_KEY=[SERVICE_KEY]

# For direct Postgres connection (Drizzle)
POSTGRES_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

## Creating First Admin User

After migration, create the first admin user:

### Via Supabase Dashboard

1. Go to **Authentication → Users**
2. Click on a user
3. Edit **User Metadata** (Raw JSON):
   ```json
   {
     "role": "admin",
     "isActive": true
   }
   ```
4. Save

### Via SQL (Supabase SQL Editor)

```sql
-- Find user ID
SELECT id, email FROM auth.users;

-- Update user metadata
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'
)
WHERE id = '[USER_ID]';
```

## NPM Scripts

```bash
# Run migration
npm run db:migrate

# Verify migration
npm run db:verify

# Generate Drizzle types (if schema.ts changes)
npm run db:generate

# Push schema changes (alternative to migrations)
npm run db:push
```

## Troubleshooting

### Migration Fails

1. Check `POSTGRES_URL` in `.env.local`
2. Ensure Supabase project is accessible
3. Check Supabase logs for errors

### Verification Fails

1. Review error messages in verification output
2. Check Supabase logs for RLS policy errors
3. Verify triggers were created

### Trigger Creation on auth.users

The `on_auth_user_deleted` trigger may fail to create if you don't have SUPERUSER privileges. This is expected in some Supabase configurations. If it fails:
- Implement CASCADE DELETE in application code
- Or contact Supabase support to enable the trigger

## Notes

- **Fresh Install**: This is a new project with a clean schema
- **No User Table**: Uses Supabase `auth.users` directly with metadata
- **Role-Based Access**: Admin role stored in JWT `user_metadata`
- **Trigger-Based Integrity**: Replaces FK constraints to `auth.users`
- **Single Migration File**: All setup in `0001_initial_schema.sql`

## Next Steps

After database setup:

1. ✅ Create first admin user (see above)
2. ✅ Test authentication flow
3. ✅ Verify RLS policies work
4. ✅ Begin implementing application features (DEV_PLAN.md Phase 3+)

---

**Documentation**: See `DEV_PLAN.md` for overall project roadmap

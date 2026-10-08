# Database Migrations

This directory contains SQL migration files for the database schema.

## Initial Setup

### For Fresh Installation (First Time)

Run the initial schema creation:

```bash
pnpm db:migrate
# or
npm run db:migrate
```

This will apply `0001_initial_schema.sql` which creates:
- All core tables (Chat, Message_v2, Document, etc.)
- New tables (admin_config, usage_logs, rate_limit_tracking, github_repositories)
- All indexes for performance
- RLS (Row Level Security) policies
- Helper functions for RBAC
- Seed data (default admin configurations)

**Note**: This is a fresh install, not a migration from existing data.

## Migration Files

### Current Migrations

| File | Description | Status |
|------|-------------|--------|
| `0001_initial_schema.sql` | Complete initial database schema with all tables, RLS policies, triggers, indexes, and error logging | ✅ Active |

### Future Migrations

When new migrations are added:

1. **Developer creates migration file**:
   ```bash
   # Create new migration file
   touch lib/db/migrations/0002_add_feature_X.sql
   ```

2. **Test locally**:
   ```bash
   pnpm db:migrate
   ```

3. **Submit PR** with migration file

4. **Super Admin** reviews and applies to production

## Neon

`migrate.ts` detects Neon from the `POSTGRES_URL` host (`*.neon.tech`);
`MIGRATION_TARGET=neon` or `supabase` overrides it. On Neon it runs:

| Supabase file | On Neon |
|---|---|
| `0002_functions.sql` | Runs, followed by `neon/0002_functions.sql`, which points the user functions at BetterAuth's `"user"` table and drops `get_user_role`, `is_current_user_admin` and `get_current_user_usage_summary` (they need Supabase's `auth.uid()`; chat doesn't call them) |
| `0004_triggers.sql` | `neon/0004_triggers.sql`: the user triggers use `"user"` instead of `auth.users`, and only when `"user"` is in the same database |
| `0005_rls.sql` | `neon/0005_rls.sql`: RLS enabled, no policies, no grants to Supabase roles |
| `0013_storage_setup.sql` | Skipped: Supabase Storage |

Every other file runs unchanged. The user tables normally live in a
separate database (`AUTH_POSTGRES_URL`, CloudRoot's `automation/setup-neon.mjs`),
and CloudRoot's `automation/setup-neon-chat.mjs` creates chat's own Neon
project and runs these migrations there. `npm run db:verify` checks the
Neon variant on a Neon database.

## Migration Naming Convention

```
XXXX_description.sql
```

- `XXXX`: Sequential number (0001, 0002, 0003, etc.)
- `description`: Brief description in snake_case

Examples:
- `0001_initial_schema.sql`
- `0002_add_notification_table.sql`
- `0003_add_user_preferences.sql`

## Writing Migrations

### Template

```sql
-- =====================================================
-- Migration: [Brief description]
-- Author: [Your name]
-- Date: [YYYY-MM-DD]
-- =====================================================

BEGIN;

-- Your SQL changes here
ALTER TABLE example ADD COLUMN new_field TEXT;

-- Create indexes if needed
CREATE INDEX IF NOT EXISTS idx_example ON example(new_field);

-- Update RLS policies if needed

COMMIT;

-- =====================================================
-- ROLLBACK (commented out, for reference)
-- =====================================================
-- BEGIN;
-- ALTER TABLE example DROP COLUMN new_field;
-- COMMIT;
```

### Best Practices

✅ **DO:**
- Use `IF NOT EXISTS` / `IF EXISTS` for safety
- Wrap in transactions (BEGIN/COMMIT)
- Add comments explaining changes
- Include rollback script (commented)
- Add indexes for new foreign keys
- Update RLS policies for new tables

❌ **DON'T:**
- Modify existing migrations
- Delete data without backup
- Skip testing locally
- Forget to update RLS policies

## Verification

After running migrations, verify with:

```sql
-- Check all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public';

-- Check policies exist
SELECT tablename, policyname FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename;
```

## Troubleshooting

### Migration fails locally

```bash
# Reset your local database (⚠️ destroys local data)
# In Supabase Dashboard → Database → Reset Database

# Or via SQL:
# DROP SCHEMA public CASCADE;
# CREATE SCHEMA public;

# Then rerun migrations
pnpm db:migrate
```

### Schema drift between environments

```bash
# Export production schema (Super Admin only)
pg_dump --schema-only $PROD_POSTGRES_URL > prod_schema.sql

# Compare with local
diff prod_schema.sql local_schema.sql
```

## See Also

- [DEV_PLAN.md](../../DEV_PLAN.md) - Complete development plan
- [DATABASE_ER_DIAGRAM.md](../../DATABASE_ER_DIAGRAM.md) - Schema documentation
- [PROJECT_MANAGEMENT.md](../../PROJECT_MANAGEMENT.md) - Team workflow

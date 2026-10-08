import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadEnvironment } from "../env-loader";
import { isNeonTarget, migrationsFor } from "./migration-target";

loadEnvironment();

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    console.log("⚠️  POSTGRES_URL is not defined - skipping migrations");
    console.log("ℹ️  Migrations will be skipped for this build");
    return;
  }

  // Skip migrations during Vercel build phase
  // Database is not accessible during build, only at runtime
  // Exception: Allow migrations in CI when POSTGRES_URL is explicitly set (e.g., with Supabase)
  if ((process.env.VERCEL || process.env.CI) && !process.env.RUN_MIGRATIONS) {
    console.log("⚠️  Running in CI/build environment - skipping migrations by default");
    console.log("ℹ️  Set RUN_MIGRATIONS=true to force migrations in CI");
    console.log("ℹ️  Use 'npm run db:migrate' to run migrations manually");
    return;
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const neon = isNeonTarget(process.env.POSTGRES_URL);

  console.log(`⏳ Running migrations${neon ? " (Neon versions)" : ""}...`);
  console.log("📁 Migrations folder: ./lib/db/migrations");

  const start = Date.now();

  try {
    if (neon) {
      const [{ exists }] = await connection`select to_regclass('public."user"') is not null as exists`;
      if (!exists) {
        throw new Error(
          'BetterAuth\'s "user" table is missing. Run CloudRoot\'s auth/db/0001_create_better_auth_tables.sql (or automation/setup-neon.mjs) first.'
        );
      }
    }

    const migrationFiles = migrationsFor(neon);

    for (const file of migrationFiles) {
      console.log(`📄 Running ${file}...`);
      const migrationPath = join(process.cwd(), "lib/db/migrations", file);
      const migrationSQL = readFileSync(migrationPath, "utf-8");

      try {
        // Execute the migration
        await connection.unsafe(migrationSQL);
        console.log(`✅ ${file} completed`);
      } catch (error: any) {
        console.error(`❌ Error in ${file}:`);
        console.error("Message:", error.message);
        if (error.code) {
          console.error("Code:", error.code);
        }
        if (error.position) {
          console.error("Position:", error.position);
        }
        if (error.detail) {
          console.error("Detail:", error.detail);
        }
        if (error.hint) {
          console.error("Hint:", error.hint);
        }
        throw error;
      }
    }

    const end = Date.now();
    console.log("✅ All migrations completed in", end - start, "ms");
    console.log("🔍 Run 'npm run db:verify' to verify the migration");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await connection.end();
  }
};

if (require.main === module) {
  runMigrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Migration failed");
      console.error(err);
      process.exit(1);
    });
}

export { runMigrate };

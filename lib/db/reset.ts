import postgres from "postgres";
import { loadEnvironment } from "../env-loader";

loadEnvironment();

const resetDatabase = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not defined");
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });

  console.log("🗑️  Resetting database...");
  console.log("📋 Dropping existing tables...");

  try {
    // Drop storage bucket first (before tables)
    console.log("🪣 Dropping storage bucket...");
    try {
      await connection`DELETE FROM storage.objects WHERE bucket_id = 'chat-attachments'`;
      await connection`DELETE FROM storage.buckets WHERE id = 'chat-attachments'`;
      console.log("✅ Storage bucket dropped");
    } catch (storageError) {
      console.log("ℹ️  Storage bucket not found or already dropped");
    }

    // Drop all tables in reverse dependency order
    await connection`DROP TABLE IF EXISTS error_logs CASCADE`;
    await connection`DROP TABLE IF EXISTS github_repositories CASCADE`;
    await connection`DROP TABLE IF EXISTS rate_limit_tracking CASCADE`;
    await connection`DROP TABLE IF EXISTS usage_logs CASCADE`;
    await connection`DROP TABLE IF EXISTS model_config CASCADE`;
    await connection`DROP TABLE IF EXISTS admin_config CASCADE`;
    await connection`DROP TABLE IF EXISTS "Stream" CASCADE`;
    await connection`DROP TABLE IF EXISTS "Suggestion" CASCADE`;
    await connection`DROP TABLE IF EXISTS "Document" CASCADE`;
    await connection`DROP TABLE IF EXISTS "Vote_v2" CASCADE`;
    await connection`DROP TABLE IF EXISTS "Message_v2" CASCADE`;
    await connection`DROP TABLE IF EXISTS "Chat" CASCADE`;

    // Drop functions
    await connection`DROP FUNCTION IF EXISTS public.get_user_role() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.validate_user_id() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.handle_auth_user_deletion() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.get_current_user_usage_summary(DATE, DATE) CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.is_current_user_admin() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.update_admin_config_timestamp() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.update_model_config_timestamp() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.ensure_single_default_model_per_provider() CASCADE`;
    await connection`DROP FUNCTION IF EXISTS public.validate_admin_config_data() CASCADE`;

    console.log("✅ All tables and functions dropped successfully");
  } catch (error) {
    console.error("❌ Error dropping tables:", error);
    throw error;
  } finally {
    await connection.end();
  }
};

if (require.main === module) {
  resetDatabase()
    .then(() => {
      console.log("✅ Database reset completed");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Database reset failed:", err);
      process.exit(1);
    });
}

export { resetDatabase };

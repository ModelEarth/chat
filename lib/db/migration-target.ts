// Neon gets its own versions of the Supabase-specific migrations (see
// migrations/neon/): users are in BetterAuth's "user" table instead of
// auth.users, and Supabase's RLS roles and Storage don't exist there.
// Detected from the host; MIGRATION_TARGET=neon or supabase overrides it.
export function isNeonTarget(url: string): boolean {
  const target = process.env.MIGRATION_TARGET;
  if (target) return target === "neon";
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

export function migrationsFor(neon: boolean): string[] {
  const supabase = [
    "0001_tables.sql",
    "0002_functions.sql",
    "0003_indexes.sql",
    "0004_triggers.sql",
    "0005_rls.sql",
    "0006_seed_data_app_settings.sql",
    "0006_seed_data_google.sql",
    "0006_seed_data_openai.sql",
    "0006_seed_data_anthropic.sql",
    "0007_seed_data_model_config.sql",
    "0008_seed_data_xai_groq.sql",
    "0013_storage_setup.sql",
    "0014_pgcrypto.sql",
  ];
  if (!neon) return supabase;
  return supabase.flatMap((file) => {
    if (file === "0002_functions.sql") return [file, "neon/0002_functions.sql"];
    if (file === "0004_triggers.sql" || file === "0005_rls.sql") return [`neon/${file}`];
    if (file === "0013_storage_setup.sql") return [];
    return [file];
  });
}

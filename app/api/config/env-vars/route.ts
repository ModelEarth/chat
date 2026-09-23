import "server-only";
import { NextResponse } from "next/server";
import { corsPreflight, withCors } from "@/lib/cors";

export const runtime = "nodejs";

// Node's counterpart to team's Rust /api/config/env (team/src/main.rs
// get_env_config): both read the same env file (the one automation/paths.yaml
// points at — see lib/env-loader.ts) and expose the same non-secret fields,
// so team/admin/google/form/form.js can point at whichever backend is
// actually running. Only the fields form.js reads are included — see
// fetchConfigEnv() in form.js.
//
// Named "env-vars" rather than "env": chat/.gitignore has a bare `env`
// pattern (for a root-level Python venv folder) that silently swallows any
// path component literally named "env" anywhere in the tree.
export async function OPTIONS() {
  return corsPreflight();
}

export async function GET() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID || null;
  const googleProjectId = process.env.GOOGLE_PROJECT_ID || null;

  const betterAuthSecret = process.env.BETTER_AUTH_SECRET;
  const betterAuthSecretPresent =
    !!betterAuthSecret &&
    betterAuthSecret.length >= 32 &&
    betterAuthSecret !== "CHANGE_ME_GENERATE_WITH_openssl_rand_base64_32";

  return withCors(
    NextResponse.json({
      google_client_id: googleClientId,
      google_project_id: googleProjectId,
      better_auth_secret_present: betterAuthSecretPresent,
      better_auth_base_url: process.env.BASE_URL || null,
      better_auth_allowed_origins: process.env.ALLOWED_ORIGINS || null,
    })
  );
}

import "server-only";
import { NextResponse } from "next/server";
import { isPlaceholderValue } from "@/lib/auth/env-placeholder";
import { SOCIAL_PROVIDER_ENV_VARS } from "@/lib/auth/social-providers";

// Serves real secret values so a developer can copy their local env file
// (the one automation/paths.yaml points at) into Vercel's dashboard without
// ever seeing them rendered readably on screen (client
// blurs them; see components/local-env-key-panel.tsx). Double-gated: refuses
// to serve anything unless the request is actually local AND this isn't a
// Vercel deployment — never rely on the client hiding the panel alone.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

const EXTRA_VAR_NAMES = ["BETTER_AUTH_SECRET", "POSTGRES_URL"] as const;

function isLocalRequest(request: Request): boolean {
  if (process.env.VERCEL) return false;
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  return LOCAL_HOSTNAMES.has(hostname);
}

export async function GET(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const varNames: string[] = [
    ...Object.values(SOCIAL_PROVIDER_ENV_VARS).flatMap((v) => [v.clientId, v.clientSecret]),
    ...EXTRA_VAR_NAMES,
  ];

  // Unset vars are omitted (nothing to show); placeholder vars are kept but
  // flagged so the client can still list them without treating them as real,
  // worth-copying secrets.
  const values = varNames
    .map((name) => {
      const value = process.env[name] ?? "";
      return { name, value, isPlaceholder: isPlaceholderValue(name, value) };
    })
    .filter((entry) => entry.value.length > 0);

  return NextResponse.json({ values });
}

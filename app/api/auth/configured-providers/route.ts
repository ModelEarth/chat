import "server-only";
import { NextResponse } from "next/server";
import { getConfiguredSocialProviders } from "@/lib/auth/social-providers";

// Provider names only — safe to expose publicly, no gating needed (unlike
// local-env-values, this never carries a secret value).
export async function GET() {
  const providers = getConfiguredSocialProviders();
  return NextResponse.json({ providers });
}

import "server-only";
import { authDbUrlName, isAuthDbConfigured, isAuthDbReachable } from "@/lib/db/queries/base";
import { isPlaceholderValue } from "@/lib/auth/env-placeholder";

// Status of the sign-in database (AUTH_POSTGRES_URL, or POSTGRES_URL).
// Distinguishes "nothing set up yet" from "configured but currently down" —
// the two need different messages (and different fix-it links) wherever a
// sign-in/sign-up form needs to explain why it's disabled.
export type DbStatus = "ok" | "not-configured" | "unreachable";

export async function getDbStatus(): Promise<DbStatus> {
  // A POSTGRES_URL that's still the unfilled automation/.env.example placeholder
  // is really "not configured" — attempting a real connection to it would
  // just hang on a fake host until connect_timeout, and misreport the more
  // actionable "add POSTGRES_URL" case as a Supabase-pause "unreachable" one.
  if (!isAuthDbConfigured || isPlaceholderValue(authDbUrlName, process.env[authDbUrlName] ?? "")) {
    return "not-configured";
  }
  return (await isAuthDbReachable()) ? "ok" : "unreachable";
}

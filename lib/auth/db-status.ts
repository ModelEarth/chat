import "server-only";
import { isDbConfigured, isDbReachable } from "@/lib/db/queries/base";
import { isPlaceholderValue } from "@/lib/auth/env-placeholder";

// Distinguishes "nothing set up yet" from "configured but currently down" —
// the two need different messages (and different fix-it links) wherever a
// sign-in/sign-up form needs to explain why it's disabled.
export type DbStatus = "ok" | "not-configured" | "unreachable";

export async function getDbStatus(): Promise<DbStatus> {
  // A POSTGRES_URL that's still the unfilled automation/.env.example placeholder
  // is really "not configured" — attempting a real connection to it would
  // just hang on a fake host until connect_timeout, and misreport the more
  // actionable "add POSTGRES_URL" case as a Supabase-pause "unreachable" one.
  if (!isDbConfigured || isPlaceholderValue("POSTGRES_URL", process.env.POSTGRES_URL ?? "")) {
    return "not-configured";
  }
  return (await isDbReachable()) ? "ok" : "unreachable";
}

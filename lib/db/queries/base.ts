import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

// db is null when POSTGRES_URL is not set (stateless / OAuth-only mode).
// Callers that need DB must check isDbConfigured before using db.
export const isDbConfigured = !!process.env.POSTGRES_URL;

const client = isDbConfigured ? neon(process.env.POSTGRES_URL!) : null;

export const db = client ? drizzle(client) : null;

// Sign-in tables (BetterAuth's user, session, account, verification) live in
// their own database, AUTH_POSTGRES_URL: CloudRoot's Neon project
// "cloudroot", shared with the CloudRoot Worker. chat's own data stays in
// POSTGRES_URL. Without AUTH_POSTGRES_URL, both use POSTGRES_URL.
export const authDbUrlName = process.env.AUTH_POSTGRES_URL ? "AUTH_POSTGRES_URL" : "POSTGRES_URL";
const authUrl = process.env.AUTH_POSTGRES_URL || process.env.POSTGRES_URL;
export const isAuthDbConfigured = !!authUrl;
const authClient = !authUrl ? null : authUrl === process.env.POSTGRES_URL ? client : neon(authUrl);

export const authDb = authClient ? drizzle(authClient) : null;

export function getDb() {
  if (!db) throw new Error("Database not configured — set POSTGRES_URL (locally: your local env file, see automation/paths.yaml; production: Vercel env vars)");
  return db;
}

// Reachability check for the sign-in database.
export async function isAuthDbReachable(): Promise<boolean> {
  if (!authClient) {
    return false;
  }
  try {
    await authClient`select 1`;
    return true;
  } catch {
    return false;
  }
}

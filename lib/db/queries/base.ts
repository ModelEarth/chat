import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

// chat's own data (chats, messages, documents, settings, logs) is in
// CHAT_POSTGRES_URL: CloudRoot's Neon project "chat". On Vercel the same value
// is duplicated as POSTGRES_URL, the standard name Vercel's Postgres
// integrations use, which chat also accepts when CHAT_POSTGRES_URL isn't set.
// db is null when neither is set (stateless / OAuth-only mode).
// Callers that need DB must check isDbConfigured before using db.
export const chatDbUrl = process.env.CHAT_POSTGRES_URL || process.env.POSTGRES_URL;
export const isDbConfigured = !!chatDbUrl;

const client = chatDbUrl ? neon(chatDbUrl) : null;

export const db = client ? drizzle(client) : null;

// Sign-in tables (BetterAuth's user, session, account, verification) live in
// their own database, AUTH_POSTGRES_URL: CloudRoot's Neon project
// "cloudroot", shared with the CloudRoot Worker. Without AUTH_POSTGRES_URL,
// sign-in uses chat's database too.
export const authDbUrlName = process.env.AUTH_POSTGRES_URL
  ? "AUTH_POSTGRES_URL"
  : process.env.CHAT_POSTGRES_URL
    ? "CHAT_POSTGRES_URL"
    : "POSTGRES_URL";
const authUrl = process.env.AUTH_POSTGRES_URL || chatDbUrl;
export const isAuthDbConfigured = !!authUrl;
const authClient = !authUrl ? null : authUrl === chatDbUrl ? client : neon(authUrl);

export const authDb = authClient ? drizzle(authClient) : null;

export function getDb() {
  if (!db) throw new Error("Database not configured — set CHAT_POSTGRES_URL or POSTGRES_URL (locally: your local env file, see automation/paths.yaml; production: Vercel env vars)");
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

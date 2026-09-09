import "server-only";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

// db is null when POSTGRES_URL is not set (stateless / OAuth-only mode).
// Callers that need DB must check isDbConfigured before using db.
export const isDbConfigured = !!process.env.POSTGRES_URL;

const client = isDbConfigured ? neon(process.env.POSTGRES_URL!) : null;

export const db = client ? drizzle(client) : null;

export function getDb() {
  if (!db) throw new Error("Database not configured — set POSTGRES_URL (locally: docker/.env, production: Vercel env vars)");
  return db;
}

// Generic Postgres reachability check — works for any POSTGRES_URL backend
// (Supabase, Neon, ...), not tied to a specific provider's SDK.
export async function isDbReachable(): Promise<boolean> {
  if (!(isDbConfigured && client)) {
    return false;
  }
  try {
    await client`select 1`;
    return true;
  } catch {
    return false;
  }
}

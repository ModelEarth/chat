import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type sheets_v4, google } from "googleapis";

// GOOGLE_SERVICE_KEY has been documented two different ways across this
// project (README: a file path; the existing Rust implementation: the raw
// JSON inline) — support both rather than picking one and breaking the other.
function loadServiceAccountCredentials(): Record<string, unknown> | null {
  const inlineJson = process.env.GOOGLE_SERVICE_KEY_JSON || process.env.GOOGLE_SERVICE_KEY;
  if (!inlineJson) return null;

  const trimmed = inlineJson.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  // Otherwise treat the value as a path to the downloaded service account key file.
  const resolvedPath = trimmed.startsWith("/") ? trimmed : resolve(process.cwd(), trimmed);
  if (!existsSync(resolvedPath)) return null;
  try {
    return JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch {
    return null;
  }
}

let cachedClient: sheets_v4.Sheets | null = null;
let cachedCredentialsKey: string | null = null;

// Cache the client per-process, but rebuild it if the underlying env var
// changes (e.g. a dev server picking up an edited local env file after restart).
export function getSheetsClient(): sheets_v4.Sheets | null {
  const credentialsKey = process.env.GOOGLE_SERVICE_KEY_JSON || process.env.GOOGLE_SERVICE_KEY || null;
  if (!credentialsKey) return null;

  if (cachedClient && cachedCredentialsKey === credentialsKey) {
    return cachedClient;
  }

  const credentials = loadServiceAccountCredentials();
  if (!credentials) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: credentials as { client_email?: string; private_key?: string },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  cachedClient = google.sheets({ version: "v4", auth });
  cachedCredentialsKey = credentialsKey;
  return cachedClient;
}

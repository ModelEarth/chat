import { config } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables from the first .env file found, probing
 * multiple locations to support two run modes:
 *
 *   Mode A — run from webroot root (cd webroot && pnpm dev):
 *     CWD = webroot/  →  docker/.env  found at  <cwd>/docker/.env
 *
 *   Mode B — run from chat directory (cd webroot/chat && pnpm dev):
 *     CWD = webroot/chat/  →  docker/.env  found at  <cwd>/../docker/.env
 *
 *   Mode C — standalone / no docker setup:
 *     Falls back to  <cwd>/.env  (a local chat/.env file)
 */
export function loadEnvironment() {
  const cwd = process.cwd();

  const candidates = [
    resolve(cwd, '../docker/.env'),  // Mode B: chat/ is cwd
    resolve(cwd, 'docker/.env'),     // Mode A: webroot/ is cwd
    resolve(cwd, '.env'),            // Mode C: standalone fallback
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      console.log(`[env-loader] Loading environment from ${envPath}`);
      config({ path: envPath });
      return envPath;
    }
  }

  console.log('[env-loader] No .env file found, using system environment variables');
  return null;
}

// Auto-load when this module is imported
loadEnvironment();

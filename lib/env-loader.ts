import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Load environment variables from the .env file that
 * ../automation/paths.yaml's `env_file:` key points at — the same key
 * automation/sync-config.sh reads and writes — instead of a hardcoded
 * docker/.env path, so there's exactly one place (per machine) that says
 * where secrets live.
 *
 * Probes two locations for automation/ to support two run modes:
 *
 *   Mode A — run from webroot root (cd webroot && pnpm dev):
 *     CWD = webroot/  →  automation/  found at  <cwd>/automation
 *
 *   Mode B — run from chat directory (cd webroot/chat && pnpm dev):
 *     CWD = webroot/chat/  →  automation/  found at  <cwd>/../automation
 *
 *   Mode C — standalone / no webroot checkout, or no paths.yaml yet:
 *     Falls back to <cwd>/.env (a local chat/.env file), then to whatever's
 *     already in the process environment. Run automation/sync-config.sh (or
 *     create automation/paths.yaml by hand) to set env_file: once.
 */

function findAutomationDir(cwd: string): string | null {
  const candidates = [
    resolve(cwd, '../automation'), // Mode B: chat/ is cwd
    resolve(cwd, 'automation'),    // Mode A: webroot/ is cwd
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

function readEnvFileSetting(pathsYamlFile: string): string | null {
  try {
    const raw = readFileSync(pathsYamlFile, 'utf-8');
    const match = raw.match(/^\s*env_file:\s*(.+?)\s*$/m);
    return match ? match[1].replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

export function loadEnvironment() {
  const cwd = process.cwd();
  const automationDir = findAutomationDir(cwd);

  if (automationDir) {
    const pathsYamlFile = resolve(automationDir, 'paths.yaml');
    const envFileSetting = readEnvFileSetting(pathsYamlFile);

    if (envFileSetting) {
      const envPath = resolve(automationDir, envFileSetting);
      if (existsSync(envPath)) {
        console.log(`[env-loader] Loading environment from ${envPath} (via ${pathsYamlFile})`);
        config({ path: envPath });
        return envPath;
      }
      console.log(
        `[env-loader] ${pathsYamlFile} points at ${envPath}, but that file doesn't exist yet.`
      );
    } else {
      console.log(
        `[env-loader] No env_file: set in ${pathsYamlFile} yet — run automation/sync-config.sh once, or add it by hand.`
      );
    }
  }

  // Mode C fallback: a local .env file next to cwd — no webroot/automation
  // context at all (standalone chat/ checkout, or a platform deploy).
  const localEnvPath = resolve(cwd, '.env');
  if (existsSync(localEnvPath)) {
    console.log(`[env-loader] Loading environment from ${localEnvPath}`);
    config({ path: localEnvPath });
    return localEnvPath;
  }

  console.log('[env-loader] No .env file found, using system environment variables');
  return null;
}

// Auto-load when this module is imported
loadEnvironment();

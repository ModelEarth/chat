import { readFileSync } from "node:fs";

/**
 * Shared by lib/env-loader.ts and server.mjs so the parsing of
 * automation/paths.yaml's `env_file:` key lives in exactly one place,
 * instead of being hand-kept in sync between the TypeScript and plain-JS
 * copies of the env loader — a prior duplication that let the two drift
 * (server.mjs was missing env-loader.ts's local-.env fallback).
 *
 * Strips a trailing, whitespace-preceded inline comment (e.g.
 * `env_file: ../foo.env  # laptop`) before trimming and unquoting, so a
 * hand-edited paths.yaml line doesn't silently resolve to a bogus path with
 * the comment text still attached.
 */
export function readEnvFileSetting(pathsYamlFile) {
  try {
    const raw = readFileSync(pathsYamlFile, "utf-8");
    const match = raw.match(/^\s*env_file:\s*(.+)$/m);
    if (!match) return null;
    const value = match[1]
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^["']|["']$/g, "");
    return value || null;
  } catch {
    return null;
  }
}

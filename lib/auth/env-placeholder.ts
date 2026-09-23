import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Shared by isSocialProviderConfigured (button graying) and the
// local-env-values API route (copy panel) so both agree on what counts as
// "not really configured" — a var can be *present* but still just be the
// unfilled example text.

// Same probing order as lib/env-loader.ts, targeting automation/.env.example
// instead of a live env file. Cached after first read since this can be
// called per-request.
let cachedExampleValues: Record<string, string> | null = null;

function loadExampleValues(): Record<string, string> {
  if (cachedExampleValues) return cachedExampleValues;
  const cwd = process.cwd();
  const candidates = [resolve(cwd, "../automation/.env.example"), resolve(cwd, "automation/.env.example")];
  const examplePath = candidates.find((p) => existsSync(p));
  const values: Record<string, string> = {};
  if (examplePath) {
    for (const line of readFileSync(examplePath, "utf-8").split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2].trim();
    }
  }
  cachedExampleValues = values;
  return values;
}

// Catches placeholder text that predates the current automation/.env.example
// wording too (e.g. an older "your-facebook-app-id" left over from before
// the example file's own placeholder text was updated) — a backstop for the
// exact-match check, not a replacement for it.
const GENERIC_PLACEHOLDER_PATTERN = /^(your-|change_me|changeme)/i;

export function isPlaceholderValue(varName: string, value: string): boolean {
  if (!value) return false; // emptiness is a separate concern from callers
  const exampleValues = loadExampleValues();
  return value === exampleValues[varName] || GENERIC_PLACEHOLDER_PATTERN.test(value);
}

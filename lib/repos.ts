import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type Repo = { name: string; label: string };

/**
 * Default repo list used when .gitmodules and .siterepos are unavailable.
 * These should match the `repo_name` values stored in Pinecone metadata.
 */
const DEFAULT_REPOS: Repo[] = [
  { name: "data-commons", label: "data-commons" },
  { name: "open-footprint", label: "open-footprint" },
  { name: "community-data", label: "community-data" },
  { name: "requests", label: "requests" },
  { name: "useeio-widgets", label: "useeio-widgets" },
];

/**
 * Parse repository names from a .gitmodules file.
 * Extracts the submodule name from lines like: [submodule "repo-name"]
 * Returns the last path segment as the repo name.
 */
function parseGitmodules(content: string): string[] {
  const repos: string[] = [];
  const pattern = /\[submodule\s+"([^"]+)"\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const raw = match[1].trim();
    // Take the last path segment (e.g., "path/to/repo" → "repo")
    const name = raw.split("/").pop()?.trim();
    if (name) {
      repos.push(name);
    }
  }

  return repos;
}

/**
 * Parse repository names from a .siterepos file.
 * Supports git config format: [siterepo "name"] with path/url entries.
 */
function parseSiterepos(content: string): string[] {
  const repos: string[] = [];
  const pattern = /\[siterepo\s+"([^"]+)"\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const name = match[1].trim();
    if (name) repos.push(name);
  }

  return repos;
}

/**
 * Read a file from the project root, returning null if it doesn't exist.
 */
async function readProjectFile(filename: string): Promise<string | null> {
  try {
    const filePath = resolve(process.cwd(), "..", filename);
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Get the list of available repositories for RAG filtering.
 *
 * Attempts to read repo names from:
 *   1. .gitmodules (git submodule config)
 *   2. .siterepos (plain text, one repo per line)
 *
 * Falls back to a hardcoded default list if neither file exists
 * or parsing yields zero results.
 */
export async function getAvailableRepos(): Promise<Repo[]> {
  const repoMap = new Map<string, Repo>();

  // Try .gitmodules — plain name, no suffix
  const gitmodulesContent = await readProjectFile(".gitmodules");
  if (gitmodulesContent) {
    for (const name of parseGitmodules(gitmodulesContent)) {
      repoMap.set(name, { name, label: name });
    }
  }

  // Try .siterepos — append " (site)" suffix
  const sitereposContent = await readProjectFile(".siterepos");
  if (sitereposContent) {
    for (const name of parseSiterepos(sitereposContent)) {
      repoMap.set(name, { name, label: `${name} (site)` });
    }
  }

  // Fall back to defaults if nothing was parsed
  if (repoMap.size === 0) {
    return DEFAULT_REPOS;
  }

  // Sort alphabetically by label
  return [...repoMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

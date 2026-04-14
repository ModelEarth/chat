import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type Repo = { name: string; label: string };

const ALLOWED_RAW_HOST = "raw.githubusercontent.com";

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
    const name = raw.split("/").pop()?.trim();
    if (name) repos.push(name);
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
 * Read a file from the webroot root (one level above chat/), returning null if not found.
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
 * Fetch raw file content from a URL.
 * Only allows https://raw.githubusercontent.com/ URLs to prevent SSRF.
 * Returns null on failure.
 */
async function fetchRemoteFile(url: string): Promise<string | null> {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== ALLOWED_RAW_HOST || parsed.protocol !== "https:") {
      console.warn(`[repos] Blocked fetch from disallowed host: ${url}`);
      return null;
    }

    const response = await fetch(url, { next: { revalidate: 3600 } });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Get the list of available repositories for RAG filtering.
 *
 * Priority:
 *   1. Local ../. gitmodules and ../.siterepos (when running inside webroot)
 *   2. Remote URLs defined in ../siteconfig.yaml (fallback for deployed environments)
 *   3. Empty list if nothing is available
 */
export async function getAvailableRepos(): Promise<Repo[]> {
  const repoMap = new Map<string, Repo>();

  // — Local files (dev / self-hosted) —
  const gitmodulesContent = await readProjectFile(".gitmodules");
  if (gitmodulesContent) {
    for (const name of parseGitmodules(gitmodulesContent)) {
      repoMap.set(name, { name, label: name });
    }
  }

  const sitereposContent = await readProjectFile(".siterepos");
  if (sitereposContent) {
    for (const name of parseSiterepos(sitereposContent)) {
      repoMap.set(name, { name, label: `${name} (site)` });
    }
  }

  // — Remote fallback via env vars (deployed environments e.g. Vercel) —
  if (repoMap.size === 0) {
    const gitmodulesUrl = process.env.RAG_GITMODULES_URL ?? null;
    const sitereposUrl = process.env.RAG_SITEREPOS_URL ?? null;

    if (gitmodulesUrl) {
      const remote = await fetchRemoteFile(gitmodulesUrl);
      if (remote) {
        for (const name of parseGitmodules(remote)) {
          repoMap.set(name, { name, label: name });
        }
      }
    }

    if (sitereposUrl) {
      const remote = await fetchRemoteFile(sitereposUrl);
      if (remote) {
        for (const name of parseSiterepos(remote)) {
          repoMap.set(name, { name, label: `${name} (site)` });
        }
      }
    }

    if (!gitmodulesUrl && !sitereposUrl) {
      console.warn("[repos] RAG_GITMODULES_URL and RAG_SITEREPOS_URL are not set — no repos available.");
    }
  }

  return [...repoMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

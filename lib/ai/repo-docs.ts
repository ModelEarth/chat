import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Pulls README.md / AGENTS.md / CLAUDE.md from the selected repos so they can
 * be handed to an LLM directly (see repo-docs-agent.ts), instead of — or
 * alongside — RAG retrieval.
 *
 * Reads straight off disk from the webroot, the same way lib/repos.ts reads
 * sibling submodules, so it only works when chat runs inside the webroot.
 * Fetching these files from GitHub for a standalone deployment is not
 * implemented yet.
 */

const DOC_FILENAMES = ["README.md", "AGENTS.md", "CLAUDE.md"] as const;

// Keeps one huge doc from eating the whole context budget. Chosen to match
// the order of magnitude of RAG_PER_SNIPPET_CHARS's default (1800) times a
// generous multiple, not a hard spec from anyone — revisit if it's wrong.
const MAX_CHARS_PER_FILE = 8000;

export type RepoDoc = {
  repoName: string;
  fileName: (typeof DOC_FILENAMES)[number];
  content: string;
};

function getWebrootBase(): string {
  return process.env.WEBROOT_PATH ?? resolve(process.cwd(), "..");
}

async function readRepoFile(
  repoName: string,
  fileName: (typeof DOC_FILENAMES)[number]
): Promise<string | null> {
  try {
    const filePath = resolve(getWebrootBase(), repoName, fileName);
    const content = await readFile(filePath, "utf-8");
    return content.length > MAX_CHARS_PER_FILE
      ? `${content.slice(0, MAX_CHARS_PER_FILE)}\n\n...(truncated)`
      : content;
  } catch {
    // Not every repo has every file (e.g. no CLAUDE.md) — skip, don't error.
    return null;
  }
}

/**
 * Fetch README/AGENTS/CLAUDE for each selected repo. Repos with none of the
 * three files simply contribute nothing — never throws on a missing file.
 */
export async function getRepoDocs(repoNames: string[]): Promise<RepoDoc[]> {
  const reads = repoNames.flatMap((repoName) =>
    DOC_FILENAMES.map(async (fileName) => {
      const content = await readRepoFile(repoName, fileName);
      return content ? { repoName, fileName, content } : null;
    })
  );

  const results = await Promise.all(reads);
  return results.filter((doc): doc is RepoDoc => doc !== null);
}

/**
 * Formats fetched docs the same way chat/app/(chat)/api/chat/route.ts
 * already formats uploaded file attachments ("File: ...\nContent:\n..."),
 * so this slots into the existing context-building convention rather than
 * inventing a new one.
 */
export function formatRepoDocsContext(docs: RepoDoc[]): string {
  if (docs.length === 0) return "";
  const sections = docs.map(
    (doc) => `File: ${doc.repoName}/${doc.fileName}\nContent:\n${doc.content}`
  );
  return `\n\nRepo Documentation:\n${sections.join("\n\n")}`;
}

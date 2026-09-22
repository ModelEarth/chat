import {
  answerFromRepoDocs,
  type RepoDocsApiKeys,
  type RepoDocsProvider,
} from "@/lib/ai/repo-docs-agent";

const VALID_PROVIDERS: RepoDocsProvider[] = ["google", "anthropic", "openai"];

// Same convention as app/(chat)/api/chat/route.ts: a plaintext key from the
// browser's session cache, or an RSA-encrypted blob only the server can
// decrypt. Server env vars are the fallback (handled in repo-docs-agent.ts).
async function readApiKeys(request: Request): Promise<RepoDocsApiKeys> {
  const keys: RepoDocsApiKeys = {};
  for (const provider of VALID_PROVIDERS) {
    const plain = request.headers.get(`x-${provider}-api-key`);
    if (plain) {
      keys[provider] = plain;
      continue;
    }
    const enc = request.headers.get(`x-${provider}-api-key-enc`);
    if (enc) {
      const { decryptWithServerKey } = await import("@/lib/server-crypto");
      const decrypted = decryptWithServerKey(enc);
      if (decrypted) keys[provider] = decrypted;
    }
  }
  return keys;
}

export async function POST(request: Request) {
  let body: { query?: string; selectedRepos?: string[]; providers?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  const selectedRepos = Array.isArray(body.selectedRepos) ? body.selectedRepos : [];

  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  if (selectedRepos.length === 0) {
    return Response.json({ error: "selectedRepos must be a non-empty array" }, { status: 400 });
  }

  const requestedProviders = Array.isArray(body.providers) ? body.providers : undefined;
  const providers = requestedProviders?.filter((p): p is RepoDocsProvider =>
    VALID_PROVIDERS.includes(p as RepoDocsProvider)
  );

  const result = await answerFromRepoDocs({
    query,
    repoNames: selectedRepos,
    providers,
    apiKeys: await readApiKeys(request),
  });

  return Response.json(result);
}

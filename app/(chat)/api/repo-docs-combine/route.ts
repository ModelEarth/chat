import { combineAnswers, type RepoDocsAnswerInput } from "@/lib/ai/repo-docs-combine";
import type { LLMApiKeys, LLMProvider } from "@/lib/ai/llm-provider-call";

const VALID_PROVIDERS: LLMProvider[] = ["google", "anthropic", "openai"];

// Same convention as /api/repo-docs-answer and /api/chat: a plaintext key
// from the browser's session cache, or an RSA-encrypted blob only the
// server can decrypt. Server env vars are the fallback (in llm-provider-call.ts).
async function readApiKeys(request: Request): Promise<LLMApiKeys> {
  const keys: LLMApiKeys = {};
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
  let body: {
    query?: string;
    repoDocsAnswers?: RepoDocsAnswerInput[];
    chatAnswer?: string;
    provider?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = body.query?.trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const repoDocsAnswers = Array.isArray(body.repoDocsAnswers)
    ? body.repoDocsAnswers.filter(
        (a): a is RepoDocsAnswerInput =>
          typeof a?.answer === "string" && a.answer.trim().length > 0
      )
    : [];
  const chatAnswer = typeof body.chatAnswer === "string" ? body.chatAnswer : "";

  const provider = VALID_PROVIDERS.includes(body.provider as LLMProvider)
    ? (body.provider as LLMProvider)
    : undefined;

  const result = await combineAnswers({
    query,
    repoDocsAnswers,
    chatAnswer,
    provider,
    apiKeys: await readApiKeys(request),
  });

  return Response.json(result);
}

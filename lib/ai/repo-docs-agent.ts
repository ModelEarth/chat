import "server-only";

import {
  callProvider,
  defaultModelId,
  type LLMApiKeys,
  type LLMProvider,
} from "./llm-provider-call";
import { getRepoDocs, formatRepoDocsContext } from "./repo-docs";

/**
 * Generates answers from ONLY the selected repos' README / AGENTS / CLAUDE
 * files — no RAG, no other context. Shown alongside (not blended into) the
 * normal RAG-informed chat answer, and can run several providers at once.
 *
 * The actual "call an LLM, with the Gemini-retirement fallback chain" logic
 * lives in llm-provider-call.ts, shared with repo-docs-combine's route.
 */

// Re-exported so existing importers (the API route, tests) don't need to
// change just because the provider-calling logic moved to a shared module.
export type RepoDocsProvider = LLMProvider;
export type RepoDocsApiKeys = LLMApiKeys;

export type RepoDocsAnswer = {
  provider: RepoDocsProvider;
  modelId: string;
  answer?: string;
  error?: string;
};

export type RepoDocsAnswerResult = {
  sourceCount: number;
  answers: RepoDocsAnswer[];
};

/**
 * Fetches README/AGENTS/CLAUDE for the given repos and asks one or more
 * providers to answer `query` using only that content — no RAG, no other
 * context. Runs requested providers in parallel; one provider failing
 * (missing key, unimplemented, network error) never blocks the others —
 * each result carries its own `error` field instead of throwing.
 */
export async function answerFromRepoDocs(params: {
  query: string;
  repoNames: string[];
  providers?: RepoDocsProvider[];
  apiKeys?: RepoDocsApiKeys;
}): Promise<RepoDocsAnswerResult> {
  const providers = params.providers?.length ? params.providers : (["google"] as const);
  const docs = await getRepoDocs(params.repoNames);

  if (docs.length === 0) {
    return {
      sourceCount: 0,
      answers: providers.map((provider) => ({
        provider,
        modelId: defaultModelId(provider),
        error: "No README/AGENTS/CLAUDE files found for the selected repos",
      })),
    };
  }

  const prompt = `You are answering a question using ONLY the project documentation below — do not use outside knowledge about these projects.\n${formatRepoDocsContext(
    docs
  )}\n\nQuestion: ${params.query}`;

  const answers = await Promise.all(
    providers.map((provider) => callProvider(provider, prompt, params.apiKeys))
  );

  return { sourceCount: docs.length, answers };
}

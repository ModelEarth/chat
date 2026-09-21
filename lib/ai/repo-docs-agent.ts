import "server-only";

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { getRepoDocs, formatRepoDocsContext } from "./repo-docs";

/**
 * Generates answers from ONLY the selected repos' README / AGENTS / CLAUDE
 * files — no RAG, no other context. Shown alongside (not blended into) the
 * normal RAG-informed chat answer, and can run several providers at once.
 */

export type RepoDocsProvider = "google" | "anthropic" | "openai";

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

// Picked to match model IDs already used elsewhere in this codebase
// (worker/src/index.js uses claude-sonnet-4-6 / gpt-4o-mini) — not a spec
// from anyone, just consistency. Easy to change in one place.
const MODEL_IDS: Record<RepoDocsProvider, string> = {
  google: "gemini-2.0-flash",
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
};

// Env var each provider's key lives in on the server. Note Google's is
// GEMINI_API_KEY (this repo's convention — see worker/.dev.vars.example and
// server.mjs PROVIDER_ENV_VARS), not @ai-sdk/google's default env var name.
const SERVER_KEY_ENV: Record<RepoDocsProvider, string> = {
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

export type RepoDocsApiKeys = Partial<Record<RepoDocsProvider, string>>;

function getModel(provider: RepoDocsProvider, apiKeys?: RepoDocsApiKeys) {
  // A key supplied with the request (browser key manager) wins, matching how
  // the main chat route treats keys; otherwise fall back to the server env.
  const apiKey = apiKeys?.[provider] || process.env[SERVER_KEY_ENV[provider]];
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(MODEL_IDS.anthropic);
    case "openai":
      return createOpenAI({ apiKey })(MODEL_IDS.openai);
    case "google":
    default:
      return createGoogleGenerativeAI({ apiKey })(MODEL_IDS.google);
  }
}

async function answerWithProvider(
  provider: RepoDocsProvider,
  prompt: string,
  apiKeys?: RepoDocsApiKeys
): Promise<RepoDocsAnswer> {
  try {
    const { text } = await generateText({
      model: getModel(provider, apiKeys),
      prompt,
    });
    return { provider, modelId: MODEL_IDS[provider], answer: text };
  } catch (error) {
    return {
      provider,
      modelId: MODEL_IDS[provider],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

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
        modelId: MODEL_IDS[provider],
        error: "No README/AGENTS/CLAUDE files found for the selected repos",
      })),
    };
  }

  const prompt = `You are answering a question using ONLY the project documentation below — do not use outside knowledge about these projects.\n${formatRepoDocsContext(
    docs
  )}\n\nQuestion: ${params.query}`;

  const answers = await Promise.all(
    providers.map((provider) =>
      answerWithProvider(provider, prompt, params.apiKeys)
    )
  );

  return { sourceCount: docs.length, answers };
}

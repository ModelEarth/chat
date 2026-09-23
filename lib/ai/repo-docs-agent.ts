import "server-only";

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { PROVIDER_MAP } from "@/lib/providers";
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

// The model each provider answers with is that provider's default in the
// shared registry (keys/providers.js) — the same list the model picker uses —
// so this can't drift from what the rest of the app runs. The fallbacks only
// apply if the registry has no active model for a provider.
const FALLBACK_MODEL_IDS: Record<RepoDocsProvider, string> = {
  google: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o",
};

// Google has been retiring model versions faster than keys/providers.js gets
// updated — 2.0-flash, then 2.5-flash, were both rejected live with "no
// longer available ... use <newer id>" during testing (2026-09). That's a
// shared-registry staleness issue affecting the whole app's model picker,
// not just this feature, so it's tracked separately rather than patched here
// by editing keys/providers.js. This override is a stopgap: it takes the
// exact id Google's own error message names, and should be removed once the
// registry is updated. It hasn't been confirmed against a real key, only
// against what Google's API reported when the previous id failed — so it's
// tried first but is NOT the only candidate: answerWithProvider() falls back
// through the registry default and FALLBACK_MODEL_IDS if it errors, instead
// of failing every default "From repo docs" request outright.
const GOOGLE_MODEL_OVERRIDE = "gemini-3.6-flash";

function defaultModelId(provider: RepoDocsProvider): string {
  if (provider === "google") return GOOGLE_MODEL_OVERRIDE;
  const models = (PROVIDER_MAP[provider]?.models ?? []).filter((m) => m.active);
  return (
    (models.find((m) => m.isDefault) ?? models[0])?.id ??
    FALLBACK_MODEL_IDS[provider]
  );
}

// Ordered candidate model ids to try for a provider, most-preferred first,
// with duplicates removed. Only "google" has more than one candidate today —
// see the GOOGLE_MODEL_OVERRIDE comment above for why.
function modelIdCandidates(provider: RepoDocsProvider): string[] {
  const registryDefault = (() => {
    const models = (PROVIDER_MAP[provider]?.models ?? []).filter((m) => m.active);
    return (models.find((m) => m.isDefault) ?? models[0])?.id;
  })();

  const candidates =
    provider === "google"
      ? [GOOGLE_MODEL_OVERRIDE, registryDefault, FALLBACK_MODEL_IDS.google]
      : [registryDefault ?? FALLBACK_MODEL_IDS[provider]];

  return [...new Set(candidates.filter((id): id is string => Boolean(id)))];
}

const MODEL_IDS: Record<RepoDocsProvider, string> = {
  google: defaultModelId("google"),
  anthropic: defaultModelId("anthropic"),
  openai: defaultModelId("openai"),
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

function getModel(
  provider: RepoDocsProvider,
  modelId: string,
  apiKeys?: RepoDocsApiKeys
) {
  // A key supplied with the request (browser key manager) wins, matching how
  // the main chat route treats keys; otherwise fall back to the server env.
  const apiKey = apiKeys?.[provider] || process.env[SERVER_KEY_ENV[provider]];
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
    default:
      return createGoogleGenerativeAI({ apiKey })(modelId);
  }
}

async function answerWithProvider(
  provider: RepoDocsProvider,
  prompt: string,
  apiKeys?: RepoDocsApiKeys
): Promise<RepoDocsAnswer> {
  const candidates = modelIdCandidates(provider);
  let lastError: unknown;

  for (const modelId of candidates) {
    try {
      const { text } = await generateText({
        model: getModel(provider, modelId, apiKeys),
        prompt,
      });
      return { provider, modelId, answer: text };
    } catch (error) {
      lastError = error;
    }
  }

  const lastMessage =
    lastError instanceof Error ? lastError.message : "Unknown error";
  return {
    provider,
    modelId: MODEL_IDS[provider],
    error:
      candidates.length > 1
        ? `${lastMessage} (tried: ${candidates.join(", ")})`
        : lastMessage,
  };
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

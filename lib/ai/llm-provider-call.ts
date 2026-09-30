import "server-only";

import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { PROVIDER_MAP } from "@/lib/providers";

/**
 * Generic "call one of our three LLM providers, with the Gemini-retirement
 * fallback chain" logic — originally lived only in repo-docs-agent.ts, now
 * shared with repo-docs-combine's route too, so the fallback chain (and any
 * future model-id fix) only has to be written once.
 */

export type LLMProvider = "google" | "anthropic" | "openai";

export type LLMApiKeys = Partial<Record<LLMProvider, string>>;

export type LLMAnswer = {
  provider: LLMProvider;
  modelId: string;
  answer?: string;
  error?: string;
};

// The model each provider answers with is that provider's default in the
// shared registry (keys/providers.js) — the same list the model picker uses —
// so this can't drift from what the rest of the app runs. The fallbacks only
// apply if the registry has no active model for a provider.
const FALLBACK_MODEL_IDS: Record<LLMProvider, string> = {
  google: "gemini-2.5-flash",
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o",
};

// Google has been retiring model versions faster than keys/providers.js gets
// updated — 2.0-flash, then 2.5-flash, were both rejected live with "no
// longer available ... use <newer id>" during testing (2026-09), each time
// naming a newer id than the last. keys/providers.js's Google default is now
// gemini-3.8-flash (fixed 2026-09-28), so it's trusted first below — but
// given the pace of retirements, these older ids are kept as a fallback
// chain in case the registry goes stale again before anyone notices.
const GOOGLE_RETIRED_MODEL_FALLBACKS = ["gemini-3.6-flash", "gemini-2.5-flash"];

function registryDefaultModelId(provider: LLMProvider): string | undefined {
  const models = (PROVIDER_MAP[provider]?.models ?? []).filter((m) => m.active);
  return (models.find((m) => m.isDefault) ?? models[0])?.id;
}

export function defaultModelId(provider: LLMProvider): string {
  return registryDefaultModelId(provider) ?? FALLBACK_MODEL_IDS[provider];
}

// Ordered candidate model ids to try for a provider, most-preferred first,
// with duplicates removed. Only "google" has more than one candidate today —
// see the comment above for why.
function modelIdCandidates(provider: LLMProvider): string[] {
  const candidates =
    provider === "google"
      ? [registryDefaultModelId("google"), ...GOOGLE_RETIRED_MODEL_FALLBACKS, FALLBACK_MODEL_IDS.google]
      : [registryDefaultModelId(provider) ?? FALLBACK_MODEL_IDS[provider]];

  return [...new Set(candidates.filter((id): id is string => Boolean(id)))];
}

// Env var each provider's key lives in on the server. Note Google's is
// GEMINI_API_KEY (this repo's convention — see worker/.dev.vars.example and
// server.mjs PROVIDER_ENV_VARS), not @ai-sdk/google's default env var name.
const SERVER_KEY_ENV: Record<LLMProvider, string> = {
  google: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function getModel(provider: LLMProvider, modelId: string, apiKeys?: LLMApiKeys) {
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

/**
 * Sends `prompt` to `provider`, trying each candidate model id in order
 * until one succeeds. One provider's failure is returned as its own
 * `error` field, never thrown — callers running several providers in
 * parallel (Promise.all) don't need their own try/catch per call.
 */
export async function callProvider(
  provider: LLMProvider,
  prompt: string,
  apiKeys?: LLMApiKeys
): Promise<LLMAnswer> {
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
    modelId: defaultModelId(provider),
    error:
      candidates.length > 1
        ? `${lastMessage} (tried: ${candidates.join(", ")})`
        : lastMessage,
  };
}

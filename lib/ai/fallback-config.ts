import type { AdminConfigSummary } from "@/lib/types";
import { PROVIDERS } from "@/lib/providers";

// Derived from chat/keys/providers.js (canonical source) at module load time.
// Used when the Supabase admin_config / model_config tables are unreachable so the
// model dropdown and chat route can still operate without DB connectivity.
export const FALLBACK_ADMIN_CONFIG_SUMMARY: AdminConfigSummary = {
  providers: Object.fromEntries(
    PROVIDERS
      .filter((p) => !p.tokenOnly && !p.cliOnly && p.models.length > 0)
      .map((p) => [
        p.id,
        {
          enabled: true,
          fileInputEnabled: false,
          allowedFileTypes: [],
          models: Object.fromEntries(
            p.models
              .filter((m) => m.active !== false)
              .map((m) => [
                m.id,
                {
                  id: m.id,
                  name: m.name,
                  description: m.description || "",
                  pricingPerMillionTokens: { input: 0, output: 0 },
                  enabled: true,
                  isDefault: m.isDefault,
                  supportsThinkingMode: !!m.supportsThinkingMode,
                  fileInputEnabled: false,
                  allowedFileTypes: [],
                },
              ])
          ),
        },
      ])
  ),
};

export const FALLBACK_DB_OFFLINE_STATUS = {
  ok: false as const,
  message: "The model configuration database is unreachable.",
  steps: [
    "Create and add a Supabase key, or have your site admin log in to supabase.com and restore the paused project.",
    "Verify that POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY in your local env file (see automation/paths.yaml) point to the correct project.",
    "Restart the server: kill $(lsof -ti:8888) && node chat/server.mjs",
  ],
};

export const FALLBACK_DB_OFFLINE_STATUS_LOCALHOST = {
  ok: false as const,
  message: "The model configuration database is unreachable.",
  steps: [
    "Create and add a Supabase or Neon database key, or have a teammate provide a test key.",
    "Verify that POSTGRES_URL, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY in your local env file (see automation/paths.yaml) point to the correct project.",
    "Restart the server: kill $(lsof -ti:8888) && node chat/server.mjs",
  ],
};

export const FALLBACK_GOOGLE_CHAT_AGENT_CONFIG = {
  systemPrompt: [
    "You are a helpful AI assistant.",
    "",
    "Response Guidelines:",
    "- Respond concisely.",
    "- Limit responses to 3–5 short paragraphs or bullet points.",
    "- Prioritize key facts over long explanations.",
    "- If the answer is long, summarize the key points first.",
    "- Prefer bullet points for clarity when listing information.",
  ].join("\n"),
  enabled: true,
  availableModels: Object.values(
    FALLBACK_ADMIN_CONFIG_SUMMARY.providers.google.models
  ).map((model) => ({
    id: model.id,
    name: model.name,
    description: model.description,
    enabled: model.enabled,
    isDefault: model.isDefault,
    thinkingEnabled: model.supportsThinkingMode,
    supportsThinkingMode: model.supportsThinkingMode,
    fileInputEnabled: false,
    allowedFileTypes: [] as string[],
  })),
  tools: {},
  rateLimit: { perMinute: 60, perHour: 1000, perDay: 10_000 },
};

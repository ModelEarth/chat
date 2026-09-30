"use client";

import { FileTextIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { CollapsibleAnswer } from "@/components/collapsible-answer";
import { storage } from "@/lib/storage";

/**
 * "Sources selection" feature: shows answers generated
 * ONLY from the selected repos' README / AGENTS / CLAUDE files, stacked above
 * the normal (RAG-informed) chat answer — a few paragraphs visible with a
 * "More details" expand, not side-by-side. One block per selected model, so
 * several LLMs can answer the same question at once. Reuses the Collapsible
 * primitive already used by components/elements/source.tsx and reasoning.tsx.
 *
 * Also has the "Combine these" button — merges the repo-docs
 * answer(s) here and the normal chat answer into one summary on click.
 */

type Provider = "google" | "anthropic" | "openai";

type Answer = {
  provider: string;
  modelId: string;
  answer?: string;
  error?: string;
};

type CombineResult = {
  answer?: string;
  error?: string;
};

const PROVIDER_OPTIONS: { id: Provider; label: string }[] = [
  { id: "google", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI GPT" },
];

// Session-only storage, same pattern as hooks/use-repos.ts's repos-cache:
// a list of multiple files could be saved in the user's browser
// session" — cleared when the tab closes. The repo *selection* itself stays in
// localStorage, unchanged here.
const CACHE_PREFIX = "repo-docs-answer-cache:";
const COMBINE_CACHE_PREFIX = "repo-docs-combine-cache:";
const PROVIDERS_KEY = "repo-docs-providers";

function cacheKey(
  prefix: string,
  query: string,
  selectedRepos: string[],
  providers: Provider[]
): string {
  return `${prefix}${selectedRepos.slice().sort().join(",")}|${providers
    .slice()
    .sort()
    .join(",")}::${query}`;
}

function readJsonCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonCache(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readProviders(): Provider[] {
  try {
    const raw = sessionStorage.getItem(PROVIDERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Provider[]) : null;
    const valid = parsed?.filter((p) => PROVIDER_OPTIONS.some((o) => o.id === p));
    return valid && valid.length > 0 ? valid : ["google"];
  } catch {
    return ["google"];
  }
}

// Mirrors the header convention in components/chat.tsx: plaintext key from the
// session cache when present, otherwise the RSA-encrypted blob the server can
// decrypt. Server env vars are the fallback on the server side.
function keyHeaders(providers: Provider[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const provider of providers) {
    const plain = storage.apiKeys.get(provider);
    if (plain) {
      headers[`x-${provider}-api-key`] = plain;
      continue;
    }
    const enc = storage.apiKeys.getEncryptedBlob(provider);
    if (enc) headers[`x-${provider}-api-key-enc`] = enc;
  }
  return headers;
}

function AnswerBlock({ answer }: { answer: Answer }) {
  const text = answer.answer ?? "";

  return (
    <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileTextIcon className="size-3.5" />
        {answer.provider} ({answer.modelId})
      </div>

      {answer.error ? (
        <p className="text-xs text-destructive">{answer.error}</p>
      ) : (
        // Reuses the same CSS-clip collapsible as the stacked chat answer
        // (components/message.tsx), instead of a second, character-slicing
        // preview/expand implementation of the same feature.
        <CollapsibleAnswer enabled>
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </CollapsibleAnswer>
      )}
    </div>
  );
}

function ModelPicker({
  providers,
  onChange,
}: {
  providers: Provider[];
  onChange: (next: Provider[]) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>Models:</span>
      {PROVIDER_OPTIONS.map((option) => {
        const checked = providers.includes(option.id);
        return (
          <label
            className="flex cursor-pointer items-center gap-1"
            key={option.id}
          >
            <input
              checked={checked}
              className="size-3.5 cursor-pointer accent-primary"
              onChange={() => {
                const next = checked
                  ? providers.filter((p) => p !== option.id)
                  : [...providers, option.id];
                // Always keep at least one model selected.
                if (next.length > 0) onChange(next);
              }}
              type="checkbox"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

export function RepoDocsPanel({
  query,
  selectedRepos,
  chatAnswer,
  chatAnswerReady,
}: {
  query: string;
  selectedRepos: string[];
  /** Text of the latest chat answer, for the "Combine these" button. */
  chatAnswer: string;
  /** False while that answer is still streaming — combining a partial
   *  answer would just be combining a truncated one. */
  chatAnswerReady: boolean;
}) {
  const [providers, setProviders] = useState<Provider[]>(["google"]);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [combineResult, setCombineResult] = useState<CombineResult | null>(null);
  const [combining, setCombining] = useState(false);

  // Read the saved model choice after mount (not during render) so the
  // server-rendered HTML and first client render always match.
  useEffect(() => {
    setProviders(readProviders());
  }, []);

  function updateProviders(next: Provider[]) {
    setProviders(next);
    try {
      sessionStorage.setItem(PROVIDERS_KEY, JSON.stringify(next));
    } catch {}
  }

  useEffect(() => {
    setCombineResult(null);

    if (!query.trim() || selectedRepos.length === 0) {
      setAnswers(null);
      return;
    }

    const key = cacheKey(CACHE_PREFIX, query, selectedRepos, providers);
    const cached = readJsonCache<Answer[]>(key);
    if (cached) {
      setAnswers(cached);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch("/api/repo-docs-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...keyHeaders(providers) },
      body: JSON.stringify({ query, selectedRepos, providers }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        const result: Answer[] | null = data.answers ?? null;
        setAnswers(result);
        // Only cache fully successful results — otherwise a temporary failure
        // (missing key, retired model) would be replayed for the whole session.
        if (result?.every((a) => !a.error)) writeJsonCache(key, result);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("RepoDocsPanel: fetch failed", err);
          setAnswers(null);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
    // Re-runs once per new user question, when the repo list changes, or when
    // the model choice changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedRepos.join(","), providers.join(",")]);

  const successfulAnswers = answers?.filter((a) => !a.error) ?? [];
  // Something worth combining exists once at least one side has real text —
  // matches combineAnswers()'s own "nothing to combine" check server-side.
  const canCombine =
    !combining &&
    chatAnswerReady &&
    (successfulAnswers.length > 0 || chatAnswer.trim().length > 0);

  if (selectedRepos.length === 0 || !query.trim()) return null;

  function handleCombine() {
    const key = cacheKey(COMBINE_CACHE_PREFIX, query, selectedRepos, providers);
    const cached = readJsonCache<CombineResult>(key);
    if (cached) {
      setCombineResult(cached);
      return;
    }

    setCombining(true);
    fetch("/api/repo-docs-combine", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...keyHeaders([...new Set<Provider>(["google", ...providers])]),
      },
      body: JSON.stringify({
        query,
        repoDocsAnswers: successfulAnswers,
        chatAnswer,
      }),
    })
      .then((r) => r.json())
      .then((data: CombineResult) => {
        setCombineResult(data);
        if (!data.error) writeJsonCache(key, data);
      })
      .catch((err) => {
        console.error("RepoDocsPanel: combine failed", err);
        setCombineResult({ error: "Combine request failed" });
      })
      .finally(() => setCombining(false));
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-2 pb-2 md:px-4">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        From repo docs (README / AGENTS / CLAUDE)
      </p>
      <ModelPicker onChange={updateProviders} providers={providers} />
      {loading && !answers ? (
        <p className="text-xs text-muted-foreground">Reading repo docs…</p>
      ) : (
        <div className="flex flex-col gap-2">
          {answers?.map((a) => (
            <AnswerBlock answer={a} key={a.provider} />
          ))}
        </div>
      )}

      {!loading && answers && (
        <div className="mt-2">
          <button
            className="flex items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canCombine}
            onClick={handleCombine}
            title={
              chatAnswerReady
                ? undefined
                : "Wait for the chat answer to finish before combining"
            }
            type="button"
          >
            {combining ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
            Combine these
          </button>

          {combineResult && (
            <div className="mt-2 rounded-md border border-border/40 bg-muted/10 px-3 py-2">
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Combined summary
              </div>
              {combineResult.error ? (
                <p className="text-xs text-destructive">{combineResult.error}</p>
              ) : (
                <CollapsibleAnswer enabled>
                  <p className="whitespace-pre-wrap text-sm">
                    {combineResult.answer}
                  </p>
                </CollapsibleAnswer>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

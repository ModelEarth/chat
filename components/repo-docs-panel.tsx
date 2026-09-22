"use client";

import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils";

/**
 * "Sources selection" feature (per Loren's email): shows answers generated
 * ONLY from the selected repos' README / AGENTS / CLAUDE files, stacked above
 * the normal (RAG-informed) chat answer — a few paragraphs visible with a
 * "More details" expand, not side-by-side. One block per selected model, so
 * several LLMs can answer the same question at once. Reuses the Collapsible
 * primitive already used by components/elements/source.tsx and reasoning.tsx.
 */

type Provider = "google" | "anthropic" | "openai";

type Answer = {
  provider: string;
  modelId: string;
  answer?: string;
  error?: string;
};

const PROVIDER_OPTIONS: { id: Provider; label: string }[] = [
  { id: "google", label: "Google Gemini" },
  { id: "anthropic", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI GPT" },
];

const PREVIEW_CHARS = 500;

// Session-only storage, same pattern as hooks/use-repos.ts's repos-cache:
// per Loren's "a list of multiple files could be saved in the user's browser
// session" — cleared when the tab closes. The repo *selection* itself stays in
// localStorage, unchanged here.
const CACHE_PREFIX = "repo-docs-answer-cache:";
const PROVIDERS_KEY = "repo-docs-providers";

function cacheKey(
  query: string,
  selectedRepos: string[],
  providers: Provider[]
): string {
  return `${CACHE_PREFIX}${selectedRepos.slice().sort().join(",")}|${providers
    .slice()
    .sort()
    .join(",")}::${query}`;
}

function readCache(key: string): Answer[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Answer[]) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, answers: Answer[]) {
  try {
    sessionStorage.setItem(key, JSON.stringify(answers));
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
  const [open, setOpen] = useState(false);
  const text = answer.answer ?? "";
  const isLong = text.length > PREVIEW_CHARS;
  const preview = isLong ? `${text.slice(0, PREVIEW_CHARS)}…` : text;

  return (
    <div className="rounded-md border border-border/40 bg-muted/10 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <FileTextIcon className="size-3.5" />
        {answer.provider} ({answer.modelId})
      </div>

      {answer.error ? (
        <p className="text-xs text-destructive">{answer.error}</p>
      ) : (
        <Collapsible open={open} onOpenChange={setOpen}>
          <p className="whitespace-pre-wrap text-sm">{open ? text : preview}</p>
          {isLong && (
            <CollapsibleTrigger className="mt-1 flex items-center gap-1 text-xs text-primary">
              {open ? "Show less" : "More details"}
              <ChevronDownIcon
                className={cn("size-3 transition-transform", open && "rotate-180")}
              />
            </CollapsibleTrigger>
          )}
          {/* The preview/full-text swap above is driven directly by `open`;
              CollapsibleContent is kept (empty) only so the Trigger stays a
              valid Collapsible child, consistent with the rest of the app. */}
          <CollapsibleContent />
        </Collapsible>
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
}: {
  query: string;
  selectedRepos: string[];
}) {
  const [providers, setProviders] = useState<Provider[]>(["google"]);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (!query.trim() || selectedRepos.length === 0) {
      setAnswers(null);
      return;
    }

    const key = cacheKey(query, selectedRepos, providers);
    const cached = readCache(key);
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
        if (result?.every((a) => !a.error)) writeCache(key, result);
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

  if (selectedRepos.length === 0 || !query.trim()) return null;

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
    </div>
  );
}

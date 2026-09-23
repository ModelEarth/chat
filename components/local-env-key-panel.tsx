"use client";

import { useEffect, useState } from "react";
import { CopyIcon } from "@/components/icons";
import { toast } from "@/components/toast";

// Same local-hostname definition used by chat/auth/js/auth-modal.js's
// isLocal check, so this panel and the social-button styling agree on
// what counts as "local."
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

type EnvValue = { name: string; value: string; isPlaceholder: boolean };

type EnvKeyPanelProps = {
  apiPath: string;
  title: string;
  description: string;
  copyAllLabel: string;
};

export function EnvKeyPanel({ apiPath, title, description, copyAllLabel }: EnvKeyPanelProps) {
  const [isLocal, setIsLocal] = useState(false);
  const [values, setValues] = useState<EnvValue[] | null>(null);

  useEffect(() => {
    setIsLocal(LOCAL_HOSTNAMES.has(window.location.hostname));
  }, []);

  useEffect(() => {
    if (!isLocal) return;
    fetch(apiPath)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setValues(data?.values ?? null))
      .catch(() => setValues(null));
  }, [isLocal, apiPath]);

  if (!isLocal || !values || values.length === 0) return null;

  async function copyValue(entry: EnvValue) {
    try {
      await navigator.clipboard.writeText(entry.value);
      toast({ type: "success", description: `Copied ${entry.name}` });
    } catch {
      toast({ type: "error", description: `Couldn't copy ${entry.name}` });
    }
  }

  async function copyAll() {
    const real = values!.filter((entry) => !entry.isPlaceholder);
    if (real.length === 0) {
      toast({ type: "error", description: "No real keys configured yet — only placeholders" });
      return;
    }
    const blob = real.map((entry) => `${entry.name}=${entry.value}`).join("\n");
    try {
      await navigator.clipboard.writeText(blob);
      toast({ type: "success", description: `Copied ${real.length} ${copyAllLabel}` });
    } catch {
      toast({ type: "error", description: "Couldn't copy keys" });
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-sm">{title}</h4>
        <button
          type="button"
          onClick={copyAll}
          aria-label={`Copy all ${copyAllLabel}`}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted hover:text-foreground transition-colors"
        >
          <CopyIcon size={13} />
          Copy all
        </button>
      </div>
      <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      <ul className="mt-3 flex flex-col gap-1.5">
        {values.map((entry) => (
          <li key={entry.name} className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
            <span className="font-mono text-muted-foreground text-xs">{entry.name}</span>
            {entry.isPlaceholder ? (
              <span className="flex-1 truncate text-right text-muted-foreground text-xs italic">
                not yet configured (placeholder)
              </span>
            ) : (
              <span
                className="flex-1 select-none truncate text-right font-mono text-xs"
                style={{ filter: "blur(4px)" }}
                aria-hidden="true"
              >
                {entry.value}
              </span>
            )}
            <button
              type="button"
              onClick={() => copyValue(entry)}
              disabled={entry.isPlaceholder}
              aria-label={`Copy ${entry.name}`}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-30"
            >
              <CopyIcon size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Lets a developer copy auth secrets out of their local env file (the one
// automation/paths.yaml points at) straight into Vercel's dashboard without
// the value ever being rendered readably on screen. The server route
// (api/auth/local-env-values) refuses to serve
// values off-localhost/off-Vercel-detection regardless of this component
// rendering — this client-side check is a second, redundant guard, not
// the source of truth.
export function LocalEnvKeyPanel() {
  return (
    <EnvKeyPanel
      apiPath="/api/auth/local-env-values"
      title="Copy keys to Vercel"
      description="Local only — values are blurred and never rendered readably. Copy all at once and paste directly into Vercel's Environment Variables box, or copy one key at a time."
      copyAllLabel="keys for Vercel"
    />
  );
}

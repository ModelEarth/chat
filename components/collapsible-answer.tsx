"use client";

import { ChevronDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Clips a long answer to a few paragraphs with a "More details" toggle, so the
 * repo-docs answer and the normal chat answer read as two matching blocks
 * stacked one above the other (per Loren's email), not a wall of text.
 *
 * Clips with CSS max-height rather than slicing the text, so the markdown
 * rendering inside `children` is completely untouched and the full answer is
 * always in the DOM (searchable, copyable).
 *
 * Does nothing unless `enabled` — the caller only enables it when Sources are
 * selected, so ordinary chats behave exactly as before.
 */

const COLLAPSED_PX = 220;

export function CollapsibleAnswer({
  enabled,
  label,
  children,
}: {
  enabled: boolean;
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!enabled || !el) return;
    // Observe the inner (unclipped) element so growth is still detected while
    // the outer wrapper is clamped.
    const measure = () => setOverflowing(el.scrollHeight > COLLAPSED_PX + 24);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  if (!enabled) return <>{children}</>;

  const clipped = overflowing && !open;

  return (
    <div>
      {label && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <div
        className="relative overflow-hidden"
        style={clipped ? { maxHeight: COLLAPSED_PX } : undefined}
      >
        <div ref={contentRef}>{children}</div>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />
        )}
      </div>
      {overflowing && (
        <button
          className="mt-1 flex items-center gap-1 text-xs text-primary"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? "Show less" : "More details"}
          <ChevronDownIcon
            className={cn("size-3 transition-transform", open && "rotate-180")}
          />
        </button>
      )}
    </div>
  );
}

"use client";

import { UnfoldHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A round handle on the sidebar's right edge, level with the bottom-left
// corner, that shows the sidebar can be resized. It drags like the edge
// itself, fades out 3 seconds after the page loads, and reappears while the
// pointer is over it (or the sidebar is being dragged).
const FADE_AFTER_MS = 3000;

export function SidebarResizeHint({
  onPointerDown,
}: {
  onPointerDown: (event: React.PointerEvent) => void;
}): React.JSX.Element {
  const [visible, setVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fadeLater = () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setVisible(false), FADE_AFTER_MS);
  };

  useEffect(() => {
    fadeLater();
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragging) {
      return;
    }
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, [dragging]);

  return (
    <div
      className="absolute right-0 bottom-[32px] z-30 flex h-16 w-12 translate-x-1/2 items-center justify-center"
      onMouseEnter={() => {
        if (timer.current) {
          clearTimeout(timer.current);
        }
        setVisible(true);
      }}
      onMouseLeave={() => {
        if (!dragging) {
          setVisible(false);
        }
      }}
    >
      <button
        aria-label="Drag to resize the sidebar"
        className={cn(
          "flex h-[27px] w-[27px] cursor-grab touch-none active:cursor-grabbing items-center justify-center rounded-full border border-sidebar-border bg-background text-muted-foreground shadow-sm transition-opacity duration-500 hover:text-foreground",
          visible || dragging ? "opacity-100" : "opacity-0"
        )}
        onPointerDown={(event) => {
          setDragging(true);
          onPointerDown(event);
        }}
        title="Drag to resize"
        type="button"
      >
        <UnfoldHorizontal className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import { type ComponentProps, memo, useSyncExternalStore } from "react";
import type { Streamdown as StreamdownType } from "streamdown";
import { cn } from "@/lib/utils";

// Streamdown renders in the browser only. On the server it would bring in
// Shiki's every language and theme (~9 MB). Until it has loaded, the text
// shows as plain text.
let streamdownLoaded = false;
const listeners = new Set<() => void>();
const Streamdown = dynamic(
  () =>
    import("./streamdown-client").then((m) => {
      streamdownLoaded = true;
      for (const listener of listeners) listener();
      return m.Streamdown;
    }),
  { ssr: false }
);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

type ResponseProps = ComponentProps<typeof StreamdownType>;

const responseClassName =
  "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:whitespace-pre-wrap [&_code]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto";

export const Response = memo(
  ({ className, ...props }: ResponseProps) => {
    const loaded = useSyncExternalStore(
      subscribe,
      () => streamdownLoaded,
      () => false
    );
    return (
      <>
        {!loaded && (
          <div className={cn(responseClassName, "whitespace-pre-wrap", className)}>
            {props.children}
          </div>
        )}
        <Streamdown className={cn(responseClassName, className)} {...props} />
      </>
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

Response.displayName = "Response";

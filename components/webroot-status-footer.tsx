"use client";

import { useEffect, useState } from "react";

// Localhost-only dev indicator shown at the bottom of chat-rendered pages.
// Webroot mode (`node chat/server.mjs`) serves the entire webroot via standard
// Node.js (the Next.js dev server, not Cloudflare's workerd), so
// sibling static repos like /localsite/ are reachable and server-side endpoints
// (auth/OAuth API) are live. Chat-repo mode (`pnpm dev`) serves only the chat
// app. We tell them apart with a quick HEAD probe of a static webroot path.
// Client-only + localhost-gated, so it never affects production rendering.
export function WebrootStatusFooter() {
  const [state, setState] = useState<{ port: string; webroot: boolean } | null>(
    null,
  );

  useEffect(() => {
    const host = location.hostname;
    const isLocal =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (!isLocal) return;
    const port = location.port || "";
    fetch("/localsite/js/localsite.js", { method: "HEAD" })
      .then((r) => setState({ port, webroot: r.ok }))
      .catch(() => setState({ port, webroot: false }));
  }, []);

  if (!state) return null;

  const { port, webroot } = state;
  const message = webroot ? (
    <>
      Viewing locally via standard NodeJS (
      <a
        href="https://nodejs.org/learn/getting-started/the-v8-javascript-engine"
        style={{ color: "inherit", pointerEvents: "auto", textDecoration: "underline" }}
      >
        V8
      </a>
      ) on port {port}
    </>
  ) : (
    `Chat app only on port ${port} — static webroot not Node-served`
  );

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        textAlign: "center",
        fontSize: "11px",
        lineHeight: "1.4",
        padding: "3px 8px",
        background: webroot ? "#ecfdf5" : "#fef2f2",
        color: webroot ? "#047857" : "#b91c1c",
        borderTop: `1px solid ${webroot ? "#a7f3d0" : "#fecaca"}`,
        pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}

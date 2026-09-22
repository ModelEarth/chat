"use client";

// /chat/keys — Key Manager page (inside the chat layout/navigation).
//
// Accessible without login — listed as a public route in proxy.ts.
//
// In the webroot, server.mjs serves /keys/* statically (standalone form with
// localsite navigation). /chat/keys falls through to Next.js so it renders
// inside the sidebar layout, giving logged-out users the same key manager form
// embedded in the chat navigation.
//
// On Vercel (or any plain `next start` deployment), server.mjs does not run;
// Next.js routing hits this page for both /keys and /chat/keys.

import Script from "next/script";
import { useEffect, useState } from "react";

export default function KeysPage() {
  const [serverKeys, setServerKeys] = useState<string[]>([]);
  const [browserKeyProviders, setBrowserKeyProviders] = useState<string[]>([]);
  const [hideGeminiStarter, setHideGeminiStarter] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/server-keys")
      .then((r) => r.json())
      .then((keys: string[]) => setServerKeys(keys))
      .catch(() => {});

    try {
      const stored = localStorage.getItem("api-keys");
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, string>;
        setBrowserKeyProviders(
          Object.entries(parsed)
            .filter(([, v]) => v && v.trim().length > 0)
            .map(([k]) => k)
        );
      }
    } catch {}
  }, []);

  useEffect(() => {
    function handleProviderValidation(event: Event) {
      const detail = (event as CustomEvent<{ providerId?: string; valid?: boolean }>).detail;
      if (detail?.providerId === "google" && detail.valid === true) {
        setHideGeminiStarter(true);
      }
    }

    window.addEventListener("keymanager:provider-validation", handleProviderValidation);
    return () => {
      window.removeEventListener("keymanager:provider-validation", handleProviderValidation);
    };
  }, []);

  function initWidget() {
    if (!loaded) return;
    const root = document.getElementById("key-root");
    if (root && (window as any).KeyManager) {
      (window as any).KeyManager.migrateFromLegacy();
      (window as any).KeyManager.init(root);
    }
  }

  useEffect(() => {
    initWidget();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const isVercel = !!process.env.NEXT_PUBLIC_VERCEL_ENV;
  const noServerKeys = serverKeys.length === 0;
  const noKeys = noServerKeys && browserKeyProviders.length === 0 && !hideGeminiStarter;

  return (
    <>
      <div className="key-page">
        <div className="key-page-header">
          <h1>API Key Settings</h1>
          <p>Add your API keys to unlock AI models and Github integration.</p>

          {/* Always mounted, toggled with `hidden`: key-manager.js removes this element
              itself when a Google key validates, so React unmounting it too would
              throw "removeChild: not a child of this node". */}
          <p hidden={!noKeys} id="gemini-starter-copy" style={{ marginTop: "10px", marginBottom: "12px", fontSize: "0.9rem" }}>
              You can start with a{" "}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-600"
              >
                free Google Gemini key
              </a>
              .
            </p>

          {browserKeyProviders.length > 0 && (
            <p
              style={{
                marginTop: "10px",
                padding: "8px 12px",
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#166534",
              }}
            >
              Browser keys active for: {browserKeyProviders.join(", ")}. These
              are saved locally in your browser and used directly from your
              device.
            </p>
          )}

          {isVercel && noServerKeys && (
            <p
              style={{
                marginTop: "10px",
                padding: "8px 12px",
                background: "#fef9c3",
                border: "1px solid #fde047",
                borderRadius: "6px",
                fontSize: "0.85rem",
                color: "#713f12",
              }}
            >
              No server-side API keys detected. Set environment variables (e.g.{" "}
              <code>ANTHROPIC_API_KEY</code>) in your{" "}
              <a
                href="https://vercel.com/docs/projects/environment-variables/managing-environment-variables"
                target="_blank"
                rel="noopener noreferrer"
              >
                Vercel project settings
              </a>{" "}
              to enable the server badge. Browser-saved keys stay encrypted in
              local storage and IndexedDB, so they will not appear as server
              {" "}
              <code>.env</code>
              {" "}
              badges unless the deployed server can read the same provider keys
              from its own environment.
            </p>
          )}
        </div>

        <div id="key-root" />
      </div>

      <Script src="/keys/providers.js" strategy="beforeInteractive" />
      <Script
        src="/keys/key-manager.js"
        strategy="afterInteractive"
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}

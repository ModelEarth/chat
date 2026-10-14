"use client";

import { useEffect, useState } from "react";

// The webroot's site config, the same file localsite reads
// (localsite.js loadWebrootYaml). It isn't there when chat is deployed on
// its own (Vercel), and chat then keeps its built-in title.
const SITE_CONFIG_PATH = "/support/site/config.yaml";

export interface SiteConfigEntry {
  title?: string;
  logo?: string;
  favicon?: string;
  base_url?: string;
  domain_contains?: string;
  [key: string]: string | undefined;
}

interface SiteConfig {
  default: string;
  sites: Record<string, SiteConfigEntry>;
}

// Reads top-level default: and the two-level sites: block, like localsite's
// parseWebrootConfig.
function parseSiteConfig(text: string): SiteConfig {
  const config: SiteConfig = { default: "", sites: {} };
  let scope = "root";
  let currentId: string | null = null;
  for (const raw of text.split("\n")) {
    const trimmed = raw.replace(/^\s+/, "");
    const indent = raw.length - trimmed.length;
    if (!trimmed || trimmed[0] === "#") continue;
    const match = trimmed.match(/^([\w._-]+):\s*(.*)/);
    if (!match) continue;
    const key = match[1];
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (indent === 0) {
      scope = key === "sites" && !value ? "sites" : "root";
      currentId = null;
      if (key === "default") config.default = value;
      continue;
    }
    if (scope === "sites" && indent === 2 && !value) {
      currentId = key;
      config.sites[currentId] = {};
    } else if (scope === "sites" && indent === 4 && currentId) {
      config.sites[currentId][key] = value;
    }
  }
  return config;
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// Matches localsite's order: the modelsite cookie, then domain_contains,
// then default.
function pickSite({ default: defaultId, sites }: SiteConfig): SiteConfigEntry | null {
  const modelsite = readCookie("modelsite");
  if (modelsite && sites[modelsite]) return sites[modelsite];
  for (const site of Object.values(sites)) {
    const domains = (site.domain_contains ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (domains.some((d) => location.href.includes(d))) return site;
  }
  return (defaultId && sites[defaultId]) || null;
}

let sitePromise: Promise<SiteConfigEntry | null> | null = null;

function loadSite(): Promise<SiteConfigEntry | null> {
  sitePromise ??= fetch(SITE_CONFIG_PATH)
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => (text ? pickSite(parseSiteConfig(text)) : null))
    .catch(() => null);
  return sitePromise;
}

// The current site's entry from support/site/config.yaml, or null.
export function useSiteConfig(): SiteConfigEntry | null {
  const [site, setSite] = useState<SiteConfigEntry | null>(null);
  useEffect(() => {
    let active = true;
    loadSite().then((s) => {
      if (active) setSite(s);
    });
    return () => {
      active = false;
    };
  }, []);
  return site;
}

// Puts the site's title at the front of the browser title ("Model Earth - ..."),
// as localsite does, and again whenever Next.js sets a new page title.
export function useSiteTitlePrefix(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    const prefix = `${title} - `;
    const apply = () => {
      if (document.title && !document.title.startsWith(prefix)) {
        document.title = prefix + document.title;
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}

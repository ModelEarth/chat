# Auth Page: Key-Aware Social Buttons, Vercel Key Transfer, Supabase Login

## Goal

Two related additions to the `/auth` sign-in page (`chat/auth/` static assets, mounted at `/chat/auth/...` or `/auth/...` — see `chat/AGENTS.md`):

**Project 1 — Gray out social buttons without a configured key, plus a local key-transfer panel**
- All social login buttons (Google, GitHub, LinkedIn, Microsoft, Discord, Facebook) render grayed out/disabled when that provider's OAuth client id/secret pair isn't configured. Facebook reportedly did this correctly before — treat that as the reference behavior and generalize it to all providers rather than reinventing it.
- Key presence must be readable in both environments without exposing secret values to the client:
  - Localhost: presence is derived from the local env file (see `automation/paths.yaml`)
  - Vercel: presence is derived from the environment variables set in the Vercel project
- Add a **localhost-only** panel (never rendered on Vercel/production) that lists every social-login env var name with its value blurred (CSS blur, not just `type=password` — never revealed by toggle) and a copy-to-clipboard icon per row. Purpose: let the user quickly copy each value out of the local env file and paste it into Vercel's dashboard "Environment Variables" bulk-paste UI. No textarea — just a list of rows (name + blurred value + copy icon).

**Project 2 — Reuse the Supabase username/password login under the social buttons**
- Reuse the existing Supabase `/login`-style email/password fields + sign-in button, adding them to `/auth` beneath the social login buttons.
- If the configured Postgres database is unreachable, show an inline message and gray out the username/password fields (don't let the user submit into a dead backend).
- The database layer must stay swappable — Supabase today, but Neon or any other Postgres-compatible URL should work through the same code path (this app already treats `POSTGRES_URL` as backend-agnostic per `chat/AGENTS.md`'s "Auth backends & no-database mode" section — reachability checks must follow the same generic-Postgres assumption, not hardcode a Supabase-only client).

Do not commit automatically while implementing this plan.

---

## Background (known going in, from `chat/AGENTS.md`)

- Static, no-build sign-in assets live in `chat/auth/` (not `chat/public/auth/`) — served at `/chat/auth/...` from the webroot, or `/auth/...` when chat is deploy root. Files: `auth/js/auth-modal.js`, `auth/js/auth-plugin.js`, `auth/css/auth.css`.
- Auth backend is better-auth: `betterauth/auth.ts` (full, DB-backed), `betterauth/auth-edge.ts` (stateless, no DB, used by edge middleware), `betterauth/client.ts` (React client).
- OAuth provider credential env vars (each provider auto-enables only when **both** are set) — six pairs: `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`, `LINKEDIN_CLIENT_ID`/`SECRET`, `MICROSOFT_CLIENT_ID`/`SECRET`, `DISCORD_CLIENT_ID`/`SECRET`, `FACEBOOK_CLIENT_ID`/`SECRET`.
- `POSTGRES_URL` is optional and backend-agnostic — Supabase is "one supported database, not the only one." No-DB mode already exists (`AUTH_MODE=stateless` / no `POSTGRES_URL`) and degrades gracefully.
- Non-secret settings belong in `docker/webroot.yaml`; secrets (`BETTER_AUTH_SECRET`, OAuth client secrets, `POSTGRES_URL`) belong in the local env file (see `automation/paths.yaml`) / Vercel env vars in production.
- There's a separate, unrelated key system for AI provider keys (browser-encrypted `localStorage['settings_api-keys']`, see `team/key/PLAN.md`) — **not** to be conflated with these server-side OAuth/DB secrets. Project 1's "copy keys to Vercel" panel is about *server* env vars, not browser-stored AI keys.

## Current-code findings (research complete)

**The `/auth` page is a Next.js route, not the legacy static widget:**
- `chat/app/auth/page.tsx` — server component; renders `<SocialLoginButtons />` (line 3, 49) inside `<Suspense>`. Parses `?error=provider_not_configured&provider=X` (lines 5–17) and shows a reactive message — but only *after* a failed sign-in attempt, never proactively.
- `chat/components/social-login-buttons.tsx` — `PROVIDERS` array (lines 6–55) lists **google, github, microsoft, linkedin, discord** — **Facebook is missing entirely**. Button rendering (lines 91–105) is a plain `.map()` with no disabled/grayed state — every button is identically clickable regardless of config.

**The gray-out UX the user remembers already exists, but only in the legacy static widget** (used for embedding auth into non-Next static pages via `showAuthModal()` — a different surface, not the Next.js `/auth` route):
- `chat/auth/js/auth-modal.js:12` — hardcoded `this.unconfiguredProviders = new Set(['facebook'])`.
- `chat/auth/js/auth-modal.js:219-238` — `.auth-btn.inactive` CSS: `opacity:0.5; cursor:not-allowed; background:#F3F4F6; border-style:dashed;` + grayscale filter on the icon.
- `chat/auth/js/auth-modal.js:332-349` (`applyProviderVisibility()`) — **grays out on localhost, fully hides (`display:none`) in production**. Same logic duplicated in `chat/auth/js/auth-plugin.js:38,161-166,196-207`.
- Click on a grayed button shows a blocking `alert()` (`auth-modal.js:410-417`).

**So there was no regression — the React `/auth` page never had this logic; it needs to be added, generalized to all 6 providers (not hardcoded), and driven by real server config instead of a manually-maintained list.**

**Server already computes real per-provider "is configured" booleans — just never exposes them to the client:**
- `chat/lib/auth/instance.ts:99-131` — `socialProviders` config for google/linkedin/github/microsoft/discord/facebook, each `enabled: !!(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET)`. This is the single source of truth to reuse — no new detection logic needed, just pipe it to the client. Since `app/auth/page.tsx` is itself a **server component**, it can read/reuse these booleans directly at render time and pass them as a prop to `SocialLoginButtons` — no new API route needed, and no risk of leaking values since only booleans cross the server/client boundary.
- This also transparently satisfies "localhost reads its local env file, Vercel reads its own env vars" — both just populate `process.env` before this code runs; no environment branching needed for detection itself (only for whether Phase 3's panel renders at all).

**Bug found — `automation/.env.example` doesn't match what the code reads for 2 of the 6 providers:**
- Code (`lib/auth/instance.ts`) reads `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` and `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET`.
- `automation/.env.example` instead defines `DISCORD_BOT_TOKEN` (unrelated purpose) and `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` (wrong names) — lines 109, 142-143.
- `chat/auth/oauth-setup.md:145-171` already documents the *correct* full set including `DISCORD_CLIENT_ID/SECRET` and `FACEBOOK_CLIENT_ID/SECRET` — `.env.example` is just stale relative to both the code and this doc.
- **Practical effect: Facebook (and Discord OAuth, as opposed to the bot-token use) can never actually show as "configured" for a user who only follows `.env.example`.** Worth fixing as part of Phase 1 regardless of the UI work.

**Existing Supabase email/password login to reuse for Project 2:**
- `chat/app/(auth)/login/page.tsx` — the exact page to mirror/reuse:
  - `isSupabaseConfigured` import (line 16) from `chat/lib/db/supabase-client.ts:19` (`!!(supabaseUrl && supabaseAnonKey)`).
  - `dbUnavailable = !isSupabaseConfigured` (line 29); amber warning banner when true (lines 178-185).
  - **Directly reusable gray-out pattern** (line 192): `<div className={dbUnavailable ? "pointer-events-none select-none opacity-40" : ""}>` wrapping the whole form — container-level graying, not per-field.
  - `<AuthForm>` (from `chat/components/auth-form.tsx`) + `<SubmitButton disabled={isSubmitting || loading || dbUnavailable}>` (lines 192-210).
  - Important: despite the Supabase-configured check gating the UI, actual sign-in calls go through **Better Auth** (`lib/auth/hooks.ts` → `lib/auth/client.ts`), not Supabase auth directly — Supabase here is only used as the underlying Postgres reachability signal. This already matches the "swappable Postgres backend" requirement structurally; `isSupabaseConfigured` just needs to become a generic `isDatabaseConfigured`/reachability check so Neon etc. work the same way.
  - `isVercel = !!process.env.NEXT_PUBLIC_VERCEL_URL` (line 18) is already used to vary the setup-instructions copy in the warning banner (local env file vs Vercel env vars) — same pattern Project 1 needs.
  - There's also a related `isDbConfigured` export from `chat/lib/db/queries/base` (imported at `lib/auth/instance.ts:3`) worth checking as a possibly-more-generic existing check before introducing a new one.

**Localhost/dev-only gating pattern to reuse for Phase 3's panel:**
- `chat/components/webroot-status-footer.tsx` — clean reference: checks `location.hostname` against `localhost`/`127.0.0.1`/`::1` inside `useEffect` (lines 17-20), returns nothing if not local — never affects SSR/production output since the check runs client-side after mount.
- `chat/lib/constants.ts:1-2` — `isProductionEnvironment` / `isDevelopmentEnvironment` (`process.env.NODE_ENV`) already used elsewhere (e.g. `components/settings/error-boundary.tsx`) for conditionally showing dev-only detail — a server-safe alternative/complement to the hostname check.
- `chat/auth/js/auth-modal.js:10` / `auth-plugin.js:22` — the exact `isLocal` computation already used for the existing gray-vs-hide split, if we want Phase 3's panel to follow the same "local/dev" definition as Phase 2's button styling.

---

## Progress

| Phase | Status |
|---|---|
| Phase 0 — Fix `automation/.env.example` naming bug | Complete |
| Phase 1 — Server: expose provider-key presence (OAuth + DB) without leaking values | Complete |
| Phase 2 — Client: gray out unconfigured social buttons on `/auth` | Complete |
| Phase 3 — Localhost-only "copy keys to Vercel" panel | Complete (placeholder-filtered, bulk-copy added) |
| Phase 4 — Reuse Supabase-style login form on `/auth` | Complete |
| Phase 5 — DB reachability check + graying username/password fields | Complete |

**Verification:** `tsc --noEmit` clean across the whole app; `biome check` on touched files shows zero new hard errors (only the same class of pre-existing nursery-rule warnings found throughout the repo's 26k-warning baseline). Direct `curl` checks against `/api/auth/local-env-values` confirm both the double-gate (spoofed non-local `Host` header → 404) and correct data (Google/GitHub/LinkedIn/Microsoft/Facebook present after the docker/.env fix, Discord correctly absent since it was never configured) after restarting the dev server to pick up the renamed env vars. **Full visual/browser screenshot verification could not be completed** — Playwright's `chromium_headless_shell` package would not download in this sandboxed environment across 6 attempts (confirmed not a corruption issue: a clean cache + single non-overlapping `chromium` install still couldn't resolve `chromium_headless_shell`, a separate download target). Recommend a manual look at `localhost:3700/auth` before considering this fully done.

---

## Phase 0 — Fix `automation/.env.example` naming bug

Add correct `DISCORD_CLIENT_ID`/`DISCORD_CLIENT_SECRET` and `FACEBOOK_CLIENT_ID`/`FACEBOOK_CLIENT_SECRET` placeholders (matching what `lib/auth/instance.ts` actually reads and what `chat/auth/oauth-setup.md` already documents) to `automation/.env.example`. Leave `DISCORD_BOT_TOKEN` alone (different purpose). Ask the user before touching `docker/.env` itself, per `chat/AGENTS.md`'s env-var-doc policy.

## Phase 1 — Server: pipe existing provider-enabled booleans to `SocialLoginButtons`

`chat/app/auth/page.tsx` is a server component — reuse the `enabled: !!(CLIENT_ID && CLIENT_SECRET)` booleans already computed in `lib/auth/instance.ts:99-131` (import/derive the same values) and pass as a `configuredProviders` prop to `<SocialLoginButtons />`. No new API route needed — only booleans cross the server/client boundary, computed fresh on every request so Vercel env vars and the local env file are both picked up automatically without branching.

## Phase 2 — Client: add Facebook + gray out unconfigured social buttons

`chat/components/social-login-buttons.tsx`:
- Add the missing `facebook` entry to `PROVIDERS`.
- Accept `configuredProviders` prop; render the disabled/grayed state for any provider not in it — mirror `auth-modal.js`'s `.auth-btn.inactive` styling (opacity, dashed border, grayscale icon) rather than inventing new CSS.
- Decide click behavior for a grayed button (see open question below) instead of reusing the legacy `alert()`.
- **Placeholder-aware "configured" check** (`chat/lib/auth/env-placeholder.ts`, shared with Phase 3): `isSocialProviderConfigured` treats a *present but still-placeholder* client id/secret (e.g. `your-google-client-id...`) as **not** configured — presence alone isn't enough. Discovered this mattered when every provider except Discord initially showed as "configured" purely because `docker/.env` had non-empty placeholder text copied from `.env.example`, not real credentials — only Discord (which had no value at all) was correctly grayed. After this fix, all 6 buttons correctly gray out in this environment, since none currently hold real credentials.

## Phase 3 — Localhost-only "copy keys to Vercel" panel

- List every OAuth + DB secret env var name relevant to auth (the six `_CLIENT_ID`/`_CLIENT_SECRET` pairs, `BETTER_AUTH_SECRET`, `POSTGRES_URL`, etc.), each row: name, blurred value (CSS `filter: blur(...)`, never unblurred by hover/click — only the copy icon touches the real value), copy icon.
- Copy icon copies the actual value to clipboard without ever rendering it in the DOM as visible/selectable text.
- Gate rendering using the same local/dev definition as Phase 2 (`chat/auth/js/auth-modal.js`'s `isLocal` hostname check, or `lib/constants.ts`'s `isDevelopmentEnvironment`) — never present in a Vercel/production response.
- Needs a server-only endpoint or server-component prop that returns `{ name, value }` pairs for *this specific panel only*, distinct from Phase 1's booleans-only endpoint — since this one intentionally does carry real values to a local-only client. Must double-gate: refuse to serve values if the request isn't actually local, not just hide via CSS.
- **Placeholder handling (revised):** rows are never hidden just because a value is still placeholder text — the list should stay visible so the user can see what's set vs. missing. Each entry instead carries an `isPlaceholder` flag (via the shared `chat/lib/auth/env-placeholder.ts`): placeholder rows render the value plainly (not blurred, since there's nothing secret to protect) with an "not yet configured (placeholder)" label and a disabled copy button; real rows keep the blur + working copy icon. "Copy all" only bundles real (non-placeholder) values into the Vercel-format blob.
- **Bulk copy:** a "Copy all" button next to the panel heading copies every listed (non-placeholder) key as `KEY=VALUE` lines — the exact format Vercel's Environment Variables bulk-paste box accepts in one paste — in addition to the existing per-row copy icons.

## Phase 4 — Reuse Supabase-style login form on `/auth`

Import `AuthForm` (`chat/components/auth-form.tsx`) and the `dbUnavailable` / `pointer-events-none select-none opacity-40` pattern directly from `chat/app/(auth)/login/page.tsx`, rendering it beneath `SocialLoginButtons` on `/auth`. Reuses the same Better Auth sign-in call path already used by `/login` — this is composition, not a rewrite.

## Phase 5 — Generalize DB reachability beyond Supabase

Replace (or wrap) `isSupabaseConfigured` with a generic reachability check that works against any `POSTGRES_URL` (Supabase, Neon, ...), reusing whatever `isDbConfigured` (`chat/lib/db/queries/base`) already provides if it's already generic — confirm before adding a new check. Feeds the same gray-out class used in Phase 4.

---

## Decisions

1. **Panel location (Phase 3):** on `/auth` itself, below the login forms, rendered only when localhost is detected.
2. **Grayed-button click behavior (Phase 2):** fully disabled, no click handler — no inline message, no `alert()`.
3. **`automation/.env.example` fix (Phase 0):** proceeding — it's an additive placeholder fix, not a change to real secrets.
4. **`isDbConfigured` (`chat/lib/db/queries/base.ts:7`)** — confirmed already generic: `!!process.env.POSTGRES_URL`, works for Supabase/Neon/any Postgres URL. It's presence, not reachability, though — Phase 5 still needs an actual connectivity check (e.g. a cheap `SELECT 1`), reusing the existing `db`/`getDb()` export at lines 19-24 rather than a Supabase-specific client.

---

## File Summary (final)

| File | Action |
|---|---|
| `automation/.env.example` | Added correct `DISCORD_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET` placeholders |
| `docker/.env` | Renamed `FACEBOOK_APP_ID`→`FACEBOOK_CLIENT_ID`, `FACEBOOK_APP_SECRET`→`FACEBOOK_CLIENT_SECRET`, preserving existing values (user-confirmed) |
| `chat/lib/auth/social-providers.ts` | **New** — leaf module, single source of truth for the 6 provider env-var-name pairs + `isSocialProviderConfigured`/`getConfiguredSocialProviders`; configured check now also rejects placeholder-valued credentials |
| `chat/lib/auth/env-placeholder.ts` | **New** — shared `isPlaceholderValue(varName, value)`, used by both the button-graying check and the copy panel so they agree on what counts as "not really set" |
| `chat/lib/auth/instance.ts` | Refactored `socialProviders.*.enabled` to call `isSocialProviderConfigured` instead of duplicating `!!(...)` checks |
| `chat/app/auth/page.tsx` | Computes `configuredProviders` (Phase 1) and `dbUnavailable`/message (Phase 5) server-side; renders `SocialLoginButtons`, `EmailPasswordSignIn` (with `showDivider`), and `LocalEnvKeyPanel` |
| `chat/components/social-login-buttons.tsx` | Added Facebook to `PROVIDERS`; added `configuredProviders` prop driving disabled/grayed rendering (opacity, dashed border, grayscale icon, no click handler) |
| `chat/components/email-password-signin.tsx` | **New**, later revised — email/password sign-in form extracted from `/login`'s inline logic, reused by `/login` and `/auth`; now takes `dbStatus`/`isVercel`/`showDivider` props (revised from the original `dbUnavailable`/`dbUnavailableMessage` pair — see below) |
| `chat/app/(auth)/login/page.tsx` | Refactored to delegate the form portion to `EmailPasswordSignIn`; later revised again to use `useDbStatus()` instead of the stale `isSupabaseConfigured` check (see below) |
| `chat/lib/db/queries/base.ts` | Added `isDbReachable()` — generic `select 1` connectivity check against the existing `postgres` client, works for any `POSTGRES_URL` backend |
| `chat/components/local-env-key-panel.tsx` | **New** — client component, localhost-gated, fetches and renders env values; placeholder rows show plainly with a label and disabled copy, real rows stay blurred with working copy; "Copy all" bundles only real values in Vercel's `KEY=VALUE` bulk-paste format |
| `chat/app/api/auth/local-env-values/route.ts` | **New** — double-gated (local hostname AND not-Vercel) endpoint; returns all set vars (real or placeholder) with an `isPlaceholder` flag rather than filtering placeholders out |

---

## Related fix — stuck loading spinner on browser back/forward (app-wide, not just `/auth`)

**Symptom:** navigating via the browser's back/forward buttons between `/auth`, `/login`, and `/chat/keys/` (a static, non-Next.js page) left `/auth` and `/login` stuck showing a loading spinner instead of content. Previously reported on other Next.js pages in this repo too, with no fix found.

**Root cause:** `chat/lib/auth/context.tsx`'s `loading` state is better-auth's own `isPending` from `authClient.useSession()`. better-auth's client already has a refetch-on-focus mechanism (`node_modules/better-auth`'s `focus-manager.mjs` + `session-refresh.mjs`), but it only listens to `document.visibilitychange` and rate-limits refetches to once per 5 seconds. The browser's **back-forward cache (bfcache)** freezes a page's entire JS state — including a session fetch already in flight — when navigating away to a different document (crossing from a Next.js page to the static `/chat/keys/` page is a real document boundary, unlike Next.js's own client-side link transitions). On restore via back/forward, better-auth's rate limit can silently swallow the refetch that would otherwise unstick `isPending`, leaving it `true` forever.

Confirmed via: `curl` timing showed every relevant server endpoint (page HTML, `/api/auth/get-session`) responding in well under 100ms, ruling out a backend hang — pointing at client-side state instead. Traced `useSession()` to better-auth's `focus-manager.mjs` (confirmed `visibilitychange`-only) and `session-refresh.mjs` (confirmed the 5s rate limit), and confirmed `useSession()` exposes a public `refetch()` in its type definitions.

**Fix (`chat/lib/auth/context.tsx`):** added a `pageshow` event listener — the event browsers fire specifically to signal bfcache restoration (`event.persisted === true`) — that calls the session's `refetch()` unconditionally, bypassing better-auth's internal rate limit for this specific case. `AuthProvider` is mounted once in the root layout (`chat/app/layout.tsx`), so this listener is registered once and persists across all page navigations app-wide, not just on `/auth`/`/login`.

**Verification:** `tsc --noEmit` and `biome check` clean; confirmed via `curl` that all three pages (`/auth`, `/login`, `/chat/keys/`) still respond correctly after the change. **Could not visually confirm the fix in a real browser** — reproducing genuine back-forward-cache behavior requires actual browser navigation history, and Playwright's headless-shell browser could not be installed in this sandboxed environment after repeated attempts (network/lockfile issues, not a code problem). The root cause and fix are based on tracing the actual better-auth library source rather than guesswork, but a manual check in a real browser (Chrome/Safari/Firefox, navigating `/auth` → `/chat/keys/` → back) is recommended to confirm before considering this closed.

---

## Follow-up — shared `DbStatus` concept, distinguishing "not configured" from "Supabase paused" (`/auth`, `/login`, `/register`)

The original binary `dbUnavailable`/`dbUnavailableMessage` pair only supported one message. Requested: distinguish "nothing set up yet" from "configured but Supabase's free tier auto-paused it (happens after ~14 days of inactivity)" with different messages and fix-it links, and bring `/register` (never refactored, still had its own stale `isSupabaseConfigured`-based banner predating the `/login` extraction) onto the same process.

**New shared model — `DbStatus = "ok" | "not-configured" | "unreachable"`:**
- `chat/lib/auth/db-status.ts` (server-only) — `getDbStatus()`. Treats a `POSTGRES_URL` that's still the unfilled `.env.example` placeholder as `"not-configured"` (reusing `isPlaceholderValue` from `env-placeholder.ts`) rather than attempting — and hanging on — a real connection to a fake host; only genuinely-set-but-down URLs reach the real `isDbReachable()` check and report `"unreachable"`.
- `chat/components/db-status-banner.tsx` (client) — `DbStatusBanner` + exported `getDbStatusMessage()`. Single place for both message text and which fix-it link to show: `"not-configured"` → "To activate sign up, add POSTGRES_URL to your local env file (see automation/paths.yaml)." (or the Vercel variant) linking to `DEPLOYMENT_GUIDE.md`'s Supabase setup steps; `"unreachable"` → "Can't reach the database. If you're on Supabase's free tier, projects pause after about 14 days of inactivity — restart it from your Supabase dashboard." linking to `supabase.com/dashboard/projects`.
- `chat/app/api/auth/db-status/route.ts` — booleans-equivalent, no secret exposure, no gating needed (unlike `local-env-values`).
- `chat/lib/auth/use-db-status.ts` — client hook wrapping the API fetch, for `/login` and `/register` (both `"use client"` pages that can't call the server-only `getDbStatus()` directly). Defaults to `"ok"` while loading to avoid a false-positive flash.
- `chat/app/auth/page.tsx` — already a server component, calls `getDbStatus()` directly, no API round-trip needed.
- `chat/app/(auth)/login/page.tsx` — now uses `useDbStatus()` instead of `isSupabaseConfigured`, which was checking `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` (an unrelated pair from `POSTGRES_URL`, the thing that actually backs better-auth's session storage) — this was a pre-existing inconsistency, now fixed as a side effect of the shared prop signature.
- `chat/app/(auth)/register/page.tsx` — same fix; replaced its old inline Supabase-presence banner with `useDbStatus()` + `<DbStatusBanner>`.

**Verification:** `tsc --noEmit` and `biome check` clean across all touched files (zero new hard errors). Live-tested `/api/auth/db-status` end to end: correctly reports `"not-configured"` for this environment's placeholder `POSTGRES_URL` (and does so instantly — the placeholder check short-circuits before ever attempting the real, slow connection to the fake host). All three pages (`/auth`, `/login`, `/register`) smoke-tested at HTTP 200. Not visually confirmed in a real browser (same Playwright limitation noted above).

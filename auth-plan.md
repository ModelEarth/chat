# Extracting Auth into Its Own Repo

## Goal

Move the auth system out of `chat` into a standalone `auth` repo that can be:
1. Reused by `chat` (still the primary consumer today).
2. Reused by **other webroots** that don't have `chat` at all.
3. Reused by **sites within this webroot** that have neither `chat` nor their own Next.js app (e.g. `team`, `localsite`-based static pages).

This is a planning/notes doc, written before `/compact`, to capture what this session already learned about Vercel + this webroot's structure that's directly relevant, plus open questions to resolve before starting the actual extraction. Nothing here has been implemented.

---

## What currently exists (accurate as of this session)

**Server-side (Next.js, only runs inside `chat`):**
- `betterauth/auth.ts` — full better-auth instance, DB-backed via Drizzle when `POSTGRES_URL` is set; stateless-JWE mode when it isn't.
- `betterauth/auth-edge.ts` — DB-less instance for edge middleware (session validation only).
- `betterauth/client.ts` / `lib/auth/client.ts` — `better-auth/react` client wrapper.
- `lib/auth/context.tsx`, `lib/auth/hooks.ts` — React context/provider (`AuthProvider`, mounted once in `app/layout.tsx`) and hooks (`useAuth`, `useRequireAuth`, `useRequireAdmin`).
- `lib/auth/social-providers.ts`, `lib/auth/env-placeholder.ts`, `lib/auth/db-status.ts`, `lib/auth/use-db-status.ts` — built this session; single-source-of-truth helpers for "is provider X configured" and "is the DB reachable/configured/placeholder," shared between server components and client pages via a small API route (`app/api/auth/db-status`) for the client-only pages.
- `app/api/auth/[...all]/route.ts` — mounts better-auth's own handler.
- `app/api/oauth/[provider]/route.ts`, `app/api/oauth/relay/route.ts` — the **navigation-based OAuth proxy**. This exists specifically to avoid a real bug class: a cross-origin `fetch()` response can't reliably write a first-party session/state cookie in Incognito Chrome or Firefox (Total Cookie Protection blocks it). The fix already in place: OAuth init is a **top-level navigation** to `/api/oauth/:provider` on the chat origin (not a fetch), so better-auth writes the `state` cookie first-party; the callback lands on `/api/oauth/relay`, which reads the session server-side and hands identity to the page via a URL hash fragment (unsigned — cosmetic only, not a security boundary).
- UI pages: `app/auth/page.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`, shared `components/email-password-signin.tsx`, `components/social-login-buttons.tsx`, `components/db-status-banner.tsx`.

**Static, no-build widgets (usable by any plain HTML page, not just `chat`):**
- `chat/auth/js/auth-modal.js`, `auth-plugin.js`, `auth/css/auth.css` — vanilla JS sign-in modal + inline account-panel plugin. Already designed to be consumed by pages with **no build step and no framework** — same philosophy as `chat/keys/key-manager.js` and the prebuilt-bundle pattern in `chat/packages/github-components/` (a Vite IIFE bundle **committed to git**, so `git pull` alone gives a working artifact, no build required to consume it).
- Dispatch layer: `localsite/js/localsite.js`'s `showAuthModal()` — every non-React site in the webroot calls this one function; it contains **no auth logic itself**, it just resolves *where* the modal lives and loads it. Resolution order: `window.webrootAuth` → the `auth:` block in `docker/webroot.yaml` (fetched at runtime) → hardcoded fallback path.

**The existing indirection layer — `docker/webroot.yaml`:**
```yaml
auth:
  enabled: true
  source_repo: "chat"
  modal_url_development: "/chat/auth/js/auth-modal.js"
  modal_url_production: "https://modelearth.vercel.app/auth/js/auth-modal.js"
  plugin_url_development: "/chat/auth/js/auth-plugin.js"
  plugin_url_production: "https://modelearth.vercel.app/auth/js/auth-plugin.js"
  api_url_development: "http://localhost:3700/api"
  api_url_production: "https://modelearth.vercel.app/api"
```
This was **already built with exactly this migration in mind** — the comment in `chat/AGENTS.md` says outright: *"This indirection lets the auth source be repointed to a different repo later without editing any site code."* So the static-widget half of this move is largely a **config change** (`source_repo: "chat"` → `source_repo: "auth"`, update the four URLs) once the files physically live somewhere else — not a from-scratch design problem.

---

## The hard part: this isn't just "move files" — it's a real architectural fork

There are two genuinely different shapes this could take, and they have very different cookie/security implications given what the OAuth-proxy design above already had to solve:

### Option A — `auth` as embeddable *source*, built into each consumer's own Next.js app
Each site that wants full login (not just the static modal) has its own Next.js app, and that app imports `auth`'s source (betterauth instance factory, the `/api/auth/*` and `/api/oauth/*` route handlers, the UI components) and **builds them into its own deployment**, on its own domain. `chat` becomes the first of potentially several such consumers.

- **Cookies stay first-party** for every consumer, because the API routes run on each consumer's own origin. This preserves the exact property the OAuth-proxy redesign fought hard to get.
- Downside: only helps sites that *have* their own Next.js app. A bare static site (no Next.js, no build step) still can't run `/api/auth/*` itself.

### Option B — `auth` as one centrally-hosted service, called remotely by everyone
A single deployed `auth` instance (its own Vercel project/domain) that every site — chat included — calls into remotely.

- Much simpler mental model, one deployment to manage.
- **Reintroduces the exact cross-origin cookie problem** the current OAuth-proxy design exists to avoid, for every consumer, not just the ones without their own Next.js app. This would need the same top-level-navigation + relay pattern replicated (or centralized) for each caller, and the existing "Known gaps" section in `chat/AGENTS.md` already flags the relevant piece as unfinished: *"auth-modal.js still falls back to a cross-origin `fetch('/auth/get-session')`, which is blocked in incognito/Firefox on refresh. Stateless mode should instead hand the page a **signed token**... sent as `Authorization: Bearer …`."* That bearer-token relay is exactly the mechanism Option B would need to be solid, and it isn't built yet.

**Likely answer: both, for different consumers.** Sites with their own Next.js app (chat, and future Next.js sites) use Option A — build `auth`'s routes into their own app. Bare static sites with no Next.js of their own (team, localsite pages) have no choice but Option B — they must call *someone's* remotely-hosted instance (today that's chat's deployment; after the split it could be a dedicated minimal `auth`-only Vercel deployment). The unsigned `#auth_user=` hash trick is fine for cosmetic identity display in that remote case, but any privileged action still needs the signed-bearer-token piece that's currently just a documented gap, not working code.

---

## Vercel-specific constraints learned this session that bear directly on this

- **Root Directory determines what a build can see.** Per Vercel's own docs (confirmed by web search this session): "when selecting the Root Directory, all code above that directory is excluded" from the build, unless "Include source files outside of the Root Directory in the Build Step" is explicitly enabled in Project Settings.
- `chat`'s current default Vercel deploy (**Mode A**) sets Root Directory = `chat`. If `auth` becomes a **sibling submodule at the webroot level** (like `team`, `localsite`, `chat` itself are today), a Mode-A build **cannot see it** without that toggle.
- `chat`'s alternative deploy (**Mode B**, Root Directory blank, root `vercel.json` with `installCommand`/`buildCommand` pointed at `chat/`) *can* see sibling repos on disk during the build, since the whole webroot tree checks out — but this mode isn't the current default and has its own package-manager-resolution wrinkle we already found and fixed once this session (Vercel's corepack pnpm-version pinning only auto-activates from a `package.json` at the actual Root Directory).
- **Package-manager auto-detection is root-directory-scoped**, same mechanism — another reason a nested-inside-`chat` submodule is easier to keep working across both deploy modes than a sibling one.

**Net implication for "submodule of a submodule?":** nesting `auth` as a submodule *inside* `chat` (rather than as a sibling of `chat` at the webroot level) is the path of least resistance for Vercel Mode A specifically, since it stays inside the current Root Directory with no extra project-setting toggle required. This does **not** block other webroots from reusing `auth` independently — a git submodule is just a reference to an independently-addressable repo URL, so any other webroot can add the *same* upstream `auth` repo as its own top-level submodule at whatever path it wants, entirely decoupled from how `chat` happens to nest it. The "nested vs. sibling" choice is really only a `chat`-Vercel-deployment convenience question, not a reusability constraint.

Caveat: this is reasoning from the docs and this session's earlier findings, not from an actual test deploy of a nested-submodule `chat` build on Vercel. Should be verified before committing to it.

---

## Naming/path collision to resolve

`chat/auth/` already exists today as a **plain, non-submodule directory** tracked directly in `chat`'s own git history (the static widget files). If the new `auth` repo is nested inside `chat` and also wants that path, something has to give — either:
- Migrate the static widget files' *content* into the new `auth` repo, and replace `chat/auth/` with a git submodule pointing at it (clean, but is a real migration with a git-history/deploy cutover moment), or
- Nest the new submodule at a different path (e.g. `chat/vendor/auth/` or similar) and leave `chat/auth/` as-is or gradually deprecate it.

---

## Open questions / areas to explore further

1. **Confirm the Root-Directory/submodule-visibility reasoning above with an actual test deploy** — create a throwaway nested submodule and a sibling submodule, try both Mode A and Mode B, see what actually breaks vs. what the docs imply.
2. **Decide the packaging mechanism**: git submodule (path-based import, what's used everywhere else in this webroot) vs. a published npm package (even a private/scoped one) vs. git subtree. A published package sidesteps the whole Vercel-visibility question entirely (it's just a `node_modules` dependency resolved by the package manager) at the cost of needing a real publish/versioning workflow instead of "edit and commit."
3. **Where exactly is the API-route boundary?** Does `auth` export importable route-handler *functions* that each consumer's `app/api/auth/[...all]/route.ts` re-exports (thin wrapper, logic lives in `auth`), or does `auth` ship whole route files meant to be copied/symlinked in? The former is more like a real library; the latter is closer to a template.
4. **Do the UI pages (`/auth`, `/login`, `/register`) move too, or stay per-consumer?** They're fairly app-specific today (e.g. `/auth` renders the localhost-only key-copy panel, which is very chat-specific). Likely only the *form components* (`EmailPasswordSignIn`, `SocialLoginButtons`, `DbStatusBanner`) and the underlying hooks/context move; the page shells stay in each consuming app.
5. **Shared database or per-site database?** If multiple independently-deployed sites each build `auth`'s routes into their own app, do they point at the *same* Postgres instance (shared user accounts/sessions across sites) or does each site get its own DB (separate accounts per site, `auth` is just shared *code*, not a shared *service*)? This is a product decision as much as a technical one, and changes what `BETTER_AUTH_SECRET`/`ALLOWED_ORIGINS`/session-cookie scoping needs to look like across sites.
6. **Finish the bearer-token relay** (the documented-but-unbuilt gap from `chat/AGENTS.md`) before leaning on Option B for any real (non-cosmetic) privileged action from a bare static site. Right now only the unsigned display-name hash works cross-origin; nothing privileged does.
7. **Migration sequencing for the `chat/auth/` path collision** (above) — pick one of the two resolutions before starting, since it affects git history and the `docker/webroot.yaml` cutover moment together.
8. **Env var story across repos**: the local env file (see `automation/paths.yaml`) currently holds one set of OAuth credentials for one better-auth instance. Once `auth`'s routes get built into multiple independent apps/deployments, each needs its own `BETTER_AUTH_SECRET` (never shared) and its own `ALLOWED_ORIGINS`, but *could* reasonably share the same OAuth app client ID/secret (Google/GitHub/etc. client registrations aren't inherently per-deployment) if using Option A with a shared DB. Worth a clear "what's shared vs. what's per-deployment" table once the shared-DB question (#5) is settled.

---

## Recommendation (tentative, not yet validated)

Start with **Option A only** (embeddable source, built into each Next.js consumer) for `chat` and any future Next.js sites, nested as a submodule *inside* `chat` at a path that doesn't collide with today's `chat/auth/` static folder. Defer Option B (a remotely-hosted instance for bare static sites) until the bearer-token relay is actually built — until then, bare static sites keep working exactly as they do today (pointed at chat's deployment via `webroot.yaml`), just with `source_repo` eventually repointed once the static widget files themselves move into the new repo.

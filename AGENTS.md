# AGENTS.md — `chat` repo

Guidance for Claude Code and other AI CLI agents working in this repository.

---

## Role in the Webroot

This repo is a **Next.js AI chat application** and the source of truth for:
- API key storage and management UI (canonical store: `localStorage['settings_api-keys']`)
- Provider and model registry (`lib/providers.ts` + `chat/keys/providers.js`)
- The embeddable key manager widget (`chat/keys/key-manager.js`)

It lives inside the webroot container at `webroot/chat/` alongside static-file repos (`team/`, `requests/`, `localsite/`, etc.) which are served at `localhost:8887` by a Python HTTP server. **This repo is NOT served by that Python server** — it requires its own Next.js process.

---

## Start Commands

When the user says **`start chat`**, first **ask the localhost user which mode to start in — webroot or the chat repo** (do not auto-start; the choice changes the port and what gets served):

| Mode | Command (run from the webroot root) | Port | Serves |
|---|---|---|---|
| **webroot** | `nohup node chat/server.mjs > /tmp/chat-dev.log 2>&1 &` | **3700** | chat app **+** sibling static repos (`/localsite/`, `/team/`, `/chat/auth/`, …) **+** mounted `/sanity` |
| **webroot + turbopack** | `nohup TURBOPACK=1 node chat/server.mjs > /tmp/chat-dev.log 2>&1 &` | **3700** | same as webroot but with Turbopack HMR (may spike CPU/file handles on large webroot trees) |
| **chat repo** | `nohup pnpm --prefix chat dev > /tmp/chat-dev.log 2>&1 &` | **3700** | chat app only (Turbopack HMR, no static repos) |

In **both** modes the chat app sits at the **server root** — there is no `/chat` repo prefix. `server.mjs` does not mount the chat repo under `/chat`; `/chat` is the chat-list route, `/chat/keys` and `/chat/auth` are static handlers, and the API is at `/api/...`.

```bash
# Check the chosen port isn't already in use first:
lsof -ti:3700        # both modes use port 3700

# First run only: pnpm --prefix chat install   (+ bun --cwd sanity install for webroot mode)
# Then start with the command for the chosen mode above, and confirm it's up:
sleep 4 && cat /tmp/chat-dev.log
```

Then report the URLs from the log output.

### Workflow repo detection

If `workflow/comfyui-deploy/web/package.json` exists AND `CLERK_SECRET_KEY` is set in
the local env file (the one `automation/paths.yaml` points at), also start the ComfyUI
Deploy dashboard on port 3001 as part of `start chat`.
Requires both `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — get them free
at https://dashboard.clerk.com. Without them the Next.js middleware crashes on startup.

```bash
# Install dependencies first time (if node_modules absent):
[ ! -d workflow/comfyui-deploy/web/node_modules ] && \
  pnpm --prefix workflow/comfyui-deploy/web install

# Resolve the local env file via automation/paths.yaml (see automation/README.md):
ENV_FILE_REL="$(grep -E '^env_file:' automation/paths.yaml 2>/dev/null | tail -n1 | cut -d':' -f2- | sed -e 's/[[:space:]]#.*$//' | xargs)"
ENV_FILE="automation/${ENV_FILE_REL}"

# Only start if a env_file: is configured and its Clerk key is set (source it so Clerk vars are in scope):
[ -n "$ENV_FILE_REL" ] && grep -q "CLERK_SECRET_KEY=sk_" "$ENV_FILE" 2>/dev/null && \
  { lsof -ti:3001 > /dev/null 2>&1 || \
    nohup bash -c "set -a; source \"$ENV_FILE\"; set +a; PORT=3001 pnpm --prefix workflow/comfyui-deploy/web dev" \
      > /tmp/comfydeploy-dev.log 2>&1 &; }
```

URL: http://localhost:3001 — ComfyUI Deploy dashboard (requires Clerk keys).

---

## Running from the Webroot

### Unified server (recommended for webroot development)

`chat/server.mjs` is a custom Node.js server that boots the chat Next.js app, prepares a chat-owned runtime copy of the `sanity/` submodule, starts that mounted Sanity Next.js site, and serves sibling webroot static repos from a single port — no separate Python server needed.

```bash
# 1. Install dependencies (first time only, or after pulling new commits)
pnpm --prefix chat install
bun --cwd sanity install

# 2. Start the unified server from the webroot root:
node chat/server.mjs               # → http://localhost:3700 (webpack, default)
TURBOPACK=1 node chat/server.mjs   # → same port with Turbopack HMR
PORT=8887 node chat/server.mjs     # → replaces the Python server

# Or via pnpm:
pnpm --prefix chat dev:webroot
```

The server loads the local env file — the one `automation/paths.yaml`'s `env_file:` key points at, resolved from the webroot root — automatically before booting Next.js. See "Environment Variables" below.
When `sanity/` is present, it prepares a derived runtime copy outside the submodule, starts the Sanity Next.js dev server on an internal port, and mounts it at `/sanity` on the same public host.

#### URL layout on the unified server

The **chat app occupies the root** — no path prefix:

| URL | Serves |
|---|---|
| `localhost:3700/` | chat home |
| `localhost:3700/chat` | chat list / new chat |
| `localhost:3700/chat/[id]` | a conversation |
| `localhost:3700/settings` | settings |
| `localhost:3700/chat/keys/` | standalone key manager widget |
| `localhost:3700/sanity/` | Sanity frontend |
| `localhost:3700/sanity/admin` | Sanity Studio |
| `localhost:3700/localsite/…` | `localsite/` static files |
| `localhost:3700/team/…` | `team/` static files |
| `localhost:3700/requests/…` | `requests/` static files |
| `localhost:3001/` | ComfyUI Deploy dashboard (when `workflow/` present) |

Static repo paths (`/localsite/`, `/team/`, `/requests/`, `/realitystream/`, `/data-pipeline/`, `/home/`) are served directly from the filesystem before Next.js sees the request. `/sanity/*` is proxied to the Sanity Next.js app, and everything else goes to chat Next.js.

#### Why port 3700?

3700 is the chat server default in **both** modes (`node chat/server.mjs` and `pnpm --prefix chat dev`), so `api_url_development` is a single constant. The mounted Sanity dev server uses **3701** internally (`SANITY_PORT`). Port 8887 is the existing Python static server; set `PORT=8887 node chat/server.mjs` to replace it entirely. 3700/3701 were chosen to avoid collisions with the common 3000/8080 dev ports and the local 8887/8888 servers.

### Chat-only development

For working exclusively on the Next.js app with Turbopack HMR:

```bash
cd chat && pnpm dev    # port 3700, Turbopack, no static repo serving
```

`lib/env-loader.ts` finds the local env file by resolving `automation/paths.yaml` at `../automation/paths.yaml` relative to `chat/`. No separate `.env` file inside `chat/` is needed.

### Auth backends & no-database mode

The database is an **optional** auth backend, not a requirement. There are two ways to run auth, selectable by configuration:

| Mode | Backend | What works | When |
|---|---|---|---|
| **Database-backed** | Supabase (or any Postgres / other Drizzle-supported DB) | Full set: OAuth + email/password, persisted users/sessions/accounts, chat history, admin roles, model config | A `POSTGRES_URL` is configured |
| **Stateless / OAuth-only** | None — sessions live entirely in a signed JWE cookie/token | OAuth sign-in and session validation with **no DB roundtrip**; identity available to the UI | No DB configured, or `AUTH_MODE=stateless` |

Supabase is **one** supported database, not the only one — any Postgres-compatible URL works, and other backends can be added through the Drizzle adapter. Running a **local** Supabase instance is never required; a hosted Postgres URL works directly.

In **stateless / OAuth-only** mode the app no longer bypasses auth. Sessions are validated from the JWE session cookie using `BETTER_AUTH_SECRET` (see `betterauth/auth-edge.ts`), so login works without a database. DB-only features (chat history, saved messages, admin config) degrade gracefully — the key manager, settings UI, OAuth identity, and client-side features all work.

> Legacy behaviour (now superseded): older builds *bypassed* the auth middleware entirely when Supabase env vars were absent. We are replacing that "no auth without a DB" assumption with real stateless auth. If you find code or docs still asserting "auth is skipped when Supabase is missing," treat it as out of date.

### `pnpm build` and migrations

`pnpm build` runs DB migrations before building (`tsx lib/db/migrate && next build`). `pnpm dev` and `dev:webroot` do **not** run migrations. To apply migrations manually: `pnpm db:migrate`.

---

## Development Commands

```bash
pnpm dev          # Start dev server with Turbopack (preferred)
pnpm build        # Run DB migrations then Next.js build
pnpm start        # Start production server after build
pnpm lint         # Biome linter (not ESLint)
pnpm format       # Biome auto-format
pnpm type-check   # TypeScript check without emitting
pnpm test         # Vitest unit + integration tests
pnpm test:e2e     # Playwright end-to-end tests
```

Run in background when you need it running but want to keep the terminal:
```bash
# Unified webroot server (from webroot/):
nohup node chat/server.mjs > /tmp/chat-dev.log 2>&1 &

# Chat-only Turbopack dev (from webroot/ or chat/):
nohup pnpm --prefix chat dev > /tmp/chat-dev.log 2>&1 &
```

Check if already running: `lsof -ti:3700`

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 15 (App Router) |
| React | React 19 RC |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS + `shadcn/ui` components |
| Linter/Formatter | **Biome** (not ESLint, not Prettier) |
| Package manager | **pnpm** (not npm, not yarn) |
| Database | **Optional** — PostgreSQL via Supabase or any Postgres URL; omit for stateless/OAuth-only auth |
| ORM | Drizzle ORM — schema in `lib/db/drizzle-schema.ts` |
| DB migrations | `lib/db/migrations/` — run with `pnpm db:migrate` |
| Auth | better-auth — instance in `betterauth/`, helpers in `lib/auth/`, middleware in `proxy.ts` |
| AI SDK | Vercel AI SDK v5 (`@ai-sdk/*`) |
| Icons | Custom inline SVG in `components/icons.tsx` |

---

## Environment Variables

Loaded from the local env file that `automation/paths.yaml`'s `env_file:` key
points at (resolved relative to `automation/` at the webroot root, not this
folder; see `automation/README.md` for how that's set). Key variables:

```
ANTHROPIC_API_KEY     # Claude — for browser UX, not CLI
GEMINI_API_KEY        # Google Gemini
OPENAI_API_KEY        # OpenAI
XAI_API_KEY           # xAI (Grok)
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
POSTGRES_URL
BETTER_AUTH_SECRET
REQUIRE_AUTH          # optional — true/false to override host-based auth gate
```

The `lib/env-loader.ts` file handles reading these at runtime. **Non-secret** auth/site settings (origins, base URLs, mode flags) belong in `docker/webroot.yaml`; **secrets** (`BETTER_AUTH_SECRET`, OAuth client secrets, `POSTGRES_URL`) stay in the local env file (see `automation/paths.yaml`). See **Authentication (better-auth)** below for the full auth variable list and the OAuth provider credentials.

### Where to document new env vars

There is **no `chat/.env.example`**. The canonical sample env file for this app lives at the webroot root: **`../automation/.env.example`**. Add new variable placeholders and explanatory comments there, not inside `chat/`.

Agent behavior when adding a new env var example:

1. Add the placeholder + comment to `automation/.env.example`.
2. **Ask the user** whether the same placeholder should also be appended to their local env file (the live config, see `automation/paths.yaml`). Don't add it silently — the live file may already be populated and the user may want to set a real value rather than a placeholder.

### Vector DB sync (RAG ingestion)

`chat/ingestion/vector_db_sync.py` keeps the **Pinecone** index (embeddings via Voyage AI's `voyage-code-3`) in sync with the repo. It supports incremental modes (`--files`, `--from-commit`, changed-files list) as well as `--reindex-all`.

**Never run `--reindex-all` without explicit user confirmation.** It wipes the entire shared Pinecone index (not scoped to a branch, user, or namespace) before rebuilding from scratch — anyone else relying on that index loses search results until the rebuild finishes. The script itself now requires `--yes-i-know-this-wipes-shared-index` (or an interactive y/N prompt) to proceed; do not pass that flag on the user's behalf without them explicitly asking for a full reindex/rebuild. Prefer the incremental modes for normal sync.

---

## Key Architectural Patterns

### Icons

Two icon systems are in use — choose based on context:

| Context | Library | How to import |
|---|---|---|
| Sidebar tab row (`TABS` array in `app-sidebar.tsx`) | `lucide-react` | `import { BrainCog } from "lucide-react"` |
| Admin components (legacy) | `lucide-react` | same |
| All other components | Custom inline SVG in `components/icons.tsx` | `import { CheckCircleFillIcon } from "@/components/icons"` |

When adding a **new sidebar tab**, use `lucide-react` for visual consistency with the existing tab row. For everything else, add to or use `components/icons.tsx`.

The relevant check-mark icon for "key available" states is `CheckCircleFillIcon` (from `components/icons.tsx`).

### Storage
All browser-side key storage uses the `LocalStorageManager` singleton. Never write to `localStorage` directly from components — always go through the `storage` helper from `lib/storage/helpers.ts`:

```ts
import { storage } from "@/lib/storage/helpers";

storage.apiKeys.get("google")        // returns decrypted key or null
storage.apiKeys.set("google", key)   // encrypts and stores
storage.apiKeys.remove("google")     // deletes
```

Keys are stored encrypted in `localStorage['settings_api-keys']` using a non-extractable AES-GCM browser key held in IndexedDB (see `lib/storage/crypto.ts`).

### Database / Model Config
Provider and model configuration is stored in the `model_config` table. Queries are in `lib/db/queries/model-config.ts`. The DB seed is at `lib/db/migrations/0007_seed_data_model_config.sql`.

The **static provider registry** at `chat/keys/providers.js` must be kept manually in sync with the DB seed when models are added or removed.

### AI Providers
Provider implementations live in `lib/ai/providers/{google,anthropic,openai}/`. Each has agent variants (chat, document, mermaid, python, etc.). The resolver `lib/ai/chat-agent-resolver.ts` selects the right agent at runtime.

### Client vs Server API Calls
In this Vercel repo, the main chat goes through the app server because of architecture, not because browser JavaScript is inherently incapable of calling external APIs.

Within independent static widget folders (like chat/keys), you can add static javascript that calls provider APIs directly from browser JavaScript for some flows. The current chat path uses `/api/chat` because:

- the client intentionally sends the key to the app server: `components/chat.tsx`
- the server reads that header and runs the chat agent there: `app/(chat)/api/chat/route.ts`
- the agent code is explicitly server-only: `lib/ai/providers/google/chat-agent.ts`, `lib/ai/providers/google/agentConfigLoader.ts`
- the server path is tied into auth, DB saves, streaming, tool orchestration, and optional server env fallback key: `app/(chat)/api/chat/route.ts`

CORS is not the reason for Vercel's server-side emphasis. The chat repo already provide some browser-direct calls. The current chat implementation is server-mediated because that is how the app is structured. Whether a specific provider endpoint can be moved fully client-side depends on that provider's browser/CORS support and whether you are willing to move (duplicate) streaming, tools, auth checks, and persistence from the server-side folders.

Browser-direct calls include:

  - GitHub repo search/user repo fetch is done from client code with the PAT in the request header: `chat/lib/github-components/github-context-integration.tsx` — these same components are bundled as web components for use on non-React static pages; see the `chat/packages/github-components/` section below.
  - API key verification for Google/OpenAI/Anthropic is also client-side fetch code: chat/components/settings/settings-page.tsx, chat/lib/verification/
    google-verification-service.ts:24, chat/lib/verification/openai-verification-service.ts:22, chat/lib/verification/anthropic-verification-service.ts

### Left Sidebar Navigation

The sidebar (`components/app-sidebar.tsx`) has a top icon row defined in the `TABS` array. Each tab is a round icon button that switches the panel content below it. Current tabs (all icons from `lucide-react`):

| Tab `id` | Icon (`lucide-react`) | Label | Panel content |
|---|---|---|---|
| `sources` | `Library` | Sources | Repo checklist for RAG context selection |
| `chats` | `MessageSquare` | List Chats | Chat history (`SidebarHistory`) with New Chat and Delete All |
| `kb` | `BookOpen` | Knowledge Base | Suggested questions that pre-populate the chat input |
| `visibility` | `BrainCog` | AI Models & Keys | All provider models with availability indicators + key management (`KeyManagerPanel`) |

The `visibility` tab (formerly using `Lock`, label "Visibility") is being repurposed to show the full AI model list and key management UI — see `team/key/PLAN.md` Phase 3. The Private/Public visibility toggle moves into that panel alongside the model list.

> **New tabs** added to the `TABS` array should use `lucide-react` icons for visual consistency with the existing row.

### Components
- `components/ui/` — shadcn/ui primitives (Button, Card, Input, Sheet, Sidebar, etc.)
- `components/settings/` — settings page and all its sub-sections
- `components/key-manager/` — embeddable key manager (React + hook)
- `components/icons.tsx` — all icons for non-sidebar components; add new ones here

### Routing
App Router (`app/` directory). Route groups:
- `app/(chat)/` — main chat UI and its API routes
- `app/(auth)/` — authentication
- `app/api/admin/` — admin API endpoints
- `app/settings/` — settings page

---

## Authentication (better-auth)

Auth is provided by **better-auth**, integrated alongside (not replacing) the prior Supabase auth. The DB is an optional backend — see "Auth backends & no-database mode" above.

### Where the auth code lives

| File | Role |
|---|---|
| `betterauth/auth.ts` | Full server instance — Drizzle adapter (DB-backed), email/password, social providers, cookie/session config |
| `betterauth/auth-edge.ts` | DB-less instance for Edge middleware — validates the JWE session cookie with the shared secret, no DB roundtrip (this is the stateless path) |
| `betterauth/client.ts` | `better-auth/react` client for in-app React usage |
| `lib/auth/server.ts` | Server helpers: `getCurrentUser`, `getSession`, `requireAuth`, `requireAdmin`, `isAuthRequired` |
| `lib/auth/{client,context,hooks,types}.ts` | Client-side React context/hooks/types |
| `proxy.ts` | Edge middleware — route gating via `better-auth.session_token` cookie presence (public/protected/admin route lists) |
| `app/api/auth/*` | better-auth's own endpoints (`/sign-in/social`, `/get-session`, callbacks) |
| `app/api/oauth/[provider]/route.ts` | **Navigation-based OAuth proxy** (incognito-safe — see below) |
| `app/api/oauth/relay/route.ts` | Reads the session first-party after OAuth callback, returns identity in the URL hash |
| `auth/js/auth-modal.js` | Vanilla-JS sign-in modal for **static** (non-Next.js) pages; calls the OAuth proxy via top-level navigation |
| `auth/js/auth-plugin.js`, `auth/css/auth.css` | Supporting plugin + styles for the static modal |

> **Why `chat/auth/`, not `chat/public/auth/`:** these are **pure-static, no-build** assets, served exactly like `chat/keys/`. Living under `public/` would make them reachable only through a running Next.js server (which strips `public/`), so a plain static file server (the webroot's Python server) couldn't serve them at a clean path. As a sibling of `chat/keys/`, they're served literally at `/chat/auth/...` by any static server, and `server.mjs` has a `/auth/*` + `/chat/auth/*` handler (mirroring its `/chat/keys/*` handler) for the unified server. Trade-off: a Vercel **root=chat** deployment must serve `chat/auth/` the same way it serves `chat/keys/` (not auto-served from outside `public/`).

> **URL-path naming rule:** keep the term "betterauth"/"better-auth" **out of public URL paths**. The API mounts use generic `/api/auth/*` (your `app/api/auth/[...all]/route.ts`) and `/api/oauth/*`. Static client assets live under `chat/auth/` → served at `/chat/auth/...` (or `/auth/...` when the deploy root is chat), **not** `/betterauth/...`. The source folder `betterauth/` is only an import alias (`@/betterauth/auth`) and is never exposed as a URL.

### Static sign-in for non-React sites (the localsite dispatcher)

Non-React sites across the webroot (team, localsite-based pages, etc.) do **not** ship their own auth UI. They call a single shared dispatcher, `showAuthModal()`, defined once in `localsite/js/localsite.js` (the universal include on every site). That dispatcher contains no auth logic — it looks up **where** the auth modal lives and loads it from this chat repo's `chat/auth/` (served at `/chat/auth/...`).

The auth source is configured in **`docker/webroot.yaml`** under the `auth:` block (`modal_url_*`, `plugin_url_*`, `api_url_*`, `source_repo`). `showAuthModal()` resolves it in this order: `window.webrootAuth` → the `auth:` block fetched from `/docker/webroot.yaml` → built-in fallback (`/auth/js/auth-modal.js` at the site root, i.e. this repo). This indirection lets the auth source be repointed to a different repo later without editing any site code.

**In-page launcher:** when localsite inserts its account panel (`template-main.html`, which holds `#accountPanelInserts`), `loadLocalTemplate()` calls `initAuthPlugin()`, which loads this repo's **`auth-plugin.js`** (`plugin_url_*` from `webroot.yaml`). The plugin injects the sign-in button + session state inline into `#accountPanelInserts` and opens the modal on click — so sign-in works **in-page**, not only as a popup. It's loaded only where the account panel exists, so header-less pages get no floating button.

**Path prefix:** from a host page served by the **webroot**, the chat app (modal, plugin, and `/api`) lives under **`/chat`** — e.g. `/chat/auth/js/auth-plugin.js`, `/chat/api`. The `/auth/...` and `/api/...` forms (no prefix) apply only when the deploy root **is** the chat repo itself (some Vercel deployments, and the chat-at-root unified dev server). `webroot.yaml`'s `*_development` values carry the `/chat` prefix; the `*_production` values point at the standalone chat deployment without it. Adjust per how the chat app is mounted.

**Do not reintroduce auth UI or a duplicate modal into `localsite/` or `team/`** — host the modal/plugin here and let sites reach them through `showAuthModal()` / the account panel.

### Cross-origin / incognito design (important)

The chat app's auth origin differs from the page origin in dev (`:3700` vs `:8887`). In production, both the auth API and the app are served from `modelearth.vercel.app`, so they are same-origin and the cookie issue does not apply. The failure where **auth works in normal Chrome but fails in incognito and Firefox is a third-party-cookie problem, not CORS**:

- A cookie written from a cross-origin `fetch()` response (the OAuth `state` cookie, the session cookie) is a third-party cookie. Incognito Chrome and Firefox (Total Cookie Protection) block it by default; normal Chrome still allows it.
- Adding `Access-Control-Allow-*` headers cannot fix this — CORS governs reading the response, not storing/sending the cookie.

The fix is to avoid cross-origin cookie writes/reads entirely:

1. **OAuth init is a top-level navigation**, not `fetch()`. The browser navigates to `/api/oauth/:provider?redirect=<page>` on the chat origin, so better-auth writes the `state` cookie **first-party**.
2. The proxy sets `callbackURL` to **`/api/oauth/relay`**, which reads the session server-side (first-party) and appends the user as a base64url blob in the **URL hash** (`#auth_user=…`). The page reads the hash — no cross-origin cookie read.

**Known gaps to close as betterauth is integrated** (do not assume these are done):

- **Session persistence:** `auth-modal.js` still falls back to a cross-origin `fetch('/auth/get-session')`, which is blocked in incognito/Firefox on refresh. Stateless mode should instead hand the page a **signed token** stored on the page origin and sent as `Authorization: Bearer …` (bearer headers are not subject to cookie blocking).
- **The `#auth_user=` blob is unsigned** — cosmetic only (name/avatar). Never treat it as proof of auth; every privileged action must be authorized server-side. A real stateless credential must be a signed JWT/JWE.
- **Production is same-origin:** `modelearth.vercel.app` serves both the app and the API, so cross-subdomain cookies are not needed there. The relay/bearer path is still needed for the dev setup (`:3700` vs `:8887`) and any off-domain embed.

### Auth configuration & secrets

Non-secret auth settings belong in **`docker/webroot.yaml`** (the committed site config). Secrets (`BETTER_AUTH_SECRET`, OAuth client secrets, `POSTGRES_URL`) belong in the local env file (see `automation/paths.yaml`) — never in `webroot.yaml`.

Relevant env vars (loaded from the local env file — see "Environment Variables" above):

```
BETTER_AUTH_SECRET        # required, min 32 chars — signs the JWE session
BETTER_AUTH_BASE_URL      # auth origin, e.g. http://localhost:3700 or https://modelearth.vercel.app
ALLOWED_ORIGINS           # comma-separated trusted origins (required in production)
AUTH_API_URL              # client override for the auth API base (window.AUTH_API_URL)
REQUIRE_AUTH              # true/false override of the host-based auth gate
POSTGRES_URL              # OPTIONAL — omit for stateless / OAuth-only mode
# OAuth provider credentials (each provider auto-enables only when both are set):
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET
DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
FACEBOOK_CLIENT_ID / FACEBOOK_CLIENT_SECRET
```

### Setting env vars in Vercel

Vercel's dashboard supports bulk paste: **Project → Settings → [choose Production] →
Environment Variables → Add → paste multiple lines** in `KEY=VALUE` format (same
as `.env`). This is the fastest way to populate secrets.

However, several vars have **different values in production** vs your
local env file. The section at the bottom of that file labelled
`# Production Vercel` lists the overrides to paste — use those values instead of
the localhost ones. Vars not listed there are environment-agnostic and can be
pasted as-is.

**Vars that must differ from local `.env`:**

| Variable | Local value | Vercel (Production) value |
|---|---|---|
| `BETTER_AUTH_SECRET` | any strong random value | separately generated value |
| `BETTER_AUTH_BASE_URL` | `http://localhost:3700` | `https://modelearth.vercel.app` |
| `ALLOWED_ORIGINS` | localhost ports | `https://modelearth.vercel.app` |

**Vars that are environment-agnostic** (paste the same value):
OAuth `CLIENT_ID`/`CLIENT_SECRET` pairs, `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_URL`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `PINECONE_API_KEY`, `VOYAGE_API_KEY`,
and other API keys.

Vercel does not auto-rebuild when env vars change — trigger a new deployment
after saving them.

---

## Deploying to Vercel — repo root vs `chat/` root

Two supported deployment modes. The webroot parent folder **may not always be named `webroot`** — never hard-code that name; always resolve paths relative to the config file location or `import.meta.url`.

### Mode A — Root Directory = `chat` (current default)

Vercel project settings:

| Setting | Value |
|---|---|
| Root Directory | `chat` |
| Framework Preset | Next.js (auto-detected) |
| Install Command | (leave default: `pnpm install`) |
| Build Command | (leave default: `pnpm build`) |
| Output Directory | (leave default: `.next`) |

See `DEPLOYMENT_GUIDE.md` for full steps including Supabase setup and env vars.

**What's served:** only the Next.js chat app and its `public/` directory.

**Known gap — static widget assets:** `chat/keys/key-manager.js`, `chat/keys/style.css`, and `chat/auth/js/auth-{modal,plugin}.js` are served by `server.mjs` locally but are not inside `chat/public/`, so Vercel will not serve them at `/keys/…` or `/chat/keys/…`. The React key manager page at `/key` works (Next.js route). Static embeds on non-Next.js pages that load `key-manager.js` directly will 404. Fix: copy those files into `chat/public/keys/` and `chat/public/auth/` as part of the build, or add Next.js API routes that stream them.

### Mode B — Root Directory = webroot root

Use this when the parent webroot folder is the Vercel project root (e.g. the webroot repo itself is what's imported into Vercel, not just the `chat/` subfolder).

There is no `package.json` at the webroot root, so Vercel's default install/build steps fail. A `vercel.json` at the webroot root handles this:

```json
{
  "installCommand": "pnpm --prefix chat install",
  "buildCommand": "pnpm --prefix chat build",
  "outputDirectory": "chat/.next",
  "framework": "nextjs"
}
```

This file exists at `webroot/vercel.json`. Alternatively, set these in the Vercel dashboard under Project Settings → Build & Development Settings.

Vercel dashboard settings for Mode B:

| Setting | Value |
|---|---|
| Root Directory | (blank — webroot root) |
| Framework Preset | Next.js |
| Install Command | `pnpm --prefix chat install` |
| Build Command | `pnpm --prefix chat build` |
| Output Directory | `chat/.next` |

**What's served:** only the Next.js chat app — same as Mode A. Vercel does **not** serve sibling static repos (`/localsite/`, `/team/`, `/requests/`, etc.). Those are served locally by `server.mjs` but Vercel has no file server for them. If needed, serve sibling repos from a CDN or a separate Vercel static project.

### `server.mjs` is local dev only

`chat/server.mjs` is the **local unified development server** — it is never invoked by Vercel. Vercel runs `next build` then `next start` (or its own Next.js serverless runtime). The static-file routing, Sanity proxy, and sibling-repo serving in `server.mjs` have no equivalent on Vercel.

### Path resolution must stay relative

- `lib/env-loader.ts` probes `../automation` (relative to `chat/` as cwd) then `automation` (relative to cwd if cwd is the webroot root) to find `paths.yaml` — keep both candidates.
- `next.config.mjs` anchors `turbopack.root = __dirname` (the `chat/` directory) — keep root detection anchored to the config file location, not to a folder name.
- `server.mjs` uses `CHAT_DIR = dirname(fileURLToPath(import.meta.url))` and `WEBROOT = resolve(CHAT_DIR, '..')` — already correct regardless of what the parent folder is named.

---

## The `chat/keys/` Static Subfolder

`chat/keys/` contains a **vanilla JS embeddable key manager** served statically at `localhost:8887/chat/keys/` by the Python HTTP server — no Next.js build required.

```
chat/keys/
  index.html        # Standalone settings page, no build needed
  key-manager.js    # Vanilla JS widget (no React, no bundler)
  providers.js      # Static copy of provider + model registry
  style.css         # Widget styles
```

### Keeping `key-manager.js` in sync

**Whenever you update key management logic in the Next.js app, also update `chat/keys/key-manager.js`** to match. The two share the same `localStorage['settings_api-keys']` format and encryption scheme (`lib/storage/crypto.ts` logic is duplicated in vanilla JS in `key-manager.js`). Non-Next.js pages (`team/projects/index.html`, `requests/engine/`) embed this file via:

```html
<script src="/chat/keys/providers.js"></script>
<script src="/chat/keys/key-manager.js"></script>
```

The public API is `window.KeyManager`:
- `KeyManager.init(el, options)` — render full widget into a container element
- `KeyManager.get(providerId)` — returns decrypted key or null
- `KeyManager.set(providerId, value)` — encrypts and stores
- `KeyManager.has(providerId)` — boolean
- `KeyManager.remove(providerId)` — deletes
- `KeyManager.migrateFromLegacy()` — one-time migration from `aPro` / `${aiType}_api_key`

Changes that require a `key-manager.js` update:
- Any change to the `settings_api-keys` JSON format
- Any change to the encryption/decryption logic in `crypto.ts`
- Any new provider added to `providers.ts` / `providers.js`
- Any UX change to the key entry widget that should also apply in non-Next.js contexts

---

## `chat/packages/github-components/` Web Component Bundle

Wraps `chat/lib/github-components/` React components as Custom Elements for use in plain HTML pages via a single `<script>` tag. The built `dist/github-components.js` is committed to git — no build step needed to use it. Rebuild only when the source components change. See `chat/packages/github-components/AGENTS.md` for build instructions and architecture notes.

---

## Linting and Formatting

This project uses **Biome**, not ESLint or Prettier. Run before committing:

```bash
pnpm lint      # check
pnpm format    # auto-fix formatting
```

The Biome config is at `biome.json` in the repo root.

---

## Database Migrations

Migrations live in `lib/db/migrations/`. To create a new migration:

```bash
pnpm db:generate   # generate from schema changes
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # open Drizzle Studio (visual DB browser)
```

The build script (`pnpm build`) runs migrations automatically before building.

---

## Testing

```bash
pnpm test              # all unit + integration tests (Vitest)
pnpm test:unit         # unit tests only
pnpm test:integration  # integration tests only
pnpm test:e2e          # Playwright end-to-end
pnpm test:coverage     # with coverage report
```

Tests live in `tests/`. Fixtures in `tests/fixtures/`.

---

## Git Workflow

- Do **not** commit automatically — only commit when the user explicitly asks
- Push this site repo from the parent root folder (not from inside `chat/`)

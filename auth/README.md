[OAuth Setup](oauth-setup.md) | [API Route](../app/api/auth/README.md) | [Auth Instance](../lib/auth/instance.ts)

---

# Auth

The chat repo is the **canonical host for all shared sign-in UI and auth API logic** across the webroot. Any site that includes `localsite.js` gets auth by pointing at the two JS files below.

## Sign-in pages

There are two sign-in pages, both backed by the same better-auth instance:

| Path | What it shows | Component |
|---|---|---|
| `/auth/` | Social provider buttons (Google, GitHub, Microsoft, LinkedIn, Discord) | `app/auth/page.tsx` — Next.js route |
| `/login` | Email + password form | `app/(auth)/login/page.tsx` — Next.js route |

`/auth/` is the primary entry point for most users. `/login` is the fallback for email/password accounts. The `/login` page displays a "Database connection unavailable" notice when `POSTGRES_URL` is not set (see Stateless mode below).

> **Historical note:** The `/login` page originally used Supabase directly. It now uses better-auth for session management; `isSupabaseConfigured` in the login UI still checks for `NEXT_PUBLIC_SUPABASE_URL` to show a helpful warning when the DB is unreachable.

## Files

| File | Purpose |
|---|---|
| `js/auth-plugin.js` | Drop-in script for host pages. Injects provider buttons inline into `#accountPanelInserts`, or a floating Sign In button + popup fallback if the panel isn't present. |
| `js/auth-modal.js` | Popup overlay. Lazy-loaded by `auth-plugin.js` only when a popup is needed. Pages with `#accountPanelInserts` never load this file. |
| `css/auth.css` | Styles for `index.html` (static standalone auth page for webroot setup). |
| `index.html` | Static sign-in page used in the webroot setup at `/chat/auth/`. Not used on Vercel standalone (replaced by `app/auth/page.tsx`). |
| `oauth-setup.md` | Step-by-step OAuth provider registration guide (all 6 providers). |

## Deployment modes

### Webroot mode (chat lives under `/chat/`)

The static `index.html` is served by the webroot static server at `/chat/auth/`. Host pages load the plugin via:

```html
<script src="/chat/auth/js/auth-plugin.js" defer></script>
```

`localsite.js` resolves the correct URL using the `auth:` block in `docker/webroot.yaml`.

### Standalone Vercel (chat is the site root)

`app/auth/page.tsx` is the Next.js page served at `/auth/`. The plugin script path drops the `/chat` prefix:

```html
<script src="/auth/js/auth-plugin.js" defer></script>
```

The `api_url_*` always points at the Node server (port 3700 locally, `https://modelearth.vercel.app` in production) — never at a static file server port.

## API

The auth API is served by the Next.js app at `/api/auth/**` (handled by
`app/api/auth/[...all]/route.ts` via better-auth). See
[`app/api/auth/README.md`](../app/api/auth/README.md) for the full architecture.

OAuth provider buttons call `/api/oauth/:provider` which uses top-level navigation
(not `fetch`) to avoid third-party cookie restrictions in incognito/Firefox.

## Stateless mode (no database)

When `POSTGRES_URL` is not set, `db` is `null` and better-auth runs without a Drizzle adapter. Sessions are validated via JWE cookie only — no database reads. Social login still works; email/password login does not (requires a user record in the DB).

The `/login` page shows a "Database connection unavailable" warning in this state. The `/auth/` page is unaffected.

## Controlling auth gating

By default, **no pages require login**. Individual server components (`requireAuth`, `requireAdmin`) gate their own routes.

Set `REQUIRE_AUTH=true` in env vars to require login for the entire site (middleware enforces it before every request).

## First-time setup

`BETTER_AUTH_SECRET` is required before any provider will work.

**Local** (your local env file, see `automation/paths.yaml`): any strong random value works. Sessions stay local
because `api_url_development` in `docker/webroot.yaml` always points to
`localhost:3700`, never to Vercel.

```
BETTER_AUTH_SECRET=$(openssl rand -base64 32)
```

**Vercel** (Settings → [choose Production] → Environment Variables): set its own
independent `BETTER_AUTH_SECRET` (generate a separate value). The two secrets do
not need to match — local and Vercel are separate deployments with separate
sessions. Vercel cannot generate this value automatically; better-auth requires it
at startup and has no persistent store between serverless invocations.

Also required on Vercel:

| Variable | Value |
|---|---|
| `BETTER_AUTH_BASE_URL` | `https://modelearth.vercel.app` |
| `ALLOWED_ORIGINS` | `https://modelearth.vercel.app` |
| `POSTGRES_URL` | Supabase connection string (optional — omit for stateless mode) |

See [oauth-setup.md](oauth-setup.md) for the full provider credential variable list.

## Adding a provider

1. Register the OAuth app and get credentials — see [oauth-setup.md](oauth-setup.md).
2. Add `PROVIDER_CLIENT_ID` and `PROVIDER_CLIENT_SECRET` to your local env file (see `automation/paths.yaml`).
3. The provider auto-enables in `lib/auth/instance.ts` when both vars are present.

# Contributor Deployment Guide

How to set up your own personal instance of the chat app on Vercel + Supabase.
Each contributor should have their own instance separate from the main `modelearth.vercel.app` deployment.

---

## Prerequisites

- GitHub account with access to the repo
- [Vercel account](https://vercel.com) — create your own, free
- [Supabase account](https://supabase.com) — create your own, free

---

## Step 1 — Create a Neon Database

We're using Neon instead of Supabase

## Step 1 — Create a Supabase Project (Legacy)

1. Go to [supabase.com](https://supabase.com) → sign in → **New Project**
2. Name it `your-name-chat` 
3. Set a strong database password and save it
4. Choose region: **US East**
5. Click **Create Project** — takes ~2 minutes

**Collect these values from Project Settings → API:**

| Variable | Where |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |

**Collect this from Project Settings → Database → Connection string → URI:**

| Variable | Where |
|---|---|
| `POSTGRES_URL` | URI format — replace `[YOUR-PASSWORD]` with your db password |

---

## Step 2 — Run Database Migrations

Go to your Supabase project → **SQL Editor** → **New query**

**Run query 1 — BetterAuth tables:**

```sql
CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  image TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "session" (
  id TEXT PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "account" (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMP,
  refresh_token_expires_at TIMESTAMP,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification" (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

**Run query 2 — Chat app tables:**

Copy the full contents of `lib/db/migrations/0001_tables.sql` and run it in a new query.

Both queries should return: `Success. No rows returned`

---

## Step 3 — Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Set **Root Directory** to `chat`
4. Framework auto-detects as **Next.js**

**Add these Environment Variables before deploying:**

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | Random 32+ char string — generate with `openssl rand -base64 32` |
| `NEXT_PUBLIC_SUPABASE_URL` | From Step 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | From Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | From Step 1 |
| `POSTGRES_URL` | From Step 1 |
| `GOOGLE_GENERATIVE_AI_API_KEY` | From [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `ALLOWED_ORIGINS` | `https://your-app.vercel.app` (your Vercel URL) |

5. Click **Deploy** — takes ~2 minutes

---

## Step 4 — Add BetterAuth URL

After deploy, copy your Vercel URL (e.g. `https://your-app.vercel.app`) then:

1. Go to **Project Settings → Environment Variables**
2. Add:

| Variable | Value |
|---|---|
| `BETTER_AUTH_BASE_URL` | `https://your-app.vercel.app` |

3. Go to **Deployments** → three dots on latest → **Redeploy**

---

## Running Locally

From the `webroot` root directory:

```bash
node chat/server.mjs
```

URLs:
- Chat: http://localhost:8888/chat
- Keys: http://localhost:8888/chat/keys/
- Static: http://localhost:8888

**Local `.env.local` file** (inside `chat/`):

Copy the variables from the table above and add:

```
BETTER_AUTH_SECRET=your-32-char-secret
BETTER_AUTH_BASE_URL=http://localhost:8888
ALLOWED_ORIGINS=http://localhost:8887,http://localhost:8888
```

---

## Troubleshooting

| Error | Fix |
|---|---|
| `BETTER_AUTH_SECRET is required` | Add `BETTER_AUTH_SECRET` to `.env.local` or Vercel env vars |
| `ALLOWED_ORIGINS is required in production` | Add `ALLOWED_ORIGINS` to Vercel env vars |
| `Module not found: better-auth/react` | Run `npm install --legacy-peer-deps` in the `chat` directory |
| Build fails on `/api/document` | Usually means a missing env var — check all vars are set |

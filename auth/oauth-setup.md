[Google](#google) | [GitHub](#github) | [Discord](#discord) | [LinkedIn](#linkedin) | [Microsoft](#microsoft) | [Facebook](#facebook) | [Env Vars](#env-vars)

---

# OAuth Provider Setup

Auth is provided by **better-auth** in the [chat](../../../../chat/) repo (`chat/lib/auth/instance.ts`). Each provider uses a server-side redirect flow — the browser navigates to `/api/oauth/:provider`, which redirects to the provider's authorization page. After authorization, the provider calls back to `/api/auth/callback/:provider`.

Enable a provider by adding both its `CLIENT_ID` and `CLIENT_SECRET` to your local env file (see `automation/paths.yaml`). A provider with only one variable set is ignored.

## Callback URL Pattern

Register this redirect URI in each provider's developer console:

| Environment | Callback URI |
|---|---|
| Development | `http://localhost:3700/api/auth/callback/<provider>` |
| Production | `https://modelearth.vercel.app/api/auth/callback/<provider>` |

Replace `<provider>` with the provider name below.

---

<span id="google"></span>

## Google

Provider name: `google`

### 1. Create or open a project

Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials). Select an existing project or click **New Project**.

### 2. Configure the OAuth consent screen

Go to **APIs & Services → OAuth consent screen**.
- Choose **External** (unless restricting to your org).
- Fill in app name, support email, and developer contact email.
- Under **Scopes**, add: `userinfo.email`, `userinfo.profile`, `openid`.

### 3. Create OAuth credentials

Click **+ Create Credentials → OAuth client ID**.
- **Application type:** Web application

### 4. Add authorized URIs

Under **Authorized redirect URIs**:
```
http://localhost:3700/api/auth/callback/google
https://modelearth.vercel.app/api/auth/callback/google
```

> **Note:** The Google Identity Services (GSI) sign-in button uses *Authorized JavaScript origins* instead of redirect URIs, and is a different flow. better-auth uses redirect URIs only.

### 5. Copy credentials

Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and **Client secret**.

---

<span id="github"></span>

## GitHub

Provider name: `github`

1. Go to [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set **Authorization callback URL**:
   ```
   http://localhost:3700/api/auth/callback/github
   ```
4. Copy the **Client ID** and click **Generate a new client secret**

---

<span id="discord"></span>

## Discord

Provider name: `discord`

1. Go to [Discord Developer Portal → Applications](https://discord.com/developers/applications)
2. Open your app (or create one) → **OAuth2** → **Redirects**
3. Add:
   ```
   http://localhost:3700/api/auth/callback/discord
   ```
4. Copy the **Client ID** and **Client Secret** from the OAuth2 page

---

<span id="linkedin"></span>

## LinkedIn

Provider name: `linkedin`

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps)
2. Open your app → **Auth** tab
3. Under **Authorized redirect URLs**, add:
   ```
   http://localhost:3700/api/auth/callback/linkedin
   ```
4. Copy the **Client ID** and **Client Secret**

---

<span id="microsoft"></span>

## Microsoft

Provider name: `microsoft`

1. Go to [Azure Portal → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Open your app (or click **New registration**) → **Authentication → Redirect URIs**
3. Add:
   ```
   http://localhost:3700/api/auth/callback/microsoft
   ```
4. Copy the **Application (client) ID**
5. Go to **Certificates & secrets → New client secret** and copy the value

---

<span id="facebook"></span>

## Facebook

Provider name: `facebook`

1. Go to [Meta for Developers](https://developers.facebook.com/apps/)
2. Open your app → **Facebook Login → Settings**
3. Under **Valid OAuth Redirect URIs**, add:
   ```
   http://localhost:3700/api/auth/callback/facebook
   ```
4. Copy the **App ID** and **App Secret** from the app dashboard

---

<span id="env-vars"></span>

## Environment Variables

Set in your local env file (see `automation/paths.yaml`). Each provider auto-enables when **both** its vars are present.

```
BETTER_AUTH_SECRET=           # required — min 32 chars: openssl rand -base64 32
BETTER_AUTH_BASE_URL=http://localhost:3700
ALLOWED_ORIGINS=http://localhost:3700,http://localhost:8887,http://localhost:8888,http://localhost:8889

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=

FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
```

For production:
```
BETTER_AUTH_BASE_URL=https://modelearth.vercel.app
ALLOWED_ORIGINS=https://model.earth,https://modelearth.vercel.app
POSTGRES_URL=              # optional — omit for stateless/OAuth-only sessions
```

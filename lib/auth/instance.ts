import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, isDbConfigured } from "@/lib/db/queries/base";
import {
  betterAuthUser,
  betterAuthSession,
  betterAuthAccount,
  betterAuthVerification,
} from "@/lib/db/drizzle-schema";
import { isSocialProviderConfigured } from "@/lib/auth/social-providers";
import { databasePasswordHashing } from "@/lib/auth/password";

function requireSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  // Skip validation during `next build` — the secret is only needed at request
  // time, not during static analysis. NEXT_PHASE is set by Next.js during build.
  if (process.env.NEXT_PHASE === 'phase-production-build') return secret ?? '';
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is required (min 32 chars)");
  }
  return secret;
}

function resolveBaseURL(): string {
  if (process.env.BETTER_AUTH_BASE_URL) return process.env.BETTER_AUTH_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3700";
}

function resolveTrustedOrigins(): string[] {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
  }
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== 'phase-production-build') {
    throw new Error("ALLOWED_ORIGINS is required in production");
  }
  // 3700 = node server; 8887/8888/8889 = static webroot servers whose pages load the auth modal
  return ["http://localhost:3700", "http://localhost:8887", "http://localhost:8888", "http://localhost:8889"];
}

function createAuth() {
  try {
    return betterAuth({
  basePath: "/api/auth",
  baseURL: resolveBaseURL(),
  secret: requireSecret(),
  ...(isDbConfigured && db ? {
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: betterAuthUser,
        session: betterAuthSession,
        account: betterAuthAccount,
        verification: betterAuthVerification,
      },
    }),
  } : {}),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    // bcrypt in Postgres, shared with the CloudRoot Worker (see password.ts).
    ...(isDbConfigured && db ? { password: databasePasswordHashing(db) } : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "google", "linkedin", "microsoft", "discord", "facebook"],
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "user",
        input: false,
      },
    },
  },
  advanced: {
    // Under database: the adapter reads only advanced.database.generateId.
    // UUIDs, since chat's own tables store user_id as uuid.
    database: { generateId: () => crypto.randomUUID() },
    storeStateStrategy: "cookie",
    useSecureCookies: process.env.NODE_ENV === "production",
    cookieSameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    crossSubDomainCookies: { enabled: false },
    defaultCookieAttributes: {
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      path: "/",
    },
  },
  onAPIError: {
    errorURL: "/auth",
  },
  trustedOrigins: resolveTrustedOrigins(),
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 7 * 24 * 60 * 60,
      strategy: "jwe",
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      enabled: isSocialProviderConfigured("google"),
    },
    linkedin: {
      clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
      clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
      enabled: isSocialProviderConfigured("linkedin"),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      enabled: isSocialProviderConfigured("github"),
    },
    microsoft: {
      clientId: process.env.MICROSOFT_CLIENT_ID ?? "",
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET ?? "",
      tenantId: "common",
      enabled: isSocialProviderConfigured("microsoft"),
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID ?? "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "",
      enabled: isSocialProviderConfigured("discord"),
    },
    facebook: {
      clientId: process.env.FACEBOOK_CLIENT_ID ?? "",
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? "",
      enabled: isSocialProviderConfigured("facebook"),
    },
  },
});
  } catch (e) {
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      console.error('[auth] betterAuth initialization failed:', e);
    }
    return null;
  }
}

export const auth = createAuth();

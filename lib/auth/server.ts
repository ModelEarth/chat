import type { Session, User } from "./types";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/instance";
import { db, isDbConfigured } from "@/lib/db/queries/base";
import { betterAuthAccount } from "@/lib/db/drizzle-schema";
import { eq } from "drizzle-orm";

export type ServerAuthResult = { user: User; session: Session };

export interface ServerAuthError extends Error {
  code: "UNAUTHORIZED" | "FORBIDDEN" | "SESSION_EXPIRED" | "UNKNOWN_ERROR";
  statusCode: number;
}

export async function isAuthRequired(reqHeaders?: Headers): Promise<boolean> {
  const flag = process.env.REQUIRE_AUTH?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return false; // Default: auth optional. Set REQUIRE_AUTH=true to gate the whole site.
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    if (!auth) return null;
    const session = await auth.api.getSession({ headers: await headers() });
    return session?.user ? (session.user as unknown as User) : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    if (!auth) return null;
    const sessionData = await auth.api.getSession({ headers: await headers() });
    return sessionData?.session ? (sessionData.session as unknown as Session) : null;
  } catch {
    return null;
  }
}

export async function getUserRole(user?: User | null): Promise<"admin" | "user"> {
  const u = user ?? await getCurrentUser();
  return u?.role === "admin" ? "admin" : "user";
}

export async function hasRole(requiredRole: "admin" | "user", user?: User | null): Promise<boolean> {
  return (await getUserRole(user)) === requiredRole;
}

export async function requireAuth(): Promise<ServerAuthResult> {
  const user = await getCurrentUser();
  const session = await getSession();
  if (!user || !session) {
    const error = new Error("Authentication required") as ServerAuthError;
    error.code = "UNAUTHORIZED";
    error.statusCode = 401;
    throw error;
  }
  return { user, session };
}

export async function requireAdmin(): Promise<ServerAuthResult> {
  const { user, session } = await requireAuth();
  if (user.role !== "admin") {
    const error = new Error("Admin privileges required") as ServerAuthError;
    error.code = "FORBIDDEN";
    error.statusCode = 403;
    throw error;
  }
  return { user, session };
}

export async function requireAuthWithRedirect(redirectTo?: string): Promise<ServerAuthResult> {
  const user = await getCurrentUser();
  const session = await getSession();
  if (!user || !session) {
    redirect(redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login");
  }
  return { user, session };
}

export async function requireAdminWithRedirect(redirectTo?: string): Promise<ServerAuthResult> {
  const user = await getCurrentUser();
  const session = await getSession();
  if (!user || !session) {
    redirect(redirectTo ? `/login?redirectTo=${encodeURIComponent(redirectTo)}` : "/login");
  }
  if (user.role !== "admin") redirect("/");
  return { user, session };
}

export function createAuthErrorResponse(error: ServerAuthError | Error): Response {
  if ("statusCode" in error && "code" in error) {
    return new Response(JSON.stringify({ error: error.message, code: error.code }), {
      status: error.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ error: "Internal server error", code: "UNKNOWN_ERROR" }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

// Keep isAdmin for callers that use it
export async function isAdmin(user?: User | null): Promise<boolean> {
  return (await getUserRole(user)) === "admin";
}

// Returns true when the current user is logged in exclusively via
// email/password (no social accounts linked). Used to show the privacy banner.
export async function isEmailPasswordUser(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user || !isDbConfigured || !db) return false;
    const accounts = await db
      .select({ providerId: betterAuthAccount.providerId })
      .from(betterAuthAccount)
      .where(eq(betterAuthAccount.userId, user.id));
    return accounts.length > 0 && accounts.every((a) => a.providerId === "credential");
  } catch {
    return false;
  }
}

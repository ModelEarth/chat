"use client";

import { createAuthClient } from "better-auth/react";
import type { User, Session, UserMetadata, SignUpEmailStatus } from "./types";

export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export type { User, Session, UserMetadata, SignUpEmailStatus };

function friendlyError(err: { message?: string; status?: number } | null | undefined): Error {
  const raw = err?.message?.toLowerCase() ?? "";
  const status = err?.status ?? 0;
  if (raw.includes("invalid") || raw.includes("credentials") || raw.includes("password") || status === 401)
    return new Error("Invalid email or password.");
  if (raw.includes("not found") || raw.includes("no user") || status === 404)
    return new Error("No account found with that email.");
  if (raw.includes("already") || raw.includes("exists") || status === 409)
    return new Error("An account with that email already exists.");
  if (raw.includes("rate") || status === 429)
    return new Error("Too many attempts. Please wait a moment and try again.");
  if (status >= 500 || raw.includes("database") || raw.includes("connect") || raw.includes("enotfound"))
    return new Error("Unable to reach the database. Check that the database is awake and AUTH_POSTGRES_URL (or POSTGRES_URL) is correct in your env file.");
  return new Error(err?.message || "Something went wrong. Please try again.");
}

export type AuthResult = {
  user: User | null;
  session: Session | null;
  error: Error | null;
};

export type SignUpResult = AuthResult & {
  emailStatus: SignUpEmailStatus;
};

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await authClient.signIn.email({ email, password });
    if (error) return { user: null, session: null, error: friendlyError(error) };
    return {
      user: (data?.user as unknown as User) ?? null,
      session: null,
      error: null,
    };
  } catch (err) {
    return { user: null, session: null, error: err as Error };
  }
}

export async function signUp(
  email: string,
  password: string,
  _metadata?: Partial<UserMetadata>
): Promise<SignUpResult> {
  try {
    const { data, error } = await authClient.signUp.email({
      email,
      password,
      name: email,
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      const emailStatus: SignUpEmailStatus = msg.includes("already")
        ? "already_registered"
        : "unknown";
      return { user: null, session: null, error: friendlyError(error), emailStatus };
    }
    return {
      user: (data?.user as unknown as User) ?? null,
      session: null,
      error: null,
      emailStatus: "sent",
    };
  } catch (err) {
    return { user: null, session: null, error: err as Error, emailStatus: "unknown" };
  }
}

export async function resendSignupEmail(
  _email: string
): Promise<{ error: Error | null; emailStatus: SignUpEmailStatus }> {
  // Email verification is disabled (requireEmailVerification: false).
  // This is a no-op kept for UI compatibility.
  return { error: null, emailStatus: "sent" };
}

export async function signOut(): Promise<{ error: Error | null }> {
  try {
    const { error } = await authClient.signOut();
    return { error: error ? friendlyError(error) : null };
  } catch (err) {
    return { error: err as Error };
  }
}

export async function getUser(): Promise<User | null> {
  try {
    const { data } = await authClient.getSession();
    return (data?.user as unknown as User) ?? null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  try {
    const { data } = await authClient.getSession();
    return (data?.session as unknown as Session) ?? null;
  } catch {
    return null;
  }
}

export async function getUserRole(user?: User | null): Promise<"admin" | "user"> {
  if (user) return user.role === "admin" ? "admin" : "user";
  const u = await getUser();
  return u?.role === "admin" ? "admin" : "user";
}

// BetterAuth uses React hooks (useSession) for auth state changes.
// This stub satisfies callers in the context that expect an unsubscribe function.
export function onAuthStateChange(
  _callback: (event: string, session: Session | null) => void
): () => void {
  return () => {};
}

export async function updateUserMetadata(
  _updates: Partial<UserMetadata>
): Promise<{ user: User | null; error: Error | null }> {
  // Metadata updates go through admin API — not supported from client in this setup.
  return { user: null, error: new Error("updateUserMetadata requires server-side admin access") };
}

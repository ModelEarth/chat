"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AuthForm } from "@/components/auth-form";
import { DbStatusBanner } from "@/components/db-status-banner";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { useAuth } from "@/lib/auth/hooks";
import type { DbStatus } from "@/lib/auth/db-status";
import {
  ErrorCategory,
  ErrorSeverity,
  logAuthError,
} from "@/lib/errors/logger";

// Reused on both /login and /auth — the email/password half of sign-in,
// without the full-page chrome or post-login redirect that /login owns.
export function EmailPasswordSignIn({
  dbStatus,
  isVercel,
  showDivider = false,
}: {
  dbStatus: DbStatus;
  isVercel: boolean;
  // /auth renders this beneath social login buttons and needs a separator;
  // /login has nothing above it, so it omits this prop.
  showDivider?: boolean;
}) {
  const dbUnavailable = dbStatus !== "ok";
  const { signIn, loading, error, clearError, user } = useAuth();

  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Shown inline above the Email Address field rather than as a toast.
  const [formError, setFormError] = useState("");

  const getErrorMessage = useCallback((authError: string): string => {
    if (authError.includes("Invalid login credentials")) {
      return "Invalid email or password. Please try again.";
    }
    if (authError.includes("Email not confirmed")) {
      return "Please check your email and click the confirmation link.";
    }
    if (authError.includes("Too many requests")) {
      return "Too many login attempts. Please wait a moment and try again.";
    }
    if (authError.includes("Network")) {
      return "Network error. Please check your connection and try again.";
    }
    return "Login failed. Please try again.";
  }, []);

  useEffect(() => {
    if (error) {
      const userMessage = getErrorMessage(error);
      let errorCategory = ErrorCategory.LOGIN_FAILED;
      let severity = ErrorSeverity.ERROR;

      if (error.includes("Invalid login credentials") || error.includes("Email not confirmed")) {
        errorCategory = ErrorCategory.LOGIN_FAILED;
        severity = ErrorSeverity.WARNING;
      } else if (error.includes("Too many requests")) {
        errorCategory = ErrorCategory.API_RATE_LIMIT;
        severity = ErrorSeverity.WARNING;
      } else if (error.includes("Network")) {
        errorCategory = ErrorCategory.NETWORK_ERROR;
        severity = ErrorSeverity.ERROR;
      }

      logAuthError(
        errorCategory,
        `Login failed: ${error}`,
        { email, userMessage, originalError: error, timestamp: new Date().toISOString() },
        undefined,
        severity
      );

      setFormError(userMessage);
      setIsSubmitting(false);
    }
  }, [error, email, getErrorMessage]);

  useEffect(() => {
    return () => {
      if (error) clearError();
    };
  }, [error, clearError]);

  const handleSubmit = async (formData: FormData) => {
    const emailValue = formData.get("email") as string;
    const password = formData.get("password") as string;

    if (!emailValue || !password) {
      setFormError("Please enter both email and password.");
      return;
    }
    setFormError("");

    setEmail(emailValue);
    setIsSubmitting(true);
    clearError();

    try {
      await signIn(emailValue, password);
      setIsSuccessful(true);
      toast({ type: "success", description: "Successfully signed in!" });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown login error";
      logAuthError(
        ErrorCategory.LOGIN_FAILED,
        `Unexpected login error: ${errorMessage}`,
        { email: emailValue, error: errorMessage, stack: err instanceof Error ? err.stack : undefined, timestamp: new Date().toISOString() },
        undefined,
        ErrorSeverity.ERROR
      );
    }
  };

  // SocialLoginButtons already renders the loading spinner / signed-in
  // profile view above this — stay quiet in both states to avoid duplicates.
  if (loading || user) return null;

  return (
    <div className="flex w-full flex-col gap-4">
      {showDivider && (
        <div className="flex items-center gap-3 text-gray-400 text-xl dark:text-zinc-500">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      {/* The card wrapper matches the "copy keys" panel below it on /auth
          (rounded-lg border bg-muted/30 p-4) — showDivider doubles as "this
          is the /auth embedding" since /login has its own page-level card
          and doesn't need a nested one. */}
      <div className={showDivider ? "rounded-lg border border-border bg-muted/30 p-4" : ""}>
        <DbStatusBanner status={dbStatus} isVercel={isVercel} className="mx-4 mt-1.5 mb-4 sm:mx-16" />
        <div className={dbUnavailable ? "pointer-events-none select-none opacity-40" : ""}>
          {formError && (
            <p
              className="mx-4 mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 text-sm sm:mx-16 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
              role="alert"
            >
              {formError}
            </p>
          )}
          <AuthForm action={handleSubmit} defaultEmail={email}>
            <SubmitButton disabled={isSubmitting || loading || dbUnavailable} isSuccessful={isSuccessful}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </SubmitButton>
          </AuthForm>
        </div>
        {/* Outside the disabled/faded wrapper — navigating to /register
            doesn't touch the database, so it should stay clickable even
            when Supabase/POSTGRES_URL isn't configured or reachable. */}
        <p className="mt-4 px-4 text-center text-gray-600 text-sm sm:px-16 dark:text-zinc-400">
          {"Don't have an account? "}
          <Link className="font-semibold text-gray-800 hover:underline dark:text-zinc-200" href="/register">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

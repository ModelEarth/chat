import { Suspense } from "react";
import Link from "next/link";
import { PublicLayout } from "@/components/public-layout";
import { SocialLoginButtons } from "@/components/social-login-buttons";
import { EmailPasswordSignIn } from "@/components/email-password-signin";
import { LocalEnvKeyPanel } from "@/components/local-env-key-panel";
import { SupabaseKeyPanel } from "@/components/supabase-key-panel";
import { getConfiguredSocialProviders } from "@/lib/auth/social-providers";
import { getDbStatus } from "@/lib/auth/db-status";
import { isAuthRequired } from "@/lib/auth/server";
import { DeployInfo } from "@/components/deploy-info";

// The social sign-in setup steps, shown as a static README page
// (automation/index.html renders automation/README.md in the browser).
const SOCIAL_CONFIG_URL = "https://cloud.model.earth/automation/";

function getErrorMessage(error: string, provider?: string): string | null {
  if (error === "account_not_linked") {
    return "An account with this email already exists. Please sign in with your email and password instead.";
  }
  if (error === "provider_not_configured") {
    const name = provider ? `${provider.charAt(0).toUpperCase() + provider.slice(1)}` : "This provider";
    return `${name} login is not configured. Add ${provider?.toUpperCase()}_CLIENT_ID and ${provider?.toUpperCase()}_CLIENT_SECRET to your .env.local file and restart the server.`;
  }
  if (error) {
    return "Sign-in failed. Please try again.";
  }
  return null;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const { error, provider } = await searchParams;
  const errorMessage = error ? getErrorMessage(error, provider) : null;
  const configuredProviders = getConfiguredSocialProviders();
  const dbStatus = await getDbStatus();
  const isVercel = !!process.env.VERCEL;
  // REQUIRE_AUTH unset or false: chat works without an account.
  const accountOptional = !(await isAuthRequired());
  const hasSocial = configuredProviders.length > 0;

  return (
    <PublicLayout>
      <div className="flex flex-1 items-start justify-center p-[18px] pt-12 md:items-center md:pt-0 min-h-[60vh]">
        <div className="flex w-full max-w-2xl flex-col gap-6 px-4">
          <div className="flex flex-col items-center justify-center gap-2 pt-4 text-center">
            <h3 className="font-semibold text-xl dark:text-zinc-50">
              {accountOptional ? "Account Optional" : "Account"}
            </h3>
            <p className="text-gray-600 text-sm dark:text-zinc-300">
              Creating an account is optional. You can{" "}
              <Link className="underline underline-offset-2 hover:text-gray-900 dark:hover:text-zinc-50" href="/keys">
                paste LLM keys
              </Link>{" "}
              in your browser.
            </p>
            {hasSocial && (
              <p className="text-gray-500 text-sm dark:text-zinc-400">
                Sign in with any social account to save chat history and access team features.
              </p>
            )}
          </div>
          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {errorMessage}
            </div>
          )}
          {hasSocial ? (
            <Suspense
              fallback={
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              }
            >
              <SocialLoginButtons configuredProviders={configuredProviders} />
            </Suspense>
          ) : (
            <p className="text-center text-gray-500 text-sm dark:text-zinc-400">
              We haven't activated social auth.{" "}
              <a className="underline underline-offset-2 hover:text-gray-900 dark:hover:text-zinc-50" href={SOCIAL_CONFIG_URL}>
                About Config
              </a>
            </p>
          )}
          <EmailPasswordSignIn dbStatus={dbStatus} isVercel={isVercel} showDivider={hasSocial} />
          <SupabaseKeyPanel />
          <LocalEnvKeyPanel />
          <DeployInfo />
        </div>
      </div>
    </PublicLayout>
  );
}

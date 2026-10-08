import { Suspense } from "react";
import { PublicLayout } from "@/components/public-layout";
import { SocialLoginButtons } from "@/components/social-login-buttons";
import { EmailPasswordSignIn } from "@/components/email-password-signin";
import { LocalEnvKeyPanel } from "@/components/local-env-key-panel";
import { SupabaseKeyPanel } from "@/components/supabase-key-panel";
import { getConfiguredSocialProviders } from "@/lib/auth/social-providers";
import { getDbStatus } from "@/lib/auth/db-status";
import { DeployInfo } from "@/components/deploy-info";

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

  return (
    <PublicLayout>
      <div className="flex flex-1 items-start justify-center p-[18px] pt-12 md:items-center md:pt-0 min-h-[60vh]">
        <div className="flex w-full max-w-2xl flex-col gap-6 px-4">
          <div className="flex flex-col items-center justify-center gap-2 text-center">
            <h3 className="font-semibold text-xl dark:text-zinc-50">Account</h3>
            <p className="text-gray-500 text-sm dark:text-zinc-400">
              Sign in with any social account to save chat history and access team features.
            </p>
          </div>
          {errorMessage && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800 text-sm dark:border-red-800 dark:bg-red-950 dark:text-red-200">
              {errorMessage}
            </div>
          )}
          <Suspense
            fallback={
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            }
          >
            <SocialLoginButtons configuredProviders={configuredProviders} />
          </Suspense>
          <EmailPasswordSignIn dbStatus={dbStatus} isVercel={isVercel} showDivider />
          <SupabaseKeyPanel />
          <LocalEnvKeyPanel />
          <DeployInfo />
        </div>
      </div>
    </PublicLayout>
  );
}

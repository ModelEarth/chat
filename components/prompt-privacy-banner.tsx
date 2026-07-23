"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuthContext } from "@/lib/auth/context";
import { toast } from "@/components/toast";
import { apiKeyHelpers } from "@/lib/storage";

interface PromptPrivacyBannerProps {
  isEmailUser: boolean;
  hasSocialProviders: boolean;
}

export function PromptPrivacyBanner({ isEmailUser, hasSocialProviders }: PromptPrivacyBannerProps) {
  const { isAuthenticated, signOut } = useAuthContext();
  // undefined = not yet checked (avoids flash); false = no keys; true = has keys
  const [hasApiKey, setHasApiKey] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    setHasApiKey(apiKeyHelpers.getConfiguredProviders().length > 0);
  }, []);

  if (!isAuthenticated || !isEmailUser) return null;

  async function handleSignOut() {
    try {
      await signOut();
      toast({ type: "success", description: "Successfully signed out!" });
    } catch {
      toast({ type: "error", description: "Failed to sign out. Please try again." });
    }
  }

  return (
    <div className="w-full py-1 pl-[14px] text-left text-xs text-muted-foreground">
      <p>
        Your prompts are visible to site admins. To prompt privately,{" "}
        <button
          type="button"
          onClick={handleSignOut}
          className="cursor-pointer underline hover:no-underline focus-visible:outline-none"
        >
          sign out
        </button>{" "}
        or{" "}
        {hasSocialProviders ? (
          <Link href="/auth" className="underline hover:no-underline">
            use a social login
          </Link>
        ) : (
          <>
            use a social login{" "}
            <span className="opacity-60">(not yet implemented)</span>
          </>
        )}
        .
      </p>
      {hasApiKey === false && (
        <p className="mt-0.5">
          <Link href="/keys" className="underline hover:no-underline">
            Add your API Key
          </Link>
          {" "}— you can get a free Gemini key.
        </p>
      )}
    </div>
  );
}

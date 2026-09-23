"use client";

import { InfoIcon } from "@/components/icons";
import type { DbStatus } from "@/lib/auth/db-status";

const SETUP_GUIDE_URL =
  "https://github.com/modelearth/chat/blob/main/DEPLOYMENT_GUIDE.md#step-1--create-a-supabase-project";
const SUPABASE_DASHBOARD_URL = "https://supabase.com/dashboard/projects";

export function getDbStatusMessage(status: DbStatus, isVercel: boolean): string {
  if (status === "not-configured") {
    return isVercel
      ? "Activate by adding POSTGRES_URL to your Vercel environment variables."
      : "Activate by adding POSTGRES_URL to your local env file (see automation/paths.yaml).";
  }
  if (status === "unreachable") {
    return "Can't reach the database. If you're on Supabase's free tier, projects pause after about 14 days of inactivity — restart it from your Supabase dashboard.";
  }
  return "";
}

// Shared by EmailPasswordSignIn (/auth, /login) and /register so all three
// pages explain a down/unset database the same way, with the same fix-it
// link for each of the two distinct failure modes.
export function DbStatusBanner({
  status,
  isVercel,
  className = "",
}: {
  status: DbStatus;
  isVercel: boolean;
  className?: string;
}) {
  if (status === "ok") return null;

  const message = getDbStatusMessage(status, isVercel);
  const linkHref = status === "unreachable" ? SUPABASE_DASHBOARD_URL : SETUP_GUIDE_URL;
  const linkLabel = status === "unreachable" ? "Open Supabase dashboard" : "Get POSTGRES_URL from Supabase";

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 ${className}`}
    >
      <span>{message}</span>
      {status === "not-configured" && (
        <a
          href={SETUP_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 underline hover:opacity-80"
        >
          Supabase steps
        </a>
      )}
      <a
        href={linkHref}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={linkLabel}
        title={linkLabel}
        className="shrink-0 opacity-70 hover:opacity-100"
      >
        <InfoIcon size={14} />
      </a>
    </div>
  );
}

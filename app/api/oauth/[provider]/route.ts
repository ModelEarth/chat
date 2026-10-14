import { type NextRequest, NextResponse } from "next/server";
import { isAllowedRedirect } from "@/lib/auth/allowed-origins";

const VALID_PROVIDERS = new Set([
  "google",
  "github",
  "linkedin",
  "microsoft",
  "discord",
  "facebook",
]);

// GET /api/oauth/:provider?redirect=<url>
//
// Navigation-based OAuth proxy. Replaces the client-side fetch() approach in
// auth-modal.js, which fails in Chrome incognito because SameSite=None cookies
// set via cross-origin fetch responses are blocked. When the user navigates HERE
// first (top-level navigation), Better Auth sets the state cookie in a
// first-party context — no incognito cookie blocking.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const redirect = request.nextUrl.searchParams.get("redirect");

  if (!VALID_PROVIDERS.has(provider)) {
    return new NextResponse("Invalid provider", { status: 400 });
  }

  if (!redirect) {
    return new NextResponse("redirect parameter is required", { status: 400 });
  }

  let redirectOrigin: string;
  try {
    redirectOrigin = new URL(redirect).origin;
  } catch {
    return new NextResponse("Invalid redirect URL", { status: 400 });
  }

  if (!isAllowedRedirect(redirect, request.nextUrl.origin)) {
    return new NextResponse("Redirect URL not in allowed origins", {
      status: 403,
    });
  }

  const baseURL =
    process.env.BETTER_AUTH_BASE_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3700");

  let data: { url?: string };
  let authResponse: Response;
  try {
    authResponse = await fetch(`${baseURL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("cookie") ?? "",
        Origin: redirectOrigin,
      },
      body: JSON.stringify({
        provider,
        // Redirect through relay so session is read first-party before returning
        // to the original page. This avoids the cross-origin get-session fetch
        // that fails in Chrome incognito.
        callbackURL: `${baseURL}/api/oauth/relay?redirect=${encodeURIComponent(redirect)}`,
        disableRedirect: true,
      }),
    });
    data = await authResponse.json();
  } catch (err) {
    console.error("[OAuth proxy] internal fetch failed", err);
    return new NextResponse("OAuth initialization failed", { status: 500 });
  }

  if (!data.url) {
    console.error("[OAuth proxy] no URL from Better Auth", data);
    const errorUrl = new URL(redirect);
    const authPage = new URL("/auth", errorUrl.origin);
    authPage.searchParams.set("error", "provider_not_configured");
    authPage.searchParams.set("provider", provider);
    return NextResponse.redirect(authPage.toString());
  }

  const response = NextResponse.redirect(data.url);

  // Forward state cookies so the browser has them for the OAuth callback.
  const setCookies = authResponse.headers.getSetCookie?.() ??
    [authResponse.headers.get("set-cookie")].filter(Boolean) as string[];
  for (const cookie of setCookies) {
    response.headers.append("Set-Cookie", cookie);
  }

  return response;
}

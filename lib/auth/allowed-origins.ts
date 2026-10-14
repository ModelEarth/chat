// Origins that may use sign-in from the browser, and that sign-in may send
// people back to: ALLOWED_ORIGINS (comma-separated), or the local servers in
// development. 3700 = node server; 8887/8888/8889 = static webroot servers
// whose pages load the sign-in widget.
export function allowedOrigins(): string[] {
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
  }
  if (process.env.NODE_ENV !== "production") {
    return ["http://localhost:3700", "http://localhost:8887", "http://localhost:8888", "http://localhost:8889"];
  }
  return [];
}

// True when `redirect` is a URL on this site (`ownOrigin`) or an allowed origin.
// Anything else is refused, so sign-in can't hand a session or the user's
// details to another site.
export function isAllowedRedirect(redirect: string, ownOrigin: string): boolean {
  try {
    const { origin } = new URL(redirect);
    return origin === ownOrigin || allowedOrigins().includes(origin);
  } catch {
    return false;
  }
}

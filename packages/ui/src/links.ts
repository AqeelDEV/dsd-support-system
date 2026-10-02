/*
 * Helpers for the pages behind emailed links and for redirects after
 * signing in, shared by both apps.
 */

/**
 * Where to go after signing in: only a path on this site. Anything else
 * (another origin, `//evil.example`, a backslash trick) falls back, so the
 * sign-in page can't be used as an open redirect.
 */
export function safeNext(
  next: string | null | undefined,
  fallback = "/tickets",
): string {
  if (next === null || next === undefined) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  try {
    const url = new URL(next, "http://same.origin");
    return url.origin === "http://same.origin"
      ? `${url.pathname}${url.search}${url.hash}`
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The one-time token from an emailed link's fragment (`#token=…`). Tokens
 * travel in the fragment so they never reach a server log or a Referer.
 */
export function tokenFromHash(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("token");
  return token !== null && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? token
    : undefined;
}

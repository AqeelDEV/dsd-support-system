/*
 * The pages' Content Security Policy (NFR-7, ADR-0013). Scripts run only
 * with this response's nonce: Next.js reads the nonce from the request's
 * CSP header and puts it on every script it renders, and `'strict-dynamic'`
 * lets those scripts load the app's chunks. An injected <script> or inline
 * handler has no nonce and never runs.
 *
 * Styles allow inline: React writes `style` attributes (chart bars, table
 * alignment) and the dev overlay injects <style>. Style injection can't run
 * code, and a nonce can't cover attributes, so this is the usual trade.
 */

/** A fresh nonce: 16 random bytes, base64. */
export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * @param {{ nonce: string, dev?: boolean }} options `dev` adds
 *   `'unsafe-eval'`, which React needs in development only.
 */
export function contentSecurityPolicy({ nonce, dev = false }) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];
  return directives.join("; ");
}

/**
 * Pages whose URL fragment carries a one-time token (emailed links). The
 * fragment never leaves the browser, but these pages still send no
 * referrer at all, so nothing about them reaches another site.
 */
export const TOKEN_PAGES = Object.freeze([
  "/access",
  "/signup/complete",
  "/reset-password",
  "/invite",
]);

/**
 * The matcher for each app's proxy: every page, and nothing under /api/
 * (whose responses keep the API's own headers, ADR-0011, section 9), the
 * build's static files or the health check.
 */
export const PAGE_MATCHER =
  "/((?!api/|_next/static|_next/image|healthz|icon[.]svg|favicon[.]ico).*)";

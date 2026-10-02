import {
  contentSecurityPolicy,
  createNonce,
  TOKEN_PAGES,
} from "@dsd/config/next/csp";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Gives every page a fresh script nonce (ADR-0013). Next.js reads the nonce
 * from the request's CSP header and puts it on the scripts it renders; the
 * browser gets the same policy on the response.
 */
export function proxy(request: NextRequest): NextResponse {
  const policy = contentSecurityPolicy({
    nonce: createNonce(),
    dev: process.env.NODE_ENV === "development",
  });
  const headers = new Headers(request.headers);
  headers.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  if (TOKEN_PAGES.includes(request.nextUrl.pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

export const config = {
  // Must be a literal for Next.js to read it at build time; a unit test
  // checks it equals PAGE_MATCHER from @dsd/config/next/csp.
  matcher: [
    "/((?!api/|_next/static|_next/image|healthz|icon[.]svg|favicon[.]ico).*)",
  ],
};

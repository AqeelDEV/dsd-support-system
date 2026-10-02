/** A fresh nonce: 16 random bytes, base64. */
export function createNonce(): string;

/** The pages' Content Security Policy for one response. */
export function contentSecurityPolicy(options: {
  nonce: string;
  dev?: boolean;
}): string;

/** Pages reached from an emailed link with a token in the fragment. */
export const TOKEN_PAGES: readonly string[];

/** The proxy matcher: every page, nothing under /api/. */
export const PAGE_MATCHER: string;

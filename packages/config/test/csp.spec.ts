import { describe, expect, it } from "vitest";

import {
  contentSecurityPolicy,
  createNonce,
  PAGE_MATCHER,
} from "../next/csp.js";

describe("contentSecurityPolicy", () => {
  it("lets scripts run only with the response's nonce", () => {
    const policy = contentSecurityPolicy({ nonce: "abc123" });
    expect(policy).toContain(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic'",
    );
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("keeps the framing, plugin, base and form rules", () => {
    const policy = contentSecurityPolicy({ nonce: "n" });
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(policy).toContain(directive);
    }
  });

  it("adds unsafe-eval in development only", () => {
    expect(contentSecurityPolicy({ nonce: "n", dev: true })).toContain(
      "'unsafe-eval'",
    );
  });
});

describe("createNonce", () => {
  it("is 16 random bytes in base64, new every time", () => {
    const first = createNonce();
    expect(first).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(first);
  });
});

describe("PAGE_MATCHER", () => {
  const matches = (path: string) => new RegExp(`^${PAGE_MATCHER}$`).test(path);

  it("covers pages", () => {
    for (const path of ["/", "/help/reset-router", "/access", "/tickets/1"]) {
      expect(matches(path)).toBe(true);
    }
  });

  it("skips the API proxy, static files and the health check", () => {
    for (const path of [
      "/api/v1/customer/tickets",
      "/_next/static/chunks/a.js",
      "/healthz",
      "/icon.svg",
    ]) {
      expect(matches(path)).toBe(false);
    }
  });
});

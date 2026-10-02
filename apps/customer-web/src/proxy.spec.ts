import { PAGE_MATCHER } from "@dsd/config/next/csp";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

describe("page proxy", () => {
  it("uses the shared matcher, so /api/ keeps the API's own headers", () => {
    expect(config.matcher).toEqual([PAGE_MATCHER]);
  });

  it("sends a nonce-based policy, different for every response", () => {
    const first = proxy(new NextRequest("http://app.test/"));
    const second = proxy(new NextRequest("http://app.test/"));
    const policy = first.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  it("hands the same policy to Next.js on the request, for the nonce", () => {
    const response = proxy(new NextRequest("http://app.test/"));
    expect(
      response.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(response.headers.get("content-security-policy"));
  });

  it("sends no referrer from a page reached by an emailed token link", () => {
    expect(
      proxy(new NextRequest("http://app.test/access")).headers.get(
        "referrer-policy",
      ),
    ).toBe("no-referrer");
    expect(
      proxy(new NextRequest("http://app.test/")).headers.get("referrer-policy"),
    ).toBeNull();
  });
});

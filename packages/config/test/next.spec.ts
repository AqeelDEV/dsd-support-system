import { describe, expect, it } from "vitest";

import { createNextConfig, pageHeaders } from "../next/index.js";

const names = (headers: readonly { key: string }[]) =>
  headers.map((header) => header.key);

describe("page headers", () => {
  it("send HSTS from production builds, for a year and every subdomain", () => {
    expect(pageHeaders("production")).toContainEqual({
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    });
  });

  it("leave HSTS out of `next dev` and tests", () => {
    expect(names(pageHeaders("development"))).not.toContain(
      "Strict-Transport-Security",
    );
    expect(names(pageHeaders("test"))).not.toContain(
      "Strict-Transport-Security",
    );
  });

  it("always forbid framing and sniffing", () => {
    for (const env of ["production", "development"]) {
      expect(names(pageHeaders(env))).toEqual(
        expect.arrayContaining([
          "X-Frame-Options",
          "X-Content-Type-Options",
          "Referrer-Policy",
          "Permissions-Policy",
        ]),
      );
    }
  });

  it("apply to pages only, never to the API's responses through the proxy", async () => {
    const config = createNextConfig({ appDir: "/repo/apps/web" });
    const rules = (await config.headers?.()) ?? [];
    expect(rules.map((rule) => rule.source)).toEqual(["/:path((?!api/).*)"]);
  });
});

import { describe, expect, it } from "vitest";

import { requestPath } from "./url.js";

describe("requestPath", () => {
  it("drops the query string", () => {
    expect(requestPath("/api/v1/kb/articles?q=refund+card")).toBe(
      "/api/v1/kb/articles",
    );
    expect(requestPath("/health")).toBe("/health");
  });
});

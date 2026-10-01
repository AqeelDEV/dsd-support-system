import { describe, expect, it } from "vitest";

import { SLUG_PATTERN } from "./requests.js";
import { slugify } from "./slug.js";

describe("slugify", () => {
  it.each([
    ["Reset your router", "reset-your-router"],
    ["  Billing & Refunds!  ", "billing-refunds"],
    ["Café crème", "cafe-creme"],
    ["Wi-Fi -- 5 GHz", "wi-fi-5-ghz"],
    ["???", "article"],
  ])("turns %j into %j", (text, slug) => {
    expect(slugify(text, "article")).toBe(slug);
  });

  it("stays within 100 characters and never ends with a hyphen", () => {
    const slug = slugify(`${"a".repeat(99)} b`, "article");
    expect(slug).toBe("a".repeat(99));
    expect(slug).toMatch(SLUG_PATTERN);
  });
});

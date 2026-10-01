import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email.js";

describe("normalizeEmail", () => {
  it("trims and lowercases, so one inbox is one identity", () => {
    expect(normalizeEmail("  Ana.Silva@Example.COM \t")).toBe(
      "ana.silva@example.com",
    );
  });

  it("leaves a normalised address unchanged", () => {
    expect(normalizeEmail("ana@example.com")).toBe("ana@example.com");
  });
});

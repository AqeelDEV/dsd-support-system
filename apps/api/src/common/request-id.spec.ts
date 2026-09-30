import { describe, expect, it } from "vitest";

import { resolveRequestId } from "./request-id.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("resolveRequestId", () => {
  it("keeps a caller's UUID, lowercased", () => {
    expect(resolveRequestId("0199A1B2-0000-7000-8000-00000000ABCD")).toBe(
      "0199a1b2-0000-7000-8000-00000000abcd",
    );
  });

  it("uses the first value when the header repeats", () => {
    expect(
      resolveRequestId([
        "0199a1b2-0000-7000-8000-000000000001",
        "0199a1b2-0000-7000-8000-000000000002",
      ]),
    ).toBe("0199a1b2-0000-7000-8000-000000000001");
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not a UUID", "abc"],
    ["log injection", '0199a1b2-0000-7000-8000-000000000001\n{"level":60}'],
    ["oversized", "a".repeat(10_000)],
  ])("replaces a %s header with a fresh UUID", (_label, header) => {
    const id = resolveRequestId(header);
    expect(id).toMatch(UUID);
    expect(id).not.toBe(header);
  });

  it("generates a different ID each time", () => {
    expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
  });
});

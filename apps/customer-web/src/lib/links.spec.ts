import { describe, expect, it } from "vitest";

import { safeNext, tokenFromHash } from "./links";

describe("safeNext", () => {
  it.each([
    ["/tickets/123", "/tickets/123"],
    ["/help?q=router#top", "/help?q=router#top"],
  ])("keeps a path on this site: %s", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });

  it.each([
    "https://evil.example/",
    "//evil.example/path",
    "/\\evil.example",
    "javascript:alert(1)",
    "tickets",
    "",
  ])("refuses %s", (next) => {
    expect(safeNext(next)).toBe("/tickets");
  });

  it("falls back when there is no next", () => {
    expect(safeNext(null, "/")).toBe("/");
  });
});

describe("tokenFromHash", () => {
  const token = "a".repeat(43);

  it("reads a well-formed token from the fragment", () => {
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
  });

  it.each(["", "#", "#token=short", `#other=${token}`, `#token=${token}!`])(
    "rejects %s",
    (hash) => {
      expect(tokenFromHash(hash)).toBeUndefined();
    },
  );
});

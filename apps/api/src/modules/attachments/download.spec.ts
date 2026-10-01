import { describe, expect, it } from "vitest";

import { contentDisposition } from "./download.js";

describe("contentDisposition (ADR-0009, section 4)", () => {
  it("always asks for a download, with the name percent-encoded as UTF-8", () => {
    expect(contentDisposition("hub log.txt")).toBe(
      "attachment; filename*=UTF-8''hub%20log.txt",
    );
    expect(contentDisposition("café.pdf")).toBe(
      "attachment; filename*=UTF-8''caf%C3%A9.pdf",
    );
  });

  it("encodes the characters that would end or break the parameter", () => {
    expect(contentDisposition(`a"b';c(1)*.png`)).toBe(
      "attachment; filename*=UTF-8''a%22b%27%3Bc%281%29%2A.png",
    );
  });
});

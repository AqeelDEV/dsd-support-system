import { describe, expect, it } from "vitest";

import { cleanFilename } from "./filename.js";

describe("cleanFilename (ADR-0009, section 2)", () => {
  it("keeps an ordinary name as it is", () => {
    expect(cleanFilename("router-log 2026-10-01.txt")).toBe(
      "router-log 2026-10-01.txt",
    );
  });

  it.each([
    ["../../etc/passwd", "passwd"],
    ["C:\\fakepath\\receipt.pdf", "receipt.pdf"],
    ["/var/tmp/photo.png", "photo.png"],
  ])("keeps only the last path segment of %s", (raw, cleaned) => {
    expect(cleanFilename(raw)).toBe(cleaned);
  });

  it("removes control characters and invisible formatting", () => {
    expect(cleanFilename("bad\u0000name\r\n.txt")).toBe("badname.txt");
    // A right-to-left override would make "invoice\u202Efdp.exe" look like a PDF.
    expect(cleanFilename("invoice\u202Efdp.exe")).toBe("invoicefdp.exe");
  });

  it.each([undefined, "", "   ", ".", "..", "dir/", "\u202E"])(
    "falls back to a neutral name for %j",
    (raw) => {
      expect(cleanFilename(raw)).toBe("attachment");
    },
  );

  it("cuts a long name to 255 bytes and keeps its extension", () => {
    const cleaned = cleanFilename(`${"a".repeat(400)}.pdf`);
    expect(Buffer.byteLength(cleaned)).toBe(255);
    expect(cleaned.endsWith(".pdf")).toBe(true);
  });

  it("never cuts a character in half", () => {
    const cleaned = cleanFilename(`${"é".repeat(200)}.txt`);
    expect(Buffer.byteLength(cleaned)).toBeLessThanOrEqual(255);
    expect(cleaned).toBe(`${"é".repeat(125)}.txt`);
    expect(cleanFilename("😀".repeat(100))).toBe("😀".repeat(63));
  });
});

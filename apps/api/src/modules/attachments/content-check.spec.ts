import { describe, expect, it } from "vitest";

import { FILES } from "../../../test/support/files.js";
import { checkContent, isPlainText } from "./content-check.js";

describe("checkContent (ADR-0009, section 1)", () => {
  it.each([
    ["a PNG", FILES.png, "image/png"],
    ["a JPEG", FILES.jpeg, "image/jpeg"],
    ["a GIF", FILES.gif, "image/gif"],
    ["a WebP image", FILES.webp, "image/webp"],
    ["a PDF", FILES.pdf, "application/pdf"],
    ["a UTF-8 log", FILES.log, "text/plain; charset=utf-8"],
  ])("accepts %s as %s", async (_name, bytes, contentType) => {
    expect(await checkContent(bytes)).toEqual({ accepted: true, contentType });
  });

  it.each([
    ["a Windows executable", FILES.exe],
    ["an ELF binary", FILES.elf],
    ["a zip archive", FILES.zip],
    ["text with NUL bytes", FILES.textWithNul],
    ["text that isn't UTF-8", FILES.latin1],
    ["text with terminal escapes", FILES.textWithEscape],
    ["an empty file", Buffer.alloc(0)],
  ])("refuses %s", async (_name, bytes) => {
    expect((await checkContent(bytes)).accepted).toBe(false);
  });

  it("names the detected type when it refuses a known format", async () => {
    expect(await checkContent(FILES.exe)).toEqual({
      accepted: false,
      reason: "it is application/x-msdownload, which isn't accepted",
    });
  });

  it.each([
    ["SVG", FILES.svg],
    ["HTML", FILES.html],
  ])(
    "lets %s in only as plain text, which browsers don't render",
    async (_name, bytes) => {
      expect(await checkContent(bytes)).toEqual({
        accepted: true,
        contentType: "text/plain; charset=utf-8",
      });
    },
  );
});

describe("isPlainText", () => {
  it("allows tabs, line feeds and carriage returns, and nothing else below space", () => {
    expect(isPlainText(Buffer.from("a\tb\r\nc\n"))).toBe(true);
    for (const code of [0x00, 0x07, 0x0b, 0x0c, 0x1b, 0x7f]) {
      expect(isPlainText(Buffer.from([0x61, code, 0x62]))).toBe(false);
    }
  });

  it("refuses C1 control characters", () => {
    expect(isPlainText(Buffer.from("a\u0085b"))).toBe(false);
  });
});

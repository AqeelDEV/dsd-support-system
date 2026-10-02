import { describe, expect, it } from "vitest";

import { isSafeUrl, parseMarkdown, sanitizeMarkdown } from "./markdown.js";

describe("isSafeUrl", () => {
  it.each([
    "https://help.dsd.example/billing",
    "http://example.com",
    "mailto:support@dsd.example",
    "/kb/articles/refunds",
    "#step-2",
    "refunds",
    "?q=router",
    "HTTPS://EXAMPLE.COM",
  ])("allows %s", (url) => {
    expect(isSafeUrl(url)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "java\tscript:alert(1)",
    " javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox",
    "file:///etc/passwd",
  ])("refuses %j", (url) => {
    expect(isSafeUrl(url)).toBe(false);
  });
});

describe("sanitizeMarkdown", () => {
  it("leaves ordinary markdown byte for byte as written", () => {
    const article = [
      "# Resetting your router",
      "",
      "Hold the **reset** button for _ten_ seconds. See [the guide](https://help.dsd.example/router).",
      "",
      "1. Unplug it",
      "2. Wait 30 s",
      "",
      "| Light | Meaning |",
      "| ----- | ------- |",
      "| Green | Online  |",
      "",
      "```sh",
      'echo "<script>not html in code</script>"',
      "```",
      "",
      "Use `a < b` and 3 > 2 freely, and mail support@dsd.example.",
      "",
      "![Diagram](/images/router.png)",
      "",
      "[ref]: https://help.dsd.example/ref",
      "",
    ].join("\n");
    expect(sanitizeMarkdown(article)).toBe(article);
  });

  it("removes script blocks and inline HTML", () => {
    expect(
      sanitizeMarkdown("Before\n\n<script>alert(1)</script>\n\nAfter"),
    ).toBe("Before\n\n\n\nAfter");
    expect(sanitizeMarkdown('Click <b onclick="x()">here</b> now')).toBe(
      "Click here now",
    );
    expect(sanitizeMarkdown("Text <!-- hidden --> more")).toBe("Text  more");
    expect(sanitizeMarkdown("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("keeps an unsafe link's text and drops its destination", () => {
    expect(sanitizeMarkdown("Go [here](javascript:alert(1)) now")).toBe(
      "Go here now",
    );
    expect(sanitizeMarkdown("[x](java&#x09;script:alert(1))")).toBe("x");
    expect(sanitizeMarkdown("<javascript:alert(1)>")).toBe(
      "javascript:alert(1)",
    );
  });

  it("removes images and definitions with an unsafe URL", () => {
    expect(
      sanitizeMarkdown("A ![pic](data:image/svg+xml;base64,PHN2Zz4=) B"),
    ).toBe("A  B");
    expect(
      sanitizeMarkdown("[click][evil]\n\n[evil]: javascript:alert(1)\n"),
    ).toBe("[click][evil]\n\n\n");
  });

  it("removes HTML that an unsafe link's text exposes", () => {
    expect(sanitizeMarkdown("[<b>bold</b>](javascript:x)")).toBe("bold");
  });

  it("removes the search snippet markers", () => {
    expect(sanitizeMarkdown("a\uE000b\uE001c")).toBe("abc");
  });
});

describe("parseMarkdown", () => {
  it("parses GFM, so tables and strikethrough reach the renderer as nodes", () => {
    const tree = parseMarkdown("| a |\n| - |\n| b |\n\n~~old~~");
    expect(tree.children.map((node) => node.type)).toEqual([
      "table",
      "paragraph",
    ]);
    const paragraph = tree.children[1];
    expect(paragraph?.type === "paragraph" && paragraph.children[0]?.type).toBe(
      "delete",
    );
  });
});

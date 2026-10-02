import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

const render = (source: string) =>
  renderToStaticMarkup(<Markdown source={source} />);

describe("Markdown", () => {
  it("renders ordinary markdown as elements, headings starting at h2", () => {
    const html = render(
      "# Title\n\nSome **bold** and *soft* text.\n\n- one\n- two",
    );
    expect(html).toContain("<h2");
    expect(html).toContain("<strong");
    expect(html).toContain("<em>soft</em>");
    expect(html).toMatch(/<ul[^>]*><li[^>]*>.*one/);
  });

  it("shows raw HTML as text, never as markup", () => {
    const html = render(
      'Hello <script>alert(1)</script> <img src=x onerror="alert(2)">',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,<b>x</b>",
    "vbscript:msgbox(1)",
  ])("keeps the text of a link to %s but drops its destination", (url) => {
    const html = render(`[click me](${url.replace("\t", "&#x09;")})`);
    expect(html).toContain("click me");
    expect(html).not.toContain("<a");
  });

  it("checks reference-style links against their definition", () => {
    const html = render(
      "[bad][x] and [good][y]\n\n[x]: javascript:alert(1)\n[y]: https://example.com/help",
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="https://example.com/help"');
  });

  it("opens external links safely and keeps relative ones in the tab", () => {
    expect(render("[docs](https://example.com)")).toContain(
      'rel="noopener noreferrer nofollow"',
    );
    expect(render("[article](/help/reset)")).not.toContain("target=");
  });

  it("drops unsafe images and turns external ones into links", () => {
    expect(render("![x](javascript:alert(1))")).not.toMatch(/<img|<a/);
    const external = render("![Router lights](https://cdn.example.com/a.png)");
    expect(external).not.toContain("<img");
    expect(external).toContain("Image: Router lights");
    expect(render("![Diagram](/images/a.png)")).toContain(
      '<img src="/images/a.png" alt="Diagram"',
    );
  });

  it("renders GFM tables", () => {
    const html = render(
      "| Light | Meaning |\n| --- | --- |\n| Red | Offline |",
    );
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("Offline");
  });
});

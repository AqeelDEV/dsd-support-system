import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SuggestionDraft } from "./suggestion-draft";

const render = (provider: string, model: string, draft: string) =>
  renderToStaticMarkup(
    <SuggestionDraft suggestion={{ provider, model, draft }} />,
  );

describe("SuggestionDraft", () => {
  it("labels the offline mock's draft as a mock, not an AI model", () => {
    const html = render(
      "mock",
      "mock-grounded-v1",
      "Refunds take 3 to 5 working days.",
    );
    expect(html).toContain("Mock draft");
    expect(html).toContain("not an AI model");
    expect(html).not.toContain("Drafted by");
  });

  it("names a real provider's model, and never calls it a mock", () => {
    const html = render(
      "gemini",
      "gemini-3.5-flash-lite",
      "Refunds take 3 to 5 working days.",
    );
    expect(html).toContain("Drafted by gemini-3.5-flash-lite");
    expect(html).not.toContain("Mock draft");
  });

  it("shows markup in a draft as text, so nothing in it can run", () => {
    const html = render(
      "gemini",
      "gemini-3.5-flash-lite",
      `Hi <img src=x onerror="alert(1)"><script>alert(2)</script> <a href="javascript:alert(3)">here</a>`,
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(html).not.toMatch(/<img|<script|<a /);
  });
});

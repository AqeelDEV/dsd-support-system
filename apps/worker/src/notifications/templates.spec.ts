import { describe, expect, it } from "vitest";

import { escapeHtml, renderTemplate, TEMPLATES } from "./templates.js";

const HOSTILE = `<script>alert("x")</script> & 'quotes'`;

describe("escapeHtml", () => {
  it("escapes everything that matters in element content and attributes", () => {
    expect(escapeHtml(HOSTILE)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quotes&#39;",
    );
  });
});

describe("email templates", () => {
  const link = {
    kind: "guest" as const,
    url: `https://help.example/access#token=${"a".repeat(43)}`,
  };

  it("escape every value they put in HTML, the reply text included", () => {
    const rendered = renderTemplate("agentReply", {
      brandName: HOSTILE,
      reference: "DSD-000042",
      subject: HOSTILE,
      agentName: HOSTILE,
      reply: `${HOSTILE}\nSecond line`,
      newStatus: "pending_customer",
      link: { kind: "account", url: `https://help.example/"><script>` },
    });
    expect(rendered.html).not.toContain("<script>");
    // A quote can't close the link's href attribute.
    expect(rendered.html).toContain(
      'href="https://help.example/&quot;&gt;&lt;script&gt;"',
    );
    expect(rendered.html).toContain("&lt;script&gt;");
    expect(rendered.html).toContain("Second line");
    // Line breaks in a reply survive as <br>, the only markup added to it.
    expect(rendered.html).toContain("&#39;quotes&#39;<br>Second line");
    // The plain-text part keeps the reply as written, quoted.
    expect(rendered.text).toContain(`> ${HOSTILE}`);
  });

  it("keep subjects to one line, so a value can't add a header", () => {
    const rendered = renderTemplate("ticketReceived", {
      brandName: "DSD",
      reference: "DSD-000042",
      subject: "Hello\r\nBcc: attacker@example.com",
      link,
    });
    expect(rendered.subject).not.toMatch(/[\r\n]/);
  });

  it("have no field an internal note could arrive in", () => {
    // Only the reply template carries message text, and only in `reply`,
    // which handlers fill from public agent replies.
    const fieldsWithText = Object.keys(TEMPLATES).filter((name) =>
      name.toLowerCase().includes("note"),
    );
    expect(fieldsWithText).toEqual([]);
  });

  it("say how long a link lasts and that guest links shouldn't be forwarded", () => {
    const guest = renderTemplate("guestLink", {
      brandName: "DSD",
      reference: "DSD-000042",
      subject: "Router",
      link,
    });
    expect(guest.text).toContain("works for 7 days");
    expect(guest.text).toContain("Don't forward this email");
    expect(
      renderTemplate("passwordReset", { brandName: "DSD", link: "https://x" })
        .text,
    ).toContain("lasts an hour");
  });
});

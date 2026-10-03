import { describe, expect, it } from "vitest";

import { QUERY_MAX_CHARS, retrievalQuery } from "./query.js";

describe("retrievalQuery", () => {
  it("puts the subject first, then the customer's latest messages, newest first, then the description", () => {
    expect(
      retrievalQuery({
        subject: "Refund missing",
        description: "I returned my camera two weeks ago.",
        customerMessages: ["First follow-up", "Second", "Still nothing today"],
      }),
    ).toBe(
      "Refund missing\nStill nothing today\nSecond\nI returned my camera two weeks ago.",
    );
  });

  it("cuts a long ticket to a fixed length", () => {
    const query = retrievalQuery({
      subject: "Long",
      description: "word ".repeat(1_000),
      customerMessages: [],
    });
    expect(query).toHaveLength(QUERY_MAX_CHARS);
    expect(query.startsWith("Long\n")).toBe(true);
  });
});

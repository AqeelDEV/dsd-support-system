import { describe, expect, it } from "vitest";

import {
  aiSuggestionFeedbackRequestSchema,
  aiSuggestionListQuerySchema,
} from "./suggestions.js";

describe("AI suggestion request schemas", () => {
  it("takes a rating with an optional, trimmed comment", () => {
    expect(aiSuggestionFeedbackRequestSchema.parse({ rating: "up" })).toEqual({
      rating: "up",
    });
    expect(
      aiSuggestionFeedbackRequestSchema.parse({
        rating: "down",
        comment: "  Cites the wrong article  ",
      }).comment,
    ).toBe("Cites the wrong article");
  });

  it("refuses other ratings, unknown fields, long comments and NUL characters", () => {
    for (const body of [
      { rating: "meh" },
      { rating: "up", suggestionId: "x" },
      { rating: "up", comment: "x".repeat(1_001) },
      { rating: "up", comment: "a\u0000b" },
    ]) {
      expect(aiSuggestionFeedbackRequestSchema.safeParse(body).success).toBe(
        false,
      );
    }
  });

  it("pages a ticket's suggestions five at a time by default, at most twenty", () => {
    expect(aiSuggestionListQuerySchema.parse({})).toEqual({ limit: 5 });
    expect(aiSuggestionListQuerySchema.parse({ limit: "20" }).limit).toBe(20);
    expect(aiSuggestionListQuerySchema.safeParse({ limit: "21" }).success).toBe(
      false,
    );
    expect(
      aiSuggestionListQuerySchema.safeParse({ status: "ready" }).success,
    ).toBe(false);
  });
});

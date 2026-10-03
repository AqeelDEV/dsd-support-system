import { describe, expect, it } from "vitest";

import {
  isGrounded,
  thresholdsFor,
  UNTUNED_VECTOR_THRESHOLD,
} from "./confidence.js";

const thresholds = {
  minVectorSimilarity: 0.3,
  minKeywordRank: 0.1,
  minMatchedTerms: 3,
};

describe("the confidence gate", () => {
  it("passes when the closest chunk is similar enough", () => {
    expect(
      isGrounded(
        { topVectorScore: 0.31, topKeywordScore: null, topMatchedTerms: null },
        thresholds,
      ),
    ).toBe(true);
  });

  it("passes on a strong keyword match that contains enough of the ticket's words", () => {
    expect(
      isGrounded(
        { topVectorScore: 0.1, topKeywordScore: 0.2, topMatchedTerms: 3 },
        thresholds,
      ),
    ).toBe(true);
  });

  it("refuses a keyword match on too few words, however highly it ranks", () => {
    expect(
      isGrounded(
        { topVectorScore: null, topKeywordScore: 0.9, topMatchedTerms: 2 },
        thresholds,
      ),
    ).toBe(false);
  });

  it("refuses when nothing clears its bar, or nothing was found", () => {
    expect(
      isGrounded(
        { topVectorScore: 0.29, topKeywordScore: 0.05, topMatchedTerms: 5 },
        thresholds,
      ),
    ).toBe(false);
    expect(
      isGrounded(
        { topVectorScore: null, topKeywordScore: null, topMatchedTerms: null },
        thresholds,
      ),
    ).toBe(false);
  });

  it("uses each embedding model's own tuned bar, and a cautious one for others", () => {
    expect(thresholdsFor("mock-hash-v1").minVectorSimilarity).toBe(0.3);
    expect(thresholdsFor("some-new-model").minVectorSimilarity).toBe(
      UNTUNED_VECTOR_THRESHOLD,
    );
    expect(
      thresholdsFor("mock-hash-v1", { minVectorSimilarity: 0.5 })
        .minVectorSimilarity,
    ).toBe(0.5);
  });
});

import { describe, expect, it } from "vitest";

import { hashEmbedding, MockEmbeddingModel, terms } from "./mock-embeddings.js";

const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

describe("mock embeddings", () => {
  it("gives every text a 1,024-dimension vector of length 1", () => {
    for (const text of ["My refund hasn't arrived", "", "the and of"]) {
      const vector = hashEmbedding(text);
      expect(vector).toHaveLength(1024);
      expect(Math.hypot(...vector)).toBeCloseTo(1, 10);
    }
  });

  it("is deterministic", () => {
    expect(hashEmbedding("Camera offline at night")).toEqual(
      hashEmbedding("Camera offline at night"),
    );
  });

  it("drops filler words and folds word forms together", () => {
    expect(terms("The refunds were refunded, and I'm refunding it")).toEqual(
      terms("refund refund refund"),
    );
    expect(terms("charged charging charge")).toEqual([
      "charg",
      "charg",
      "charg",
    ]);
  });

  it("puts texts that share words closer together than unrelated ones", () => {
    const query = hashEmbedding("When will my refund reach my card?");
    const related = hashEmbedding(
      "Refunds go back to the card you paid with within 3 to 5 working days.",
    );
    const unrelated = hashEmbedding(
      "Hold the button on the plug until the light flashes blue to pair it.",
    );
    expect(cosine(query, related)).toBeGreaterThan(0.2);
    expect(cosine(query, related)).toBeGreaterThan(
      cosine(query, unrelated) + 0.2,
    );
  });

  it("embeds documents with their title, one vector per document", async () => {
    const model = new MockEmbeddingModel("mock-hash-v1");
    const [withTitle] = await model.embedDocuments([
      { title: "Track your delivery", text: "Tracking can take 24 hours." },
    ]);
    expect(withTitle).toEqual(
      hashEmbedding("Track your delivery\nTracking can take 24 hours."),
    );
    expect(await model.embedQuery("tracking")).toEqual(
      hashEmbedding("tracking"),
    );
  });
});

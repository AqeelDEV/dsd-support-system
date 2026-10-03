import { describe, expect, it } from "vitest";

import { CHUNK_TOKENS, chunkArticle, OVERLAP_TOKENS } from "./chunker.js";

describe("chunkArticle", () => {
  it("splits an article at its headings, with each chunk's heading path", () => {
    const chunks = chunkArticle({
      title: "How long refunds take",
      bodyMarkdown: `Refunds go back to the card you paid with.

## When we issue the refund

Cancelled orders are refunded at once.

## When you see the money

### Card payments

Most banks take 3 to 5 working days.

## It has been longer

Contact support.`,
    });
    expect(chunks.map((chunk) => [chunk.headingPath, chunk.content])).toEqual([
      ["How long refunds take", "Refunds go back to the card you paid with."],
      [
        "How long refunds take > When we issue the refund",
        "Cancelled orders are refunded at once.",
      ],
      [
        "How long refunds take > When you see the money > Card payments",
        "Most banks take 3 to 5 working days.",
      ],
      ["How long refunds take > It has been longer", "Contact support."],
    ]);
    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2, 3]);
    expect(chunks[0]?.tokenCount).toBe(Math.ceil(42 / 4));
  });

  it("ignores heading-like lines inside code blocks", () => {
    const chunks = chunkArticle({
      title: "Logs",
      bodyMarkdown: "## Collect logs\n\n```\n# not a heading\n```",
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toContain("# not a heading");
  });

  it("cuts a long section into overlapping windows of about 400 tokens", () => {
    const words = Array.from({ length: 900 }, (_, index) => `word${index}`);
    const chunks = chunkArticle({
      title: "Long",
      bodyMarkdown: `## Everything\n\n${words.join(" ")}`,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(CHUNK_TOKENS + 5);
      expect(chunk.headingPath).toBe("Long > Everything");
    }
    // Consecutive windows share their edge, and together hold every word.
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]?.content.split(" ") ?? [];
      const current = chunks[index]?.content.split(" ") ?? [];
      const shared = previous.filter((word) => current.includes(word));
      expect(shared.join(" ").length).toBeGreaterThanOrEqual(
        OVERLAP_TOKENS * 4 - 20,
      );
    }
    const all = new Set(chunks.flatMap((chunk) => chunk.content.split(" ")));
    expect(words.every((word) => all.has(word))).toBe(true);
  });

  it("gives the same chunks for the same article every time", () => {
    const article = {
      title: "T",
      bodyMarkdown: "## A\n\nOne.\n\n## B\n\nTwo.",
    };
    expect(chunkArticle(article)).toEqual(chunkArticle(article));
  });

  it("still gives an article of headings alone one chunk", () => {
    expect(
      chunkArticle({
        title: "Coming soon",
        bodyMarkdown: "## Setup\n\n## Tips",
      }),
    ).toEqual([
      {
        index: 0,
        headingPath: "Coming soon",
        content: "Coming soon",
        tokenCount: 3,
      },
    ]);
  });
});

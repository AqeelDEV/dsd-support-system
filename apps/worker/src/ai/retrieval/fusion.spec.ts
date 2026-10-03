import { describe, expect, it } from "vitest";

import { fuse, RRF_K } from "./fusion.js";

describe("reciprocal rank fusion", () => {
  it("scores each item 1/(k + rank) per list it appears in", () => {
    const [top] = fuse([["a", "b"], ["a"]], 6);
    expect(top).toEqual({
      id: "a",
      score: 2 / (RRF_K + 1),
      ranks: [1, 1],
    });
  });

  it("ranks an item found by both searches above one found by a single search", () => {
    const fused = fuse(
      [
        ["keyword-only", "both"],
        ["vector-only", "both"],
      ],
      6,
    );
    expect(fused.map((item) => item.id)).toEqual([
      "both",
      "keyword-only",
      "vector-only",
    ]);
    expect(fused[0]?.ranks).toEqual([2, 2]);
  });

  it("breaks ties by the better single rank, then by ID, so the order never changes", () => {
    expect(fuse([["b", "x"], ["a"]], 6).map((item) => item.id)).toEqual([
      "a",
      "b",
      "x",
    ]);
  });

  it("keeps the top `limit` and works with one list", () => {
    expect(fuse([["a", "b", "c"]], 2).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(fuse([[], []], 6)).toEqual([]);
  });

  it("counts an ID once per list, at its best position", () => {
    expect(fuse([["a", "a"]], 6)).toEqual([
      { id: "a", score: 1 / (RRF_K + 1), ranks: [1] },
    ]);
  });
});

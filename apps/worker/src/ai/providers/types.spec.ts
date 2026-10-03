import { describe, expect, it } from "vitest";

import { checkedVectors } from "./types.js";

const vector = (length = 1024, value = 0.01) =>
  new Array<number>(length).fill(value);

describe("checkedVectors", () => {
  it("passes vectors the index can hold", () => {
    expect(checkedVectors([vector(), vector()], 2, "model")).toHaveLength(2);
  });

  it("refuses the wrong number of vectors", () => {
    expect(() => checkedVectors([vector()], 2, "model")).toThrow(
      /1 embeddings for 2 inputs/,
    );
  });

  it("refuses another dimension, which would corrupt the index", () => {
    expect(() => checkedVectors([vector(768)], 1, "model")).toThrow(
      /768 dimensions; the index holds 1024/,
    );
  });

  it("refuses values that aren't finite numbers", () => {
    expect(() =>
      checkedVectors([vector(1024, Number.NaN)], 1, "model"),
    ).toThrow(/non-finite/);
  });
});

import { describe, expect, it } from "vitest";

import { acceptFiles } from "./attachments";
import { niceTicks } from "./charts";

describe("niceTicks", () => {
  it.each([
    [0, [0, 1]],
    [3, [0, 1, 2, 3]],
    [17, [0, 5, 10, 15, 20]],
    [230, [0, 100, 200, 300]],
  ])("covers %d with round steps", (max, ticks) => {
    expect(niceTicks(max)).toEqual(ticks);
  });
});

describe("acceptFiles", () => {
  const file = (name: string, size: number) =>
    new File([new Uint8Array(size)], name);

  it("keeps files within the limits and explains the rest", () => {
    const big = file("huge.pdf", 10 * 1024 * 1024 + 1);
    const result = acceptFiles(
      [],
      [file("a.png", 10), big, file("empty.txt", 0)],
    );
    expect(result.files.map((f) => f.name)).toEqual(["a.png"]);
    expect(result.problem).toContain("huge.pdf is larger than 10 MB");
    expect(result.problem).toContain("empty.txt is empty");
  });

  it("stops at five files", () => {
    const five = Array.from({ length: 5 }, (_, i) => file(`${i}.txt`, 1));
    const result = acceptFiles(five, [file("six.txt", 1)]);
    expect(result.files).toHaveLength(5);
    expect(result.problem).toContain("up to 5 files");
  });
});

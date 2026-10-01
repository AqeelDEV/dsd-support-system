import { describe, expect, it } from "vitest";

import { snippetSegments } from "./snippet.js";

const S = "\uE000";
const E = "\uE001";

describe("snippetSegments", () => {
  it("splits matches from the text around them", () => {
    expect(
      snippetSegments(`Hold the ${S}reset${E} button for ${S}ten${E} seconds`),
    ).toEqual([
      { text: "Hold the ", highlighted: false },
      { text: "reset", highlighted: true },
      { text: " button for ", highlighted: false },
      { text: "ten", highlighted: true },
      { text: " seconds", highlighted: false },
    ]);
  });

  it("returns plain text untouched, HTML-looking text included", () => {
    expect(snippetSegments("<b>not markup</b>")).toEqual([
      { text: "<b>not markup</b>", highlighted: false },
    ]);
  });

  it("keeps the text whole when a marker is unbalanced", () => {
    expect(snippetSegments(`a ${S}b c`)).toEqual([
      { text: "a ", highlighted: false },
      { text: "b c", highlighted: false },
    ]);
    expect(snippetSegments(`a${E} b`)).toEqual([
      { text: "a b", highlighted: false },
    ]);
  });
});

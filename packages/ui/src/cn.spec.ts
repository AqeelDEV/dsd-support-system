import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("lets later classes win over conflicting earlier ones", () => {
    expect(cn("px-3 py-2", "px-4")).toBe("py-2 px-4");
  });

  it("drops falsy values", () => {
    expect(cn("rounded-md", [false, null, undefined])).toBe("rounded-md");
  });
});

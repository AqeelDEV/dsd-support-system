import { describe, expect, it } from "vitest";

import { describeProblem } from "./problem";

const problem = (status: number, extra: object = {}) => ({
  status,
  title: "Title from the API",
  ...extra,
});

describe("describeProblem", () => {
  it("explains an unreachable server", () => {
    expect(describeProblem(problem(0))).toMatchObject({ icon: "offline" });
  });

  it("says how long to wait after a rate limit", () => {
    expect(
      describeProblem(problem(429, { retryAfterSeconds: 30 })).description,
    ).toContain("30 seconds");
    expect(
      describeProblem(problem(429, { retryAfterSeconds: 900 })).description,
    ).toContain("15 minutes");
  });

  it("keeps the API's own wording for a client error, and the request ID", () => {
    const message = describeProblem(
      problem(409, { detail: "This ticket is closed.", requestId: "r-1" }),
    );
    expect(message).toMatchObject({
      title: "Title from the API",
      description: "This ticket is closed.",
      requestId: "r-1",
    });
  });

  it("never shows server internals for a 500", () => {
    expect(
      describeProblem(problem(500, { detail: "stack trace" })).description,
    ).not.toContain("stack");
  });

  it("copes with something that isn't a problem at all", () => {
    expect(describeProblem(new Error("boom")).title).toBe(
      "Something went wrong",
    );
  });
});

import { describe, expect, it } from "vitest";

import { problemDetailsSchema } from "./problem-details.js";

describe("problemDetailsSchema", () => {
  it("accepts a validation problem", () => {
    const problem = {
      type: "tag:dsd.example,2026:problems/validation-error",
      title: "Bad Request",
      status: 400,
      detail: "The request body is invalid.",
      instance: "/api/v1/public/tickets",
      requestId: "0199a1b2-0000-7000-8000-000000000000",
      errors: [{ path: "subject", message: "Required" }],
    };
    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it("rejects a success status", () => {
    const result = problemDetailsSchema.safeParse({
      type: "about:blank",
      title: "OK",
      status: 200,
      requestId: "x",
    });
    expect(result.success).toBe(false);
  });

  it("requires a request id, so every error can be traced to its logs", () => {
    const result = problemDetailsSchema.safeParse({
      type: "about:blank",
      title: "Not Found",
      status: 404,
    });
    expect(result.success).toBe(false);
  });
});

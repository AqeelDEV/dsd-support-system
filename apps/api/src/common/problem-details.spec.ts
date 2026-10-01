import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from "@nestjs/common";
import { PROBLEM_TYPES, problemDetailsSchema } from "@dsd/shared";
import { ZodValidationException } from "nestjs-zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { clashOf, ProblemException, toProblem } from "./problem-details.js";

const context = {
  requestId: "0199a1b2-0000-7000-8000-000000000001",
  path: "/api/v1/things",
};

describe("toProblem", () => {
  it("maps an HTTP exception to its status and keeps the client-facing message", () => {
    const problem = toProblem(
      new ForbiddenException("Agents can't reassign this ticket."),
      context,
    );
    expect(problem).toEqual({
      type: PROBLEM_TYPES.blank,
      title: "Forbidden",
      status: 403,
      detail: "Agents can't reassign this ticket.",
      instance: "/api/v1/things",
      requestId: context.requestId,
    });
  });

  it("keeps a problem exception's own type and detail, even for a 503", () => {
    const limited = new ProblemException(
      429,
      PROBLEM_TYPES.rateLimited,
      "Too many attempts. Try again later.",
      { "retry-after": "60" },
    );
    expect(toProblem(limited, context)).toMatchObject({
      type: PROBLEM_TYPES.rateLimited,
      status: 429,
      detail: "Too many attempts. Try again later.",
    });

    const unavailable = new ProblemException(
      503,
      PROBLEM_TYPES.blank,
      "Sign-in is unavailable right now.",
    );
    expect(toProblem(unavailable, context).detail).toBe(
      "Sign-in is unavailable right now.",
    );
  });

  it("adds a problem exception's extension members", () => {
    const conflict = new ProblemException(
      409,
      PROBLEM_TYPES.invalidStatusTransition,
      "A closed ticket can't change status.",
      {},
      { allowedTransitions: [] },
    );
    const problem = toProblem(conflict, context);
    expect(problem).toMatchObject({ status: 409, allowedTransitions: [] });
    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
  });

  it("maps validation failures to 400 with one entry per field", () => {
    const schema = z.object({
      subject: z.string().min(1),
      priority: z.enum(["low", "high"]),
    });
    const result = schema.safeParse({ subject: "", priority: "urgent" });
    if (result.success) throw new Error("expected a failure");
    const problem = toProblem(
      new ZodValidationException(result.error),
      context,
    );

    expect(problem.status).toBe(400);
    expect(problem.type).toBe(PROBLEM_TYPES.validation);
    expect(problem.errors?.map((error) => error.path)).toEqual([
      "subject",
      "priority",
    ]);
  });

  it("passes through Fastify's client errors", () => {
    const error = Object.assign(new Error("Unsupported Media Type: text/xml"), {
      statusCode: 415,
      code: "FST_ERR_CTP_INVALID_MEDIA_TYPE",
    });
    expect(toProblem(error, context)).toMatchObject({
      status: 415,
      detail: "Unsupported Media Type: text/xml",
    });
  });

  it("hides the message of an unexpected error", () => {
    const problem = toProblem(
      new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"),
      context,
    );
    expect(problem.status).toBe(500);
    expect(JSON.stringify(problem)).not.toMatch(/ECONNREFUSED|hunter2/);
  });

  it("hides the message of a 5xx HTTP exception too", () => {
    const problem = toProblem(
      new HttpException("upstream at 10.0.0.5 failed", 502),
      context,
    );
    expect(problem.status).toBe(502);
    expect(problem.detail).not.toMatch(/10\.0\.0\.5/);
  });

  it("treats a thrown non-error as a 500", () => {
    expect(toProblem("boom", context).status).toBe(500);
  });

  it.each([
    new NotFoundException(),
    new BadRequestException(["a is required", "b is required"]),
  ])("always produces a valid problem document (%s)", (exception) => {
    expect(
      problemDetailsSchema.safeParse(toProblem(exception, context)).success,
    ).toBe(true);
  });
});

describe("clashOf", () => {
  it("turns a deadlock, wrapped or not, into a 503 that asks for a retry", () => {
    const deadlock = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
    });
    for (const thrown of [
      deadlock,
      new Error("Failed query", { cause: deadlock }),
    ]) {
      const clash = clashOf(thrown);
      expect(clash?.getStatus()).toBe(503);
      expect(clash?.headers).toEqual({ "Retry-After": "1" });
    }
  });

  it("leaves every other error alone", () => {
    expect(clashOf(new Error("boom"))).toBeUndefined();
    expect(
      clashOf(Object.assign(new Error("unique"), { code: "23505" })),
    ).toBeUndefined();
    expect(clashOf("not an error")).toBeUndefined();
  });
});

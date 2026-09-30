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

import { toProblem } from "./problem-details.js";

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

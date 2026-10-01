import type { ExecutionContext } from "@nestjs/common";
import { PROBLEM_TYPES } from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { ProblemException } from "../../common/problem-details.js";
import { parseEnv } from "../../config/env.js";
import { CsrfTokens } from "../csrf.js";
import type { Principal } from "../principal.js";
import { CsrfGuard } from "./csrf.guard.js";

const env = parseEnv({
  DATABASE_URL: "postgres://dsd_api:pw@db:5432/dsd",
  REDIS_URL: "redis://redis:6379",
  TRUSTED_ORIGINS: "https://support.example.com,https://agents.example.com",
  CORS_ORIGINS: "https://tools.example.com",
  AUTH_SECRET: "a-secret-of-at-least-thirty-two-characters",
});
const tokens = new CsrfTokens(env);
const guard = new CsrfGuard(tokens, env);

const SESSION = "0199a1b2-0000-7000-8000-000000000001";
const principal: Principal = {
  realm: "customer",
  sessionId: SESSION,
  customer: { id: "c", email: "ana@example.com", displayName: null },
  guestTicketId: null,
};

function check(
  method: string,
  headers: Record<string, string>,
  signedIn?: Principal,
): boolean {
  const request = {
    method,
    headers,
    principal: signedIn,
  } as unknown as FastifyRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

function rejection(run: () => boolean): ProblemException {
  try {
    run();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("expected the guard to refuse");
}

describe("CsrfGuard", () => {
  it.each(["GET", "HEAD", "OPTIONS"])(
    "lets %s through: it changes nothing",
    (method) => {
      expect(check(method, { origin: "https://attacker.example" })).toBe(true);
    },
  );

  it.each([
    "https://support.example.com",
    "https://agents.example.com",
    "https://tools.example.com",
  ])("accepts a sign-in posted from %s", (origin) => {
    expect(check("POST", { origin })).toBe(true);
  });

  it("accepts a same-origin request whose browser sent no Origin", () => {
    expect(check("POST", { "sec-fetch-site": "same-origin" })).toBe(true);
  });

  it.each([
    ["another site's Origin", { origin: "https://attacker.example" }],
    [
      "a look-alike Origin",
      { origin: "https://support.example.com.attacker.example" },
    ],
    ["Origin null", { origin: "null" }],
    ["a cross-site fetch without Origin", { "sec-fetch-site": "cross-site" }],
    ["no Origin at all", {}],
    [
      "a foreign Origin despite a same-origin claim",
      { origin: "https://attacker.example", "sec-fetch-site": "same-origin" },
    ],
  ])(
    "refuses a POST with %s, even before sign-in (login CSRF)",
    (_, headers) => {
      const error = rejection(() => check("POST", headers));
      expect(error.getStatus()).toBe(403);
      expect(error.problemType).toBe(PROBLEM_TYPES.csrfRejected);
    },
  );

  it("requires a signed-in request to carry its session's token", () => {
    const origin = "https://support.example.com";
    expect(
      check(
        "DELETE",
        { origin, "x-csrf-token": tokens.tokenFor(SESSION) },
        principal,
      ),
    ).toBe(true);
    expect(
      rejection(() => check("POST", { origin }, principal)).getStatus(),
    ).toBe(403);
  });

  it("refuses another session's token", () => {
    const stolen = tokens.tokenFor("0199a1b2-0000-7000-8000-000000000002");
    const error = rejection(() =>
      check(
        "PATCH",
        { origin: "https://support.example.com", "x-csrf-token": stolen },
        principal,
      ),
    );
    expect(error.problemType).toBe(PROBLEM_TYPES.csrfRejected);
  });
});

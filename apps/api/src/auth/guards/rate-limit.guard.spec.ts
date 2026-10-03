import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PROBLEM_TYPES } from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";

import { ProblemException } from "../../common/problem-details.js";
import { RateLimitEnforcer } from "../rate-limit/enforcer.js";
import { RATE_LIMITS, type RateLimitPolicy } from "../rate-limit/policies.js";
import {
  type RateLimiter,
  RateLimitUnavailableError,
  type Verdict,
} from "../rate-limit/rate-limiter.js";
import { RateLimit, RateLimitGuard } from "./rate-limit.guard.js";

const open: RateLimitPolicy = {
  name: "open-when-down",
  limits: [{ by: "ip", max: 10, windowSeconds: 3600 }],
  whenRedisIsDown: "allow",
};

class Routes {
  @RateLimit(RATE_LIMITS.customerLogin)
  login() {
    return undefined;
  }

  @RateLimit(open)
  submit() {
    return undefined;
  }

  unlimited() {
    return undefined;
  }
}

function setup(consume: () => Promise<Verdict>) {
  const limiter = { consume: vi.fn(consume) };
  const guard = new RateLimitGuard(
    new Reflector(),
    new RateLimitEnforcer(limiter as unknown as RateLimiter),
  );
  const run = (
    handler: keyof Routes,
    body: unknown = {},
    principal?: unknown,
  ) => {
    const request = {
      ip: "203.0.113.7",
      body,
      principal,
    } as unknown as FastifyRequest;
    const context = {
      getHandler: () => Reflect.get(Routes.prototype, handler) as object,
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context);
  };
  return { limiter, run };
}

async function rejection(promise: Promise<boolean>): Promise<ProblemException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("expected the guard to refuse");
}

describe("RateLimitGuard", () => {
  it("ignores routes without a policy", async () => {
    const { limiter, run } = setup(() => Promise.resolve({ allowed: true }));
    await expect(run("unlimited")).resolves.toBe(true);
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it("counts by client IP and normalised email", async () => {
    const { limiter, run } = setup(() => Promise.resolve({ allowed: true }));
    await expect(run("login", { email: "  Ana@Example.COM " })).resolves.toBe(
      true,
    );
    expect(limiter.consume).toHaveBeenCalledWith(RATE_LIMITS.customerLogin, {
      ip: "203.0.113.7",
      email: "ana@example.com",
    });
  });

  it("counts by IP alone when the body has no usable email", async () => {
    const { limiter, run } = setup(() => Promise.resolve({ allowed: true }));
    await run("login", { email: 42 });
    expect(limiter.consume).toHaveBeenCalledWith(RATE_LIMITS.customerLogin, {
      ip: "203.0.113.7",
      email: undefined,
    });
  });

  it("counts a signed-in or guest customer by their account", async () => {
    const { limiter, run } = setup(() => Promise.resolve({ allowed: true }));
    await run(
      "submit",
      {},
      {
        realm: "customer",
        customer: { id: "customer-1" },
        guestTicketId: null,
      },
    );
    expect(limiter.consume).toHaveBeenCalledWith(open, {
      ip: "203.0.113.7",
      email: undefined,
      customer: "customer-1",
    });
  });

  it("never counts staff as a customer", async () => {
    const { limiter, run } = setup(() => Promise.resolve({ allowed: true }));
    await run("submit", {}, { realm: "staff", agentId: "agent-1" });
    expect(limiter.consume).toHaveBeenCalledWith(open, {
      ip: "203.0.113.7",
      email: undefined,
      customer: undefined,
    });
  });

  it("answers 429 with Retry-After once over the limit", async () => {
    const { run } = setup(() =>
      Promise.resolve({ allowed: false, retryAfterSeconds: 420 }),
    );
    const error = await rejection(run("login"));
    expect(error.getStatus()).toBe(429);
    expect(error.problemType).toBe(PROBLEM_TYPES.rateLimited);
    expect(error.headers).toEqual({ "retry-after": "420" });
  });

  it("refuses sign-in with 503 when Redis is down, so guessing can't go unlimited", async () => {
    const { run } = setup(() =>
      Promise.reject(new RateLimitUnavailableError(new Error("down"))),
    );
    const error = await rejection(run("login"));
    expect(error.getStatus()).toBe(503);
  });

  it("lets a fail-open route through when Redis is down", async () => {
    const { run } = setup(() =>
      Promise.reject(new RateLimitUnavailableError(new Error("down"))),
    );
    await expect(run("submit")).resolves.toBe(true);
  });
});

describe("rate-limit policies (ADR-0003, section 10)", () => {
  const summary = (policy: RateLimitPolicy) => ({
    limits: policy.limits.map(
      (limit) => `${limit.by} ${limit.max}/${limit.windowSeconds}s`,
    ),
    whenRedisIsDown: policy.whenRedisIsDown,
  });

  it.each(["customerLogin", "staffLogin"] as const)(
    "limit %s to 20 per IP and 5 per email in 15 minutes",
    (name) => {
      expect(summary(RATE_LIMITS[name])).toEqual({
        limits: ["ip 20/900s", "email 5/900s"],
        whenRedisIsDown: "refuse",
      });
    },
  );

  it.each(["signup", "guestLinkRequest"] as const)(
    "limit %s to 10 per IP and 3 per email an hour",
    (name) => {
      expect(summary(RATE_LIMITS[name])).toEqual({
        limits: ["ip 10/3600s", "email 3/3600s"],
        whenRedisIsDown: "refuse",
      });
    },
  );

  it.each([
    "guestLinkExchange",
    "signupCompletion",
    "inviteCompletion",
  ] as const)("limit %s to 20 per IP in 15 minutes", (name) => {
    expect(summary(RATE_LIMITS[name])).toEqual({
      limits: ["ip 20/900s"],
      whenRedisIsDown: "refuse",
    });
  });

  it("limit ticket submission to 10 per IP and 5 per email an hour, and let it through without Redis", () => {
    expect(summary(RATE_LIMITS.ticketSubmission)).toEqual({
      limits: ["ip 10/3600s", "email 5/3600s"],
      whenRedisIsDown: "allow",
    });
  });

  it("limit AI suggestion requests to 5 per ticket in 10 minutes and 30 per agent an hour, and refuse them without Redis", () => {
    expect(summary(RATE_LIMITS.aiSuggestionRequest)).toEqual({
      limits: ["ticket 5/600s", "agent 30/3600s"],
      whenRedisIsDown: "refuse",
    });
  });

  it("limit the help centre's article list and search to 300 a minute per IP, and let it through without Redis", () => {
    expect(summary(RATE_LIMITS.kbArticles)).toEqual({
      limits: ["ip 300/60s"],
      whenRedisIsDown: "allow",
    });
  });

  it("limit customers' replies to 20 per customer in 10 minutes, and let them through without Redis", () => {
    expect(summary(RATE_LIMITS.customerReply)).toEqual({
      limits: ["customer 20/600s"],
      whenRedisIsDown: "allow",
    });
  });

  it("give every policy its own counters", () => {
    const names = Object.values(RATE_LIMITS).map((policy) => policy.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

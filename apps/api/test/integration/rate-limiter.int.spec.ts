import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RateLimitPolicy } from "../../src/auth/rate-limit/policies.js";
import {
  RateLimiter,
  RateLimitUnavailableError,
} from "../../src/auth/rate-limit/rate-limiter.js";
import { parseEnv } from "../../src/config/env.js";
import { closedPort, TEST_ENV } from "../support/app.js";

const policy: RateLimitPolicy = {
  name: "test-login",
  limits: [
    { by: "ip", max: 4, windowSeconds: 60 },
    { by: "email", max: 2, windowSeconds: 900 },
  ],
  whenRedisIsDown: "refuse",
};

/** The limiter against the real compose Redis, under a prefix of its own. */
describe("RateLimiter (Redis)", () => {
  const prefix = `test:rate-limiter:${randomUUID()}:`;
  const env = parseEnv({ ...TEST_ENV, REDIS_KEY_PREFIX: prefix });
  let redis: Redis;
  let limiter: RateLimiter;

  beforeAll(() => {
    redis = new Redis(env.REDIS_URL);
    limiter = new RateLimiter(redis, env);
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it("allows up to the limit, then refuses until the window ends", async () => {
    const subjects = { email: "ana@example.com" };
    expect(await limiter.consume(policy, subjects)).toEqual({ allowed: true });
    expect(await limiter.consume(policy, subjects)).toEqual({ allowed: true });
    const refused = await limiter.consume(policy, subjects);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThan(890);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(900);
    }
  });

  it("counts each subject separately", async () => {
    for (let i = 0; i < 2; i += 1) {
      await limiter.consume(policy, { email: "bea@example.com" });
    }
    expect(await limiter.consume(policy, { email: "cal@example.com" })).toEqual(
      { allowed: true },
    );
  });

  it("refuses when any one limit is exceeded", async () => {
    const ip = "198.51.100.20";
    for (let i = 0; i < 4; i += 1) {
      const verdict = await limiter.consume(policy, {
        ip,
        email: `user${i}@example.com`,
      });
      expect(verdict.allowed).toBe(true);
    }
    const verdict = await limiter.consume(policy, {
      ip,
      email: "fresh@example.com",
    });
    expect(verdict).toMatchObject({ allowed: false });
  });

  it("starts the window at the first request and keeps it fixed", async () => {
    const subjects = { ip: "198.51.100.30" };
    await limiter.consume(policy, subjects);
    const key = limiter.keyFor(policy, "ip", subjects.ip);
    const first = await redis.pttl(key);
    await limiter.consume(policy, subjects);
    expect(await redis.pttl(key)).toBeLessThanOrEqual(first);
    expect(first).toBeGreaterThan(55_000);
  });

  it("keeps emails and IP addresses out of Redis", async () => {
    await limiter.consume(policy, {
      ip: "198.51.100.40",
      email: "private.person@example.com",
    });
    const keys = await redis.keys(`${prefix}*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain("private.person");
      expect(key).not.toContain("198.51.100.40");
    }
  });

  it("reports Redis being unreachable instead of guessing", async () => {
    const down = new Redis({
      host: "127.0.0.1",
      port: await closedPort(),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    try {
      await expect(
        new RateLimiter(down, env).consume(policy, { ip: "198.51.100.50" }),
      ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    } finally {
      down.disconnect();
    }
  });
});

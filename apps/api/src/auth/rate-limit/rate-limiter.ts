import { createHmac } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";

import type { Env } from "../../config/env.js";
import { ENV, REDIS } from "../../infrastructure/tokens.js";
import { deriveKey } from "../secrets.js";
import type { LimitSubject, RateLimitPolicy } from "./policies.js";

/**
 * Fixed-window counters, all in one atomic step: increment each key, start
 * its window on the first hit, and return every count with the time left.
 * One round trip, and no race between the increment and the expiry.
 */
const CONSUME = `
local result = {}
for i, key in ipairs(KEYS) do
  local count = redis.call("INCR", key)
  local ttl = redis.call("PTTL", key)
  if ttl < 0 then
    redis.call("PEXPIRE", key, ARGV[i])
    ttl = tonumber(ARGV[i])
  end
  result[#result + 1] = count
  result[#result + 1] = ttl
end
return result
`;

export type Subjects = Partial<Record<LimitSubject, string>>;

export type Verdict =
  { allowed: true } | { allowed: false; retryAfterSeconds: number };

/** Redis couldn't be reached; the caller decides from the policy what that means. */
export class RateLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate-limit store unavailable", { cause });
    this.name = "RateLimitUnavailableError";
  }
}

/**
 * Shared counters in Redis (ADR-0003, section 10), so every API instance
 * enforces the same limits. Every subject is keyed by an HMAC, never
 * stored as it is: no email or IP address sits in Redis.
 */
@Injectable()
export class RateLimiter {
  private readonly hashKey: Buffer;
  private readonly prefix: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: Env,
  ) {
    this.hashKey = deriveKey(env.AUTH_SECRET, "dsd/rate-limit/v1");
    this.prefix = `${env.REDIS_KEY_PREFIX}rl:`;
  }

  /** The Redis key for one counter. */
  keyFor(policy: RateLimitPolicy, by: LimitSubject, value: string): string {
    const digest = createHmac("sha256", this.hashKey)
      .update(value, "utf8")
      .digest("base64url");
    return `${this.prefix}${policy.name}:${by}:${digest}`;
  }

  /**
   * Counts one request against every limit it has a subject for, and says
   * whether it is allowed. Over any limit means refused, with the longest
   * wait among the exceeded ones.
   */
  async consume(policy: RateLimitPolicy, subjects: Subjects): Promise<Verdict> {
    const counted = policy.limits.flatMap((limit) => {
      const value = subjects[limit.by];
      return value === undefined
        ? []
        : [{ limit, key: this.keyFor(policy, limit.by, value) }];
    });
    if (counted.length === 0) return { allowed: true };

    let reply: unknown;
    try {
      reply = await this.redis.eval(
        CONSUME,
        counted.length,
        ...counted.map(({ key }) => key),
        ...counted.map(({ limit }) => String(limit.windowSeconds * 1000)),
      );
    } catch (error) {
      throw new RateLimitUnavailableError(error);
    }

    const numbers = (reply as unknown[]).map(Number);
    let waitMs = 0;
    counted.forEach(({ limit }, index) => {
      const count = numbers[index * 2] ?? 0;
      const ttl = numbers[index * 2 + 1] ?? 0;
      if (count > limit.max) waitMs = Math.max(waitMs, ttl);
    });
    return waitMs === 0
      ? { allowed: true }
      : {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
        };
  }
}

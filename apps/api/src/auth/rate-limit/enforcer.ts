import { Injectable, Logger } from "@nestjs/common";
import { PROBLEM_TYPES } from "@dsd/shared";

import { ProblemException } from "../../common/problem-details.js";
import type { RateLimitPolicy } from "./policies.js";
import {
  RateLimiter,
  RateLimitUnavailableError,
  type Subjects,
  type Verdict,
} from "./rate-limiter.js";

/**
 * Turns a rate-limit verdict into the response ADR-0003 (section 10) asks
 * for: 429 with `Retry-After` over a limit, and, when Redis is down, 503 or
 * a logged pass depending on the policy. The guard uses it for whatever it
 * can count before the handler runs; a service uses it for subjects it only
 * learns later, such as the email inside a multipart ticket submission.
 */
@Injectable()
export class RateLimitEnforcer {
  private readonly logger = new Logger("RateLimit");

  constructor(private readonly limiter: RateLimiter) {}

  async enforce(policy: RateLimitPolicy, subjects: Subjects): Promise<void> {
    let verdict: Verdict;
    try {
      verdict = await this.limiter.consume(policy, subjects);
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) throw error;
      if (policy.whenRedisIsDown === "allow") {
        this.logger.warn(
          `Redis is unavailable; ${policy.name} is not rate limited`,
        );
        return;
      }
      this.logger.warn(`Redis is unavailable; refusing ${policy.name}`);
      throw new ProblemException(
        503,
        PROBLEM_TYPES.blank,
        "This is unavailable for a moment. Try again shortly.",
        { "retry-after": "30" },
      );
    }

    if (!verdict.allowed) {
      throw new ProblemException(
        429,
        PROBLEM_TYPES.rateLimited,
        "Too many attempts. Wait a while before trying again.",
        { "retry-after": String(verdict.retryAfterSeconds) },
      );
    }
  }
}

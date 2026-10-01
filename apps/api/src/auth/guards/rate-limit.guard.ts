import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { normalizeEmail, PROBLEM_TYPES } from "@dsd/shared";
import type { FastifyRequest } from "fastify";

import { ProblemException } from "../../common/problem-details.js";
import type { RateLimitPolicy } from "../rate-limit/policies.js";
import {
  RateLimiter,
  RateLimitUnavailableError,
  type Verdict,
} from "../rate-limit/rate-limiter.js";

const RATE_LIMIT_METADATA = "dsd:rate-limit";

/** Counts calls to this route against `policy` (ADR-0003, section 10). */
export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_METADATA, policy);

/**
 * The email a request is about, read from the raw body because guards run
 * before validation. If it isn't a string, only the IP limit applies, and
 * validation then rejects the request anyway.
 */
function emailOf(request: FastifyRequest): string | undefined {
  const body = request.body;
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return undefined;
  }
  return typeof body.email === "string"
    ? normalizeEmail(body.email)
    : undefined;
}

/**
 * The third global guard. It runs after the origin check, so a forged
 * cross-site request is refused without using up anyone's allowance.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger("RateLimit");

  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<
      RateLimitPolicy | undefined
    >(RATE_LIMIT_METADATA, [context.getHandler(), context.getClass()]);
    if (policy === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    let verdict: Verdict;
    try {
      verdict = await this.limiter.consume(policy, {
        ip: request.ip,
        email: emailOf(request),
      });
    } catch (error) {
      if (!(error instanceof RateLimitUnavailableError)) throw error;
      if (policy.whenRedisIsDown === "allow") {
        this.logger.warn(
          `Redis is unavailable; ${policy.name} is not rate limited`,
        );
        return true;
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
    return true;
  }
}

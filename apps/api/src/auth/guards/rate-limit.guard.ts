import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { normalizeEmail } from "@dsd/shared";
import type { FastifyRequest } from "fastify";

import { RateLimitEnforcer } from "../rate-limit/enforcer.js";
import type { RateLimitPolicy } from "../rate-limit/policies.js";

const RATE_LIMIT_METADATA = "dsd:rate-limit";

/** Counts calls to this route against `policy` (ADR-0003, section 10). */
export const RateLimit = (policy: RateLimitPolicy) =>
  SetMetadata(RATE_LIMIT_METADATA, policy);

/**
 * The email a request is about, read from the raw body because guards run
 * before validation. If it isn't a string, only the IP limit applies, and
 * validation then rejects the request anyway. A multipart body isn't read
 * until the handler runs, so routes that take one count the email later.
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
  constructor(
    private readonly reflector: Reflector,
    private readonly enforcer: RateLimitEnforcer,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<
      RateLimitPolicy | undefined
    >(RATE_LIMIT_METADATA, [context.getHandler(), context.getClass()]);
    if (policy === undefined) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // request.ip already accounts for TRUST_PROXY (ADR-0010): behind the web
    // apps it is the browser's address, never the web app's own.
    await this.enforcer.enforce(policy, {
      ip: request.ip,
      email: emailOf(request),
      customer:
        request.principal?.realm === "customer"
          ? request.principal.customer.id
          : undefined,
    });
    return true;
  }
}

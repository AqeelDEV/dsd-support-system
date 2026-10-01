import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { PROBLEM_TYPES } from "@dsd/shared";
import type { FastifyRequest } from "fastify";

import { ProblemException } from "../../common/problem-details.js";
import type { Env } from "../../config/env.js";
import { ENV } from "../../infrastructure/tokens.js";
import { CsrfTokens } from "../csrf.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const CSRF_HEADER = "x-csrf-token";

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The second global guard (ADR-0003, section 5). Every state-changing
 * request must come from one of our own pages: its Origin must be on the
 * allowlist (or, without an Origin, the browser must say it is
 * same-origin). That covers sign-in and sign-up too, before any session
 * exists. A request authenticated by a session cookie must also carry
 * that session's CSRF token in X-CSRF-Token.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly trustedOrigins: ReadonlySet<string>;

  constructor(
    private readonly tokens: CsrfTokens,
    @Inject(ENV) env: Env,
  ) {
    this.trustedOrigins = new Set([
      ...env.TRUSTED_ORIGINS,
      ...env.CORS_ORIGINS,
    ]);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const origin = header(request, "origin");
    const fromOurPages =
      origin === undefined
        ? header(request, "sec-fetch-site") === "same-origin"
        : this.trustedOrigins.has(origin);
    if (!fromOurPages) {
      throw new ProblemException(
        403,
        PROBLEM_TYPES.csrfRejected,
        "This request didn't come from a page this service trusts.",
      );
    }

    const { principal } = request;
    if (
      principal !== undefined &&
      !this.tokens.matches(principal.sessionId, header(request, CSRF_HEADER))
    ) {
      throw new ProblemException(
        403,
        PROBLEM_TYPES.csrfRejected,
        "The CSRF token is missing or wrong. Fetch /me for a fresh one.",
      );
    }
    return true;
  }
}

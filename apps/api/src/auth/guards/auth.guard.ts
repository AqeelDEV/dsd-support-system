import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { SessionCookies } from "../cookies.js";
import { accessOf } from "../decorators.js";
import { SessionService } from "../sessions/session.service.js";

/**
 * The first global guard: deny by default (ADR-0004, section 2). A public
 * route passes; a realm route needs a live session of that realm, read
 * only from that realm's cookie. Everything else is 401, including a
 * session from the other realm.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = accessOf(context.getHandler());
    if (access === undefined) {
      // The boot check makes this unreachable; refuse rather than serve.
      throw new Error(
        `${context.getClass().name}.${context.getHandler().name} declares no access`,
      );
    }
    if (access.kind === "public") return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = this.cookies.sessionToken(request, access.realm);
    const principal =
      token === undefined
        ? null
        : await this.sessions.resolve(access.realm, token);
    if (principal === null) {
      throw new UnauthorizedException("Sign in to continue.");
    }
    request.principal = principal;
    return true;
  }
}

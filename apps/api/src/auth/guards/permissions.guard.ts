import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";

import { permissionsOf } from "../decorators.js";

/**
 * The last global guard (ADR-0004, section 2). A route that requires
 * permissions passes only for a staff session whose current role grants
 * all of them; the role is read fresh with the session, so a change
 * applies on the next request. The visible-but-forbidden case is 403;
 * resource checks in services decide what a caller can see at all.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const required = permissionsOf(context.getHandler());
    if (required.length === 0) return true;

    const { principal } = context.switchToHttp().getRequest<FastifyRequest>();
    const granted =
      principal?.realm === "staff" &&
      required.every((permission) => principal.permissions.has(permission));
    if (!granted) {
      throw new ForbiddenException("Your role doesn't allow this.");
    }
    return true;
  }
}

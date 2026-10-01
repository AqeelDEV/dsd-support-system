import type { FastifyRequest } from "fastify";

import type { CustomerPrincipal, StaffPrincipal } from "./principal.js";
import type { ClientInfo } from "./sessions/session.service.js";

/*
 * Typed access to what the guards established. Controllers take the raw
 * request (`@Req()`) rather than a custom parameter decorator, because the
 * strict validation pipe insists every decorated parameter has a schema.
 */

/** The caller on a customer-realm route. The auth guard guarantees one. */
export function customerOf(request: FastifyRequest): CustomerPrincipal {
  const { principal } = request;
  if (principal?.realm !== "customer") {
    throw new Error("A customer route ran without a customer session");
  }
  return principal;
}

/** The caller on a staff-realm route. The auth guard guarantees one. */
export function staffOf(request: FastifyRequest): StaffPrincipal {
  const { principal } = request;
  if (principal?.realm !== "staff") {
    throw new Error("A staff route ran without a staff session");
  }
  return principal;
}

/**
 * Where the request came from. `request.ip` already accounts for trusted
 * proxies (TRUST_PROXY), so it is the browser's address, not the web app's.
 */
export function clientOf(request: FastifyRequest): ClientInfo {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

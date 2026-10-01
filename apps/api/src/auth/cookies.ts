import { Inject, Injectable } from "@nestjs/common";
import type { SessionRealm } from "@dsd/shared";
import type { FastifyRequest } from "fastify";

import type { Env } from "../config/env.js";
import { ENV } from "../infrastructure/tokens.js";

/** What a session token looks like; anything else is never looked up. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export interface RealmCookieNames {
  session: string;
  csrf: string;
}

/**
 * Cookie names per realm (ADR-0003). With Secure cookies they carry the
 * `__Host-` prefix, which browsers accept only with Secure, Path=/ and no
 * Domain, so a sibling subdomain can't set or overwrite them. Without
 * Secure (a local stack on http://localhost only) the prefix has to go too.
 */
export function cookieNames(
  realm: SessionRealm,
  secure: boolean,
): RealmCookieNames {
  const prefix = secure ? "__Host-" : "";
  return {
    session: `${prefix}dsd_${realm}_session`,
    csrf: `${prefix}dsd_${realm}_csrf`,
  };
}

@Injectable()
export class SessionCookies {
  readonly secure: boolean;

  constructor(@Inject(ENV) env: Env) {
    this.secure = env.COOKIE_SECURE;
  }

  names(realm: SessionRealm): RealmCookieNames {
    return cookieNames(realm, this.secure);
  }

  /** The session token in this realm's cookie, if it has the right shape. Other realms' cookies are never read. */
  sessionToken(
    request: FastifyRequest,
    realm: SessionRealm,
  ): string | undefined {
    const value = request.cookies[this.names(realm).session];
    return value !== undefined && TOKEN_SHAPE.test(value) ? value : undefined;
  }
}

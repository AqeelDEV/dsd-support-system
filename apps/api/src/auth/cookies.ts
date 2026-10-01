import { Inject, Injectable } from "@nestjs/common";
import type { SessionRealm } from "@dsd/shared";
import type { CookieSerializeOptions } from "@fastify/cookie";
import type { FastifyReply, FastifyRequest } from "fastify";

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

  /**
   * Sets the session cookie, which scripts can't read, and the CSRF cookie,
   * which the app's own scripts read to fill the X-CSRF-Token header. Both
   * end with the session.
   */
  issue(
    reply: FastifyReply,
    realm: SessionRealm,
    session: { token: string; expiresAt: Date },
    csrfToken: string,
  ): void {
    const names = this.names(realm);
    const options = this.options(session.expiresAt);
    void reply.setCookie(names.session, session.token, {
      ...options,
      httpOnly: true,
    });
    void reply.setCookie(names.csrf, csrfToken, {
      ...options,
      httpOnly: false,
    });
  }

  clear(reply: FastifyReply, realm: SessionRealm): void {
    const names = this.names(realm);
    const options = this.options(new Date(0));
    void reply.clearCookie(names.session, { ...options, httpOnly: true });
    void reply.clearCookie(names.csrf, { ...options, httpOnly: false });
  }

  /** No Domain, so the cookie stays on the exact host that set it: the app's own. */
  private options(expires: Date): CookieSerializeOptions {
    return { secure: this.secure, sameSite: "lax", path: "/", expires };
  }
}

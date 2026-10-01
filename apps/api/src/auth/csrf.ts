import { createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { Env } from "../config/env.js";
import { ENV } from "../infrastructure/tokens.js";
import { deriveKey } from "./secrets.js";

/**
 * CSRF tokens bound to a session (ADR-0003, section 5): an HMAC of the
 * session ID with a server key. Nothing is stored; the server recomputes
 * the token and compares. A page on another site can make the browser
 * send our cookies, but can't read them, so it can't send the token.
 */
@Injectable()
export class CsrfTokens {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    this.key = deriveKey(env.AUTH_SECRET, "dsd/csrf/v1");
  }

  tokenFor(sessionId: string): string {
    return createHmac("sha256", this.key)
      .update(sessionId, "utf8")
      .digest("base64url");
  }

  /** Constant-time, so response timing reveals nothing about the right token. */
  matches(sessionId: string, candidate: string | undefined): boolean {
    if (candidate === undefined) return false;
    const expected = Buffer.from(this.tokenFor(sessionId), "utf8");
    const given = Buffer.from(candidate, "utf8");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

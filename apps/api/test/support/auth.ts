import { DEMO_PASSWORD } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { SessionRealm } from "@dsd/shared";
import type { Redis } from "ioredis";
import request from "supertest";

import { SessionCookies } from "../../src/auth/cookies.js";
import { CsrfTokens } from "../../src/auth/csrf.js";
import {
  SessionService,
  type SessionSubject,
} from "../../src/auth/sessions/session.service.js";
import type { Env } from "../../src/config/env.js";
import { ENV, REDIS } from "../../src/infrastructure/tokens.js";

/** A trusted origin in TEST_ENV: what a browser on our own pages sends. */
export const ORIGIN = "https://support.dsd.example";

export { DEMO_PASSWORD };

/** The demo accounts from the seed (README lists them). */
export const DEMO = {
  customer: "customer@example.com",
  agent: "agent@dsd.example",
  supervisor: "supervisor@dsd.example",
  admin: "admin@dsd.example",
  formerAgent: "former.agent@dsd.example",
  invitedAgent: "new.starter@dsd.example",
} as const;

export interface Credentials {
  /** The session token, as the cookie carries it. */
  token: string;
  /** A Cookie header with this realm's session and CSRF cookies. */
  cookie: string;
  csrfToken: string;
}

/** A Cookie header carrying `token` in `realm`'s session cookie. */
export function sessionCookie(
  app: NestFastifyApplication,
  realm: SessionRealm,
  token: string,
): string {
  return `${app.get(SessionCookies).names(realm).session}=${token}`;
}

/**
 * Signs in through the real endpoint, as a browser on our own pages would.
 * Each call counts against the sign-in rate limits.
 */
export async function signIn(
  app: NestFastifyApplication,
  realm: SessionRealm,
  email: string,
  password = DEMO_PASSWORD,
) {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/auth/${realm}/login`)
    .set("origin", ORIGIN)
    .set("user-agent", "vitest-browser")
    .send({ email, password });
  const names = app.get(SessionCookies).names(realm);
  const setCookies = ([] as string[]).concat(
    response.headers["set-cookie"] ?? [],
  );
  const value = (name: string) =>
    setCookies
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.split(";")[0]
      ?.slice(name.length + 1);
  const token = value(names.session) ?? "";
  const csrfToken = value(names.csrf) ?? "";
  return {
    response,
    setCookies,
    credentials: {
      token,
      csrfToken,
      cookie: `${names.session}=${token}; ${names.csrf}=${csrfToken}`,
    } satisfies Credentials,
  };
}

/**
 * A session made by the real SessionService, without going through sign-in
 * and its rate limits: for tests about what a session may do, not about
 * how it was obtained.
 */
export async function sessionFor(
  app: NestFastifyApplication,
  subject: SessionSubject,
): Promise<Credentials> {
  const session = await app
    .get(SessionService)
    .create(subject, { ip: "127.0.0.1", userAgent: "vitest" });
  const realm = subject.kind === "staff" ? "staff" : "customer";
  const names = app.get(SessionCookies).names(realm);
  const csrfToken = app.get(CsrfTokens).tokenFor(session.id);
  return {
    token: session.token,
    csrfToken,
    cookie: `${names.session}=${session.token}; ${names.csrf}=${csrfToken}`,
  };
}

/** Clears this app's rate-limit counters, so one test's attempts don't affect the next. */
export async function resetRateLimits(
  app: NestFastifyApplication,
): Promise<void> {
  const redis = app.get<Redis>(REDIS);
  const { REDIS_KEY_PREFIX } = app.get<Env>(ENV);
  const keys = await redis.keys(`${REDIS_KEY_PREFIX}rl:*`);
  if (keys.length > 0) await redis.del(...keys);
}

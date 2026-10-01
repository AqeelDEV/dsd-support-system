import { describe, expect, it } from "vitest";

import { parseEnv } from "../config/env.js";
import { CsrfTokens } from "./csrf.js";

const env = (secret: string) =>
  parseEnv({
    DATABASE_URL: "postgres://dsd_api:pw@db:5432/dsd",
    REDIS_URL: "redis://redis:6379",
    TRUSTED_ORIGINS: "https://support.example.com",
    AUTH_SECRET: secret,
  });

const tokens = new CsrfTokens(
  env("a-secret-of-at-least-thirty-two-characters"),
);
const SESSION = "0199a1b2-0000-7000-8000-000000000001";
const OTHER_SESSION = "0199a1b2-0000-7000-8000-000000000002";

describe("CsrfTokens", () => {
  it("gives a session the same token every time, so nothing is stored", () => {
    expect(tokens.tokenFor(SESSION)).toBe(tokens.tokenFor(SESSION));
    expect(tokens.tokenFor(SESSION)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("gives each session its own token", () => {
    expect(tokens.tokenFor(SESSION)).not.toBe(tokens.tokenFor(OTHER_SESSION));
  });

  it("depends on the server secret, so it can't be computed from the session ID", () => {
    const other = new CsrfTokens(
      env("another-secret-of-thirty-two-characters"),
    );
    expect(other.tokenFor(SESSION)).not.toBe(tokens.tokenFor(SESSION));
  });

  it("accepts only the session's own token", () => {
    const token = tokens.tokenFor(SESSION);
    expect(tokens.matches(SESSION, token)).toBe(true);
    expect(tokens.matches(OTHER_SESSION, token)).toBe(false);
    expect(tokens.matches(SESSION, `${token}x`)).toBe(false);
    expect(tokens.matches(SESSION, "")).toBe(false);
    expect(tokens.matches(SESSION, undefined)).toBe(false);
  });
});

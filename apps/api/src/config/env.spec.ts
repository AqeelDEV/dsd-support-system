import { describe, expect, it } from "vitest";

import { ConfigError, parseEnv, PUBLISHED_DEV_AUTH_SECRET } from "./env.js";

const valid = {
  DATABASE_URL: "postgres://dsd_api:s3cret-password@db:5432/dsd",
  REDIS_URL: "redis://redis:6379",
  TRUSTED_ORIGINS: "https://support.example.com",
  AUTH_SECRET: "a-secret-of-at-least-thirty-two-characters",
  S3_ENDPOINT: "http://objects:8333",
  S3_ACCESS_KEY_ID: "access-key",
  S3_SECRET_ACCESS_KEY: "secret-key",
};

function configError(source: Record<string, string | undefined>): ConfigError {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("parseEnv", () => {
  it("applies defaults to a minimal valid environment", () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: "development",
      HOST: "0.0.0.0",
      PORT: 4000,
      LOG_LEVEL: "info",
      CORS_ORIGINS: [],
      TRUST_PROXY: [],
      TRUSTED_ORIGINS: ["https://support.example.com"],
      COOKIE_SECURE: true,
      STAFF_SESSION_MAX_AGE_MINUTES: 720,
      STAFF_SESSION_IDLE_MINUTES: 120,
      CUSTOMER_SESSION_MAX_AGE_MINUTES: 43_200,
      CUSTOMER_SESSION_IDLE_MINUTES: 10_080,
      GUEST_SESSION_MAX_AGE_MINUTES: 1440,
      GUEST_SESSION_IDLE_MINUTES: 1440,
      REDIS_KEY_PREFIX: "dsd:",
      S3_REGION: "us-east-1",
      S3_BUCKET: "dsd-attachments",
      S3_FORCE_PATH_STYLE: true,
      TICKET_BRAND_SLUG: "dsd",
      REPORTING_TIMEZONE: "UTC",
    });
  });

  it("takes an IANA reporting time zone and refuses anything else", () => {
    expect(
      parseEnv({ ...valid, REPORTING_TIMEZONE: "Europe/London" })
        .REPORTING_TIMEZONE,
    ).toBe("Europe/London");
    expect(() =>
      parseEnv({ ...valid, REPORTING_TIMEZONE: "Mars/Olympus_Mons" }),
    ).toThrow(/REPORTING_TIMEZONE/);
  });

  it("parses comma-separated lists", () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: "http://localhost:3000, https://support.example.com",
      TRUST_PROXY: "10.0.0.0/8,127.0.0.1, ::1",
    });
    expect(env.CORS_ORIGINS).toEqual([
      "http://localhost:3000",
      "https://support.example.com",
    ]);
    expect(env.TRUST_PROXY).toEqual(["10.0.0.0/8", "127.0.0.1", "::1"]);
  });

  it("names every missing variable", () => {
    const error = configError({});
    expect(error.problems).toEqual([
      "DATABASE_URL: is required",
      "REDIS_URL: is required",
      "TRUSTED_ORIGINS: Too small: expected array to have >=1 items",
      "AUTH_SECRET: is required",
      "S3_ENDPOINT: is required",
      "S3_ACCESS_KEY_ID: is required",
      "S3_SECRET_ACCESS_KEY: is required",
    ]);
  });

  it.each([
    ["DATABASE_URL", "mysql://user:pw@db/dsd"],
    ["REDIS_URL", "http://redis:6379"],
    ["PORT", "not-a-port"],
    ["PORT", "70000"],
    ["LOG_LEVEL", "verbose"],
    ["CORS_ORIGINS", "not a url"],
    ["TRUST_PROXY", "10.0.0.0/33"],
    ["TRUST_PROXY", "proxy.internal"],
    ["TRUSTED_ORIGINS", "https://support.example.com/app"],
    ["TRUSTED_ORIGINS", "ftp://support.example.com"],
    ["AUTH_SECRET", "too-short"],
    ["COOKIE_SECURE", "maybe"],
    ["STAFF_SESSION_IDLE_MINUTES", "0"],
    ["S3_ENDPOINT", "s3://bucket"],
    ["S3_FORCE_PATH_STYLE", "sometimes"],
  ])("rejects an invalid %s", (key, value) => {
    const error = configError({ ...valid, [key]: value });
    expect(error.problems.some((problem) => problem.startsWith(key))).toBe(
      true,
    );
  });

  it("refuses an idle timeout longer than the session itself", () => {
    const error = configError({
      ...valid,
      STAFF_SESSION_MAX_AGE_MINUTES: "60",
      STAFF_SESSION_IDLE_MINUTES: "120",
    });
    expect(error.problems).toEqual([
      "STAFF_SESSION_IDLE_MINUTES: must not exceed STAFF_SESSION_MAX_AGE_MINUTES",
    ]);
  });

  describe("cookies without the Secure flag", () => {
    it("are allowed when every origin is plain HTTP on this machine", () => {
      const env = parseEnv({
        ...valid,
        TRUSTED_ORIGINS:
          "http://localhost:3000,http://127.0.0.1:3001,http://[::1]:4000",
        COOKIE_SECURE: "false",
      });
      expect(env.COOKIE_SECURE).toBe(false);
    });

    it.each([
      [
        "a real trusted origin",
        {
          TRUSTED_ORIGINS: "http://localhost:3000,https://support.example.com",
        },
      ],
      ["HTTPS on localhost", { TRUSTED_ORIGINS: "https://localhost:3000" }],
      [
        "a real CORS origin",
        {
          TRUSTED_ORIGINS: "http://localhost:3000",
          CORS_ORIGINS: "https://tools.example.com",
        },
      ],
    ])(
      "are refused with %s, so a deployment can't turn them on",
      (_, origins) => {
        const error = configError({
          ...valid,
          ...origins,
          COOKIE_SECURE: "false",
        });
        expect(error.problems).toEqual([
          expect.stringMatching(/^COOKIE_SECURE: can be false only when/),
        ]);
      },
    );
  });

  describe("the development AUTH_SECRET from compose.yaml", () => {
    it("is accepted when every origin is on this machine, as in the Compose stack", () => {
      const env = parseEnv({
        ...valid,
        TRUSTED_ORIGINS: "http://localhost:3000,http://localhost:3001",
        AUTH_SECRET: PUBLISHED_DEV_AUTH_SECRET,
      });
      expect(env.AUTH_SECRET).toBe(PUBLISHED_DEV_AUTH_SECRET);
    });

    it.each([
      [
        "a real trusted origin",
        { TRUSTED_ORIGINS: "https://support.example.com" },
      ],
      [
        "a real CORS origin",
        {
          TRUSTED_ORIGINS: "http://localhost:3000",
          CORS_ORIGINS: "https://tools.example.com",
        },
      ],
    ])("is refused with %s, without printing it", (_, origins) => {
      const error = configError({
        ...valid,
        ...origins,
        AUTH_SECRET: PUBLISHED_DEV_AUTH_SECRET,
      });
      expect(error.problems).toEqual([
        expect.stringMatching(
          /^AUTH_SECRET: is the published development value/,
        ),
      ]);
      expect(error.message).not.toContain(PUBLISHED_DEV_AUTH_SECRET);
    });
  });

  it("never echoes a value, because values include passwords", () => {
    const error = configError({
      DATABASE_URL: "mysql://dsd_api:s3cret-password@db/dsd",
      REDIS_URL: "redis://:another-s3cret@redis:6379",
      PORT: "s3cret-port",
    });
    expect(error.message).not.toMatch(/s3cret/);
  });
});

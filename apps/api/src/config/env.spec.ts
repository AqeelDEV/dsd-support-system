import { describe, expect, it } from "vitest";

import { ConfigError, parseEnv } from "./env.js";

const valid = {
  DATABASE_URL: "postgres://dsd_api:s3cret-password@db:5432/dsd",
  REDIS_URL: "redis://redis:6379",
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
    });
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
  ])("rejects an invalid %s", (key, value) => {
    const error = configError({ ...valid, [key]: value });
    expect(error.problems.some((problem) => problem.startsWith(key))).toBe(
      true,
    );
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

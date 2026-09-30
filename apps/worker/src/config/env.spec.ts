import { describe, expect, it } from "vitest";

import { ConfigError, parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("applies defaults", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgres://dsd_worker:pw@db:5432/dsd",
        REDIS_URL: "redis://redis:6379",
      }),
    ).toEqual({
      NODE_ENV: "development",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://dsd_worker:pw@db:5432/dsd",
      REDIS_URL: "redis://redis:6379",
      STARTUP_TIMEOUT_SECONDS: 60,
    });
  });

  it("requires both connection URLs", () => {
    expect(() => parseEnv({})).toThrow(ConfigError);
  });
});

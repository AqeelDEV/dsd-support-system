import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, parseEnvironment } from "./environment.js";

const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres$/ }),
  PORT: z.coerce.number().int().max(65_535),
});

function configError(source: Record<string, string | undefined>): ConfigError {
  try {
    parseEnvironment(schema, source);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error("expected a ConfigError");
}

describe("parseEnvironment", () => {
  it("returns the parsed values", () => {
    expect(
      parseEnvironment(schema, {
        DATABASE_URL: "postgres://db/dsd",
        PORT: "4000",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://db/dsd",
      PORT: 4000,
    });
  });

  it("lists every problem at once, missing variables by name", () => {
    expect(configError({ PORT: "99999" }).problems).toEqual([
      "DATABASE_URL: is required",
      expect.stringMatching(/^PORT: /),
    ]);
  });

  it("never echoes a value, because values include passwords", () => {
    const error = configError({
      DATABASE_URL: "mysql://user:s3cret@db/dsd",
      PORT: "s3cret",
    });
    expect(error.message).not.toMatch(/s3cret/);
  });
});

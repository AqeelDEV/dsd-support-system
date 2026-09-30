import { isIP } from "node:net";

import { z } from "zod";

const commaSeparated = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const postgresUrl = z
  .url({ protocol: /^postgres(ql)?$/ })
  .describe("postgres:// URL for the dsd_api role");

const redisUrl = z.url({ protocol: /^rediss?$/ });

/** An IP address or CIDR range, as accepted by Fastify's trustProxy. */
const ipOrCidr = z.string().refine(
  (value) => {
    const [address, prefix, ...rest] = value.split("/");
    if (rest.length > 0 || address === undefined || isIP(address) === 0)
      return false;
    if (prefix === undefined) return true;
    const bits = Number(prefix);
    return (
      Number.isInteger(bits) &&
      bits >= 0 &&
      bits <= (isIP(address) === 4 ? 32 : 128)
    );
  },
  { message: "must be an IP address or CIDR range" },
);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  /** Browser origins allowed to call the API directly. The web apps use their own proxy and need no entry. */
  CORS_ORIGINS: commaSeparated.pipe(z.array(z.url())),
  /**
   * Proxies whose X-Forwarded-For header is believed. Empty means the
   * connecting address is the client, which is right when nothing sits in
   * front of the API.
   */
  TRUST_PROXY: commaSeparated.pipe(z.array(ipOrCidr)),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown for invalid configuration. Its message names keys, never values. */
export class ConfigError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

/**
 * Parses the environment, or throws a ConfigError listing every problem.
 * Values are never echoed, because they include database passwords.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw new ConfigError(
    result.error.issues.map((issue) => {
      const key = issue.path.map(String).join(".") || "(root)";
      // Environment variables are strings or absent, so a type error means absent.
      const reason =
        issue.code === "invalid_type" ? "is required" : issue.message;
      return `${key}: ${reason}`;
    }),
  );
}

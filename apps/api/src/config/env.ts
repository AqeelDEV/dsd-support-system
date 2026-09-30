import { isIP } from "node:net";

import { logLevelSchema, nodeEnvSchema, parseEnvironment } from "@dsd/shared";
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
  NODE_ENV: nodeEnvSchema,
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: logLevelSchema,
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

export { ConfigError } from "@dsd/shared";

/** Parses the API's environment, or throws a ConfigError listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvironment(envSchema, source);
}

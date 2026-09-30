import { logLevelSchema, nodeEnvSchema, parseEnvironment } from "@dsd/shared";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema,
  /** postgres:// URL for the dsd_worker role, which can't write messages (ADR-0008). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** How long to wait for PostgreSQL and Redis at startup before giving up. */
  STARTUP_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(600).default(60),
});

export type Env = z.infer<typeof envSchema>;

export { ConfigError } from "@dsd/shared";

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvironment(envSchema, source);
}

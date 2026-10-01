import { logLevelSchema, nodeEnvSchema, parseEnvironment } from "@dsd/shared";
import { z } from "zod";

const appUrl = z
  .url({ protocol: /^https?$/ })
  .transform((url) => url.replace(/\/+$/, ""));

export const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema,
    /** postgres:// URL for the dsd_worker role, which can't write messages (ADR-0008). */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** How long to wait for PostgreSQL and Redis at startup before giving up. */
    STARTUP_TIMEOUT_SECONDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(600)
      .default(60),
    /** Prefix of every BullMQ key, so several deployments or test runs can share a Redis. */
    QUEUE_PREFIX: z.string().min(1).default("dsd-queues"),
    /** How often the dispatcher looks for new outbox rows (ADR-0005, section 3). */
    OUTBOX_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(50)
      .max(60_000)
      .default(500),
    /**
     * The SMTP server notifications are sent through. Locally that is
     * Mailpit, whose web UI shows every email; in production, any provider.
     */
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    /** True for implicit TLS (usually port 465); STARTTLS is used when offered either way. */
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    /** Where links in customer emails point: the customer app. */
    CUSTOMER_APP_URL: appUrl,
    /** Where links in staff emails point: the agent app. */
    AGENT_APP_URL: appUrl,
    /** The brand that sends emails not tied to a ticket, as the API's public brand. */
    TICKET_BRAND_SLUG: z.string().min(1).default("dsd"),
    /** The attachment store, for the orphan sweep (ADR-0009). Same names as the API's. */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("dsd-attachments"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  })
  .superRefine((env, context) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "SMTP_USER and SMTP_PASSWORD go together: set both or neither",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export { ConfigError } from "@dsd/shared";

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvironment(envSchema, source);
}

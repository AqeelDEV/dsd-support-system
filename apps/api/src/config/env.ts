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

/** A browser origin: scheme, host and port, with nothing after it. */
const origin = z
  .url({ protocol: /^https?$/ })
  .refine((value) => new URL(value).origin === value, {
    message:
      "must be an origin such as https://support.example.com, with no path or trailing slash",
  });

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether an origin is plain HTTP on this machine, where Secure cookies can't be used. */
export function isLocalHttpOrigin(value: string): boolean {
  const url = URL.parse(value);
  return url?.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const minutes = (defaultMinutes: number) =>
  z.coerce.number().int().min(1).default(defaultMinutes);

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

export const envSchema = z
  .object({
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
    /**
     * Origins allowed to send state-changing requests (CSRF, ADR-0003): both
     * web apps, and the API's own origin for Swagger UI. CORS_ORIGINS are
     * allowed too.
     */
    TRUSTED_ORIGINS: commaSeparated.pipe(z.array(origin).min(1)),
    /**
     * Derives the CSRF key and the key that hashes emails in rate-limit
     * counters. Changing it invalidates every CSRF token, not the sessions.
     */
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
    /**
     * `true` (the default) sends `__Host-` cookies with the Secure flag.
     * `false` is for running on http://localhost only: Safari refuses Secure
     * cookies there, and Chrome refuses `__Host-` ones. It is rejected unless
     * every trusted origin is plain HTTP on localhost (ADR-0003).
     */
    COOKIE_SECURE: z.stringbool().default(true),
    /** Session lifetimes (ADR-0003, section 2). */
    STAFF_SESSION_MAX_AGE_MINUTES: minutes(12 * 60),
    STAFF_SESSION_IDLE_MINUTES: minutes(2 * 60),
    CUSTOMER_SESSION_MAX_AGE_MINUTES: minutes(30 * 24 * 60),
    CUSTOMER_SESSION_IDLE_MINUTES: minutes(7 * 24 * 60),
    GUEST_SESSION_MAX_AGE_MINUTES: minutes(24 * 60),
    GUEST_SESSION_IDLE_MINUTES: minutes(24 * 60),
    /** Prefix for every key the API writes to Redis. */
    REDIS_KEY_PREFIX: z.string().min(1).default("dsd:"),
    /**
     * The S3-compatible store for attachments (ADR-0009). It should be
     * reachable only from the API; browsers download through the API.
     */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1).default("us-east-1"),
    S3_BUCKET: z.string().min(3).default("dsd-attachments"),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    /** Bucket in the path rather than the host name, as most self-hosted stores need. */
    S3_FORCE_PATH_STYLE: z.stringbool().default(true),
    /**
     * The brand new tickets are filed under. v1 has one brand; with more,
     * each intake (app, address or channel) would name its own.
     */
    TICKET_BRAND_SLUG: z.string().min(1).default("dsd"),
    /**
     * The time zone reporting days are counted in (ADR-0007, section 9).
     * An IANA name; PostgreSQL knows the same set.
     */
    REPORTING_TIMEZONE: z
      .string()
      .default("UTC")
      .refine(
        (zone) =>
          zone === "UTC" || Intl.supportedValuesOf("timeZone").includes(zone),
        { message: "must be an IANA time zone, like Europe/London" },
      ),
  })
  .superRefine((env, context) => {
    for (const realm of ["STAFF", "CUSTOMER", "GUEST"] as const) {
      if (
        env[`${realm}_SESSION_IDLE_MINUTES`] >
        env[`${realm}_SESSION_MAX_AGE_MINUTES`]
      ) {
        context.addIssue({
          code: "custom",
          path: [`${realm}_SESSION_IDLE_MINUTES`],
          message: `must not exceed ${realm}_SESSION_MAX_AGE_MINUTES`,
        });
      }
    }
    const remote = [...env.TRUSTED_ORIGINS, ...env.CORS_ORIGINS].filter(
      (value) => !isLocalHttpOrigin(value),
    );
    if (!env.COOKIE_SECURE && remote.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["COOKIE_SECURE"],
        message:
          "can be false only when every TRUSTED_ORIGINS and CORS_ORIGINS entry is http://localhost or http://127.0.0.1",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export { ConfigError } from "@dsd/shared";

/** Parses the API's environment, or throws a ConfigError listing every problem. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvironment(envSchema, source);
}

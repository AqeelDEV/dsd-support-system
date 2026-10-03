import { logLevelSchema, nodeEnvSchema, parseEnvironment } from "@dsd/shared";
import { z } from "zod";

const appUrl = z
  .url({ protocol: /^https?$/ })
  .transform((url) => url.replace(/\/+$/, ""));

/**
 * An optional value where empty means unset: Docker Compose passes an unset
 * `${VAR:-}` as an empty string.
 */
const optional = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

/** Who drafts AI reply suggestions (ADR-0006, section 2). */
export const LLM_PROVIDERS = ["mock", "gemini", "anthropic", "openai"] as const;
/** Who embeds knowledge-base chunks; `none` means keyword retrieval only. */
export const EMBEDDINGS_PROVIDERS = [
  "mock",
  "gemini",
  "openai",
  "none",
] as const;
/** How much a model may reason before it answers, where the provider offers a choice. */
export const LLM_EFFORTS = ["minimal", "low", "medium", "high"] as const;

/** The key each real provider needs. Anthropic has no embedding model. */
const API_KEYS: Readonly<
  Partial<
    Record<string, "GEMINI_API_KEY" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY">
  >
> = {
  gemini: "GEMINI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};
/**
 * How the offline mock behaves. `grounded` drafts from the sources it is
 * given; the others make it fail in one specific way, so every failure
 * path can be tried in tests and in the running stack without a network.
 */
export const MOCK_LLM_MODES = [
  "grounded",
  "malformed",
  "unknown-citation",
  "no-citations",
  "insufficient",
  "refuse",
  "throw",
  "hang",
  "compromised",
] as const;

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
    /**
     * AI suggestions (ADR-0006). The defaults run everything offline: the
     * mock drafts from the retrieved sources and the mock embeddings hash
     * words, so no API key is needed and no ticket text leaves the system.
     */
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default("mock"),
    /** The chat model; each provider has a default. */
    LLM_MODEL: optional(z.string().min(1)),
    /** How long one draft may take before the attempt fails and is retried. */
    LLM_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
    EMBEDDINGS_PROVIDER: z.enum(EMBEDDINGS_PROVIDERS).default("mock"),
    /** The embedding model; each provider has a default. */
    EMBEDDINGS_MODEL: optional(z.string().min(1)),
    MOCK_LLM_MODE: z.enum(MOCK_LLM_MODES).default("grounded"),
    /**
     * How much the chat model reasons before it answers. Gemini defaults to
     * `low` and Anthropic to `medium`; OpenAI gets none unless it is set,
     * because its models without reasoning reject the setting.
     */
    LLM_EFFORT: optional(z.enum(LLM_EFFORTS)),
    /** One key covers Gemini's chat and embedding models. Needed only when either is in use. */
    GEMINI_API_KEY: optional(z.string().min(1)),
    /** Only for pointing the client somewhere else, such as a test server. */
    GEMINI_BASE_URL: optional(appUrl),
    ANTHROPIC_API_KEY: optional(z.string().min(1)),
    ANTHROPIC_BASE_URL: optional(appUrl),
    /** One key covers OpenAI's chat and embedding models. */
    OPENAI_API_KEY: optional(z.string().min(1)),
    OPENAI_BASE_URL: optional(appUrl),
    /**
     * How long a suggestion waits after a customer's message for more of
     * them, so a burst of short messages gets one draft that reads them all
     * (ADR-0005, section 6).
     */
    AI_DEBOUNCE_MS: z.coerce.number().int().min(0).max(120_000).default(10_000),
    /**
     * The confidence gate's thresholds (ADR-0006, section 5). Each
     * embedding model has defaults set from the evaluation set; these
     * replace them.
     */
    AI_MIN_VECTOR_SIMILARITY: optional(z.coerce.number().min(0).max(1)),
    AI_MIN_KEYWORD_RANK: optional(z.coerce.number().min(0).max(1)),
    AI_MIN_MATCHED_TERMS: optional(z.coerce.number().int().min(1).max(20)),
  })
  .superRefine((env, context) => {
    if ((env.SMTP_USER === undefined) !== (env.SMTP_PASSWORD === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_PASSWORD"],
        message: "SMTP_USER and SMTP_PASSWORD go together: set both or neither",
      });
    }
    for (const setting of ["LLM_PROVIDER", "EMBEDDINGS_PROVIDER"] as const) {
      const provider = env[setting];
      const key = API_KEYS[provider];
      if (key !== undefined && env[key] === undefined) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${setting}=${provider} needs ${key}`,
        });
      }
    }
    if (env.LLM_PROVIDER === "openai" && env.LLM_MODEL === undefined) {
      context.addIssue({
        code: "custom",
        path: ["LLM_MODEL"],
        message: "LLM_PROVIDER=openai needs LLM_MODEL; there is no default",
      });
    }
    if (env.LLM_PROVIDER === "anthropic" && env.LLM_EFFORT === "minimal") {
      context.addIssue({
        code: "custom",
        path: ["LLM_EFFORT"],
        message: "Anthropic models have no minimal effort; use low",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export { ConfigError } from "@dsd/shared";

export function parseEnv(source: Record<string, string | undefined>): Env {
  return parseEnvironment(envSchema, source);
}

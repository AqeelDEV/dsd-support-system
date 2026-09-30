import { z } from "zod";

export const nodeEnvSchema = z
  .enum(["development", "test", "production"])
  .default("development");

export const logLevelSchema = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .default("info");

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
 * Validates a service's environment at startup, so it refuses to run with
 * bad configuration. Every problem is listed at once, and values are never
 * echoed, because they include passwords.
 */
export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  source: Record<string, string | undefined>,
): z.output<Schema> {
  const result = schema.safeParse(source);
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

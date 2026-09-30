import { ConfigError, parseEnvironment } from "@dsd/shared";
import { z } from "zod";

/**
 * The migrate and seed commands connect as `dsd_migrator`, the role that
 * owns the schema. No running service uses this role (ADR-0008).
 */
export function databaseUrlFromEnv(): string {
  const env = parseEnvironment(
    z.object({ DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) }),
    process.env,
  );
  return env.DATABASE_URL;
}

/** Reports a command's failure on stderr and sets a failing exit code. */
export function fail(what: string) {
  return (error: unknown): void => {
    const message =
      error instanceof ConfigError
        ? error.message
        : `${what}: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  };
}

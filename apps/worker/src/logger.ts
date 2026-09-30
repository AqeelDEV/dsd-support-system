import { pino, type DestinationStream, type Logger } from "pino";

import type { Env } from "./config/env.js";

export type { Logger };

/**
 * Structured JSON logs, like the API's. Handlers log IDs and counts, never
 * message bodies, email addresses or prompts.
 */
export function createLogger(
  env: Pick<Env, "LOG_LEVEL">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: env.LOG_LEVEL,
    base: { service: "worker" },
    redact: { paths: ["*.password", "*.token"], censor: "[redacted]" },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

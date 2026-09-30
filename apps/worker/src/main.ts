import { ConfigError, parseEnv } from "./config/env.js";
import { createContainer } from "./container.js";
import { createWorker } from "./lifecycle.js";
import { createLogger } from "./logger.js";

/** Composition root: every dependency the worker has is created here. */
async function main(): Promise<void> {
  const env = parseEnv(process.env);
  const logger = createLogger(env);
  const worker = createWorker(env, createContainer(env, logger), logger);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      logger.info({ signal }, "shutdown requested");
      worker.stop().then(
        () => process.exit(0),
        (error: unknown) => {
          logger.error({ err: error }, "shutdown failed");
          process.exit(1);
        },
      );
    });
  }

  // The open Redis connection keeps the process alive between jobs.
  await worker.start();
}

main().catch((error: unknown) => {
  const message =
    error instanceof ConfigError
      ? error.message
      : `Worker failed to start: ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

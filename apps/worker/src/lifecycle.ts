import type { Env } from "./config/env.js";
import type { Container } from "./container.js";
import type { Logger } from "./logger.js";

export class StartupError extends Error {
  override name = "StartupError";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits until PostgreSQL and Redis both answer, backing off between tries.
 * Compose starts the worker after both report healthy, but in other
 * environments it may come up first, and a short outage at boot shouldn't
 * crash it.
 */
async function waitForDependencies(
  container: Container,
  timeoutMs: number,
  logger: Logger,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 250;
  for (;;) {
    const [database, redis] = await Promise.all([
      container.databaseIsUp(),
      container.redisIsUp(),
    ]);
    if (database && redis) return;

    const down = [
      database ? null : "PostgreSQL",
      redis ? null : "Redis",
    ].filter((name) => name !== null);
    if (Date.now() + delay > deadline) {
      throw new StartupError(
        `Still unreachable after ${Math.round(timeoutMs / 1000)} s: ${down.join(", ")}`,
      );
    }
    logger.info({ waitingFor: down }, "waiting for dependencies");
    await sleep(delay);
    delay = Math.min(delay * 2, 2_000);
  }
}

export interface Worker {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * The worker process. Job handlers (outbox dispatch, notifications, KB
 * indexing, AI suggestions) are registered here as later phases add them.
 * Until then the worker starts, checks its dependencies and shuts down
 * cleanly, which is what the deployment needs from it now.
 */
export function createWorker(
  env: Pick<Env, "STARTUP_TIMEOUT_SECONDS">,
  container: Container,
  logger: Logger,
): Worker {
  let stopping: Promise<void> | undefined;

  return {
    async start() {
      await waitForDependencies(
        container,
        env.STARTUP_TIMEOUT_SECONDS * 1000,
        logger,
      );
      logger.info("worker started");
    },
    stop() {
      stopping ??= (async () => {
        logger.info("worker stopping");
        await container.close();
        logger.info("worker stopped");
      })();
      return stopping;
    },
  };
}

import { createPool, pingDatabase, type Pool } from "@dsd/db";
import { Redis } from "ioredis";

import type { Env } from "./config/env.js";
import type { Logger } from "./logger.js";

const CHECK_TIMEOUT_MS = 2_000;

/**
 * Everything the worker can touch, built explicitly in one place. The
 * worker imports no API code and connects as `dsd_worker`, which has no
 * privilege to write customer-visible messages (ADR-0006, ADR-0008). Keeping
 * the wiring here, rather than in a DI container, makes that capability
 * list easy to audit.
 */
export interface Container {
  readonly pool: Pool;
  readonly redis: Redis;
  databaseIsUp(): Promise<boolean>;
  redisIsUp(): Promise<boolean>;
  close(): Promise<void>;
}

export function createContainer(env: Env, logger: Logger): Container {
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    applicationName: "dsd-worker",
    onError: (error) => {
      logger.warn({ err: error }, "idle database connection failed");
    },
  });

  const redis = new Redis(env.REDIS_URL, {
    // BullMQ requires this for the connections its workers use: a blocking
    // command must wait for Redis to come back rather than fail.
    maxRetriesPerRequest: null,
    connectTimeout: CHECK_TIMEOUT_MS,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });
  redis.on("error", (error: Error) => {
    logger.warn({ reason: error.message }, "redis connection error");
  });

  return {
    pool,
    redis,
    databaseIsUp: () => pingDatabase(pool, CHECK_TIMEOUT_MS),
    async redisIsUp() {
      if (redis.status !== "ready") return false;
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("redis ping timed out"));
        }, CHECK_TIMEOUT_MS);
      });
      try {
        await Promise.race([redis.ping(), timeout]);
        return true;
      } catch {
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      if (redis.status !== "end") {
        const ended = new Promise<void>((resolve) =>
          redis.once("end", () => {
            resolve();
          }),
        );
        if (redis.status === "ready") {
          // QUIT lets Redis finish in-flight commands; if the connection
          // drops first, disconnecting is all that's left to do.
          await redis.quit().catch(() => {
            redis.disconnect();
          });
        } else {
          redis.disconnect();
        }
        // A connection that never opened may not emit "end"; don't let
        // that hold up shutdown.
        await Promise.race([
          ended,
          new Promise((resolve) => setTimeout(resolve, CHECK_TIMEOUT_MS)),
        ]);
      }
      await pool.end();
    },
  };
}

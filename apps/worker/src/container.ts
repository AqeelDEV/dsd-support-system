import {
  createDb,
  createPool,
  type Database,
  pingDatabase,
  type Pool,
} from "@dsd/db";
import { Redis } from "ioredis";

import { createModels } from "./ai/providers/index.js";
import type { AiModels } from "./ai/providers/types.js";
import type { Env } from "./config/env.js";
import { ObjectStore } from "./infrastructure/object-store.js";
import type { Logger } from "./logger.js";
import type { NotificationChannel } from "./notifications/channel.js";
import { EmailChannel } from "./notifications/email-channel.js";

const CHECK_TIMEOUT_MS = 2_000;

/**
 * Everything the worker can touch, built explicitly in one place. The
 * worker imports no API code and connects as `dsd_worker`, which has no
 * privilege to write customer-visible messages, nor to read any message
 * except through `public_reply_bodies` (ADR-0006, ADR-0008). Keeping the
 * wiring here, rather than in a DI container, makes that capability list
 * easy to audit.
 */
export interface Container {
  readonly pool: Pool;
  readonly db: Database;
  /** For queue consumers: blocking commands wait for Redis to come back. */
  readonly redis: Redis;
  /**
   * For adding jobs: commands fail at once while Redis is unreachable, so
   * the outbox dispatcher rolls back instead of holding its rows locked.
   */
  readonly producer: Redis;
  readonly store: ObjectStore;
  readonly channels: readonly NotificationChannel[];
  /** The chat and embedding models AI suggestions use: the offline mock unless configured. */
  readonly ai: AiModels;
  databaseIsUp(): Promise<boolean>;
  redisIsUp(): Promise<boolean>;
  close(): Promise<void>;
}

async function ping(redis: Redis): Promise<boolean> {
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
}

async function closeRedis(redis: Redis): Promise<void> {
  if (redis.status === "end") return;
  const ended = new Promise<void>((resolve) =>
    redis.once("end", () => {
      resolve();
    }),
  );
  if (redis.status === "ready") {
    // QUIT lets Redis finish in-flight commands; if the connection drops
    // first, disconnecting is all that's left to do.
    await redis.quit().catch(() => {
      redis.disconnect();
    });
  } else {
    redis.disconnect();
  }
  // A connection that never opened may not emit "end"; don't let that hold
  // up shutdown.
  await Promise.race([
    ended,
    new Promise((resolve) => setTimeout(resolve, CHECK_TIMEOUT_MS)),
  ]);
}

/** What tests may swap: the AI models, to make a provider fail in a chosen way. */
export interface ContainerOverrides {
  ai?: Partial<AiModels>;
}

export function createContainer(
  env: Env,
  logger: Logger,
  overrides: ContainerOverrides = {},
): Container {
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    applicationName: "dsd-worker",
    onError: (error) => {
      logger.warn({ err: error }, "idle database connection failed");
    },
  });

  const reconnect = (attempt: number) => Math.min(attempt * 250, 5_000);
  const redis = new Redis(env.REDIS_URL, {
    // BullMQ requires this for the connections its workers use: a blocking
    // command must wait for Redis to come back rather than fail.
    maxRetriesPerRequest: null,
    connectTimeout: CHECK_TIMEOUT_MS,
    retryStrategy: reconnect,
  });
  const producer = new Redis(env.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: CHECK_TIMEOUT_MS,
    retryStrategy: reconnect,
  });
  for (const connection of [redis, producer]) {
    connection.on("error", (error: Error) => {
      logger.warn({ reason: error.message }, "redis connection error");
    });
  }

  const email = new EmailChannel(env);
  const store = new ObjectStore(env);

  return {
    pool,
    db: createDb(pool),
    redis,
    producer,
    store,
    channels: [email],
    ai: { ...createModels(env), ...overrides.ai },
    databaseIsUp: () => pingDatabase(pool, CHECK_TIMEOUT_MS),
    async redisIsUp() {
      const [consumers, jobs] = await Promise.all([
        ping(redis),
        ping(producer),
      ]);
      return consumers && jobs;
    },
    async close() {
      email.close();
      store.close();
      await Promise.all([closeRedis(redis), closeRedis(producer)]);
      await pool.end();
    },
  };
}

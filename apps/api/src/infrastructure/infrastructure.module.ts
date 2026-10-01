import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from "@nestjs/common";
import { createDb, createPool, type Database, type Pool } from "@dsd/db";
import { Redis } from "ioredis";

import type { Env } from "../config/env.js";
import { createS3Client, ObjectStore } from "./object-store.js";
import { DB, DB_POOL, ENV, REDIS } from "./tokens.js";

const REDIS_STARTUP_GRACE_MS = 2_000;

function createRedis(env: Env): Redis {
  const logger = new Logger("Redis");
  const redis = new Redis(env.REDIS_URL, {
    // Connected in onModuleInit, without blocking startup for long: the API
    // keeps serving core support work while Redis is down (NFR-10).
    lazyConnect: true,
    // Fail commands at once instead of queueing them while disconnected,
    // so a Redis outage shows up as an error, not as a hung request.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    retryStrategy: (attempt) => Math.min(attempt * 250, 5_000),
  });
  redis.on("error", (error: Error) => {
    logger.warn(`Redis connection error: ${error.message}`);
  });
  return redis;
}

@Injectable()
class ConnectionLifecycle implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("Connections");

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly objects: ObjectStore,
  ) {}

  /**
   * Gives Redis a moment to connect so readiness is accurate from the first
   * request, but never blocks startup on it: without Redis the API still
   * serves core support work, and ioredis keeps retrying in the background.
   */
  async onModuleInit(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const grace = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, REDIS_STARTUP_GRACE_MS);
    });
    const connect = this.redis.connect().catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis is not reachable yet; retrying in the background (${reason})`,
      );
    });
    await Promise.race([connect, grace]);
    clearTimeout(timer);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === "ready") {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
    this.objects.close();
    await this.pool.end();
  }
}

/**
 * Configuration and the shared connections. Nothing here keeps request or
 * ticket state: sessions live in Postgres, counters in Redis and files in
 * the object store, so any instance can serve any request (NFR-2).
 */
@Global()
@Module({})
export class InfrastructureModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: InfrastructureModule,
      providers: [
        { provide: ENV, useValue: env },
        {
          provide: DB_POOL,
          useFactory: (): Pool => {
            const logger = new Logger("Database");
            return createPool({
              connectionString: env.DATABASE_URL,
              applicationName: "dsd-api",
              onError: (error) => {
                logger.warn(
                  `Idle database connection failed: ${error.message}`,
                );
              },
            });
          },
        },
        {
          provide: DB,
          useFactory: (pool: Pool): Database => createDb(pool),
          inject: [DB_POOL],
        },
        { provide: REDIS, useFactory: () => createRedis(env) },
        {
          provide: ObjectStore,
          useFactory: () => new ObjectStore(createS3Client(env), env.S3_BUCKET),
        },
        ConnectionLifecycle,
      ],
      exports: [ENV, DB_POOL, DB, REDIS, ObjectStore],
    };
  }
}

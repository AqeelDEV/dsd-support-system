import { Inject, Injectable } from "@nestjs/common";
import { pingDatabase, type Pool } from "@dsd/db";
import type { DependencyStatus, Readiness } from "@dsd/shared";
import type { Redis } from "ioredis";

import { DB_POOL, REDIS } from "../../infrastructure/tokens.js";

const CHECK_TIMEOUT_MS = 1_000;

async function pingRedis(redis: Redis, timeoutMs: number): Promise<boolean> {
  if (redis.status !== "ready") return false;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("redis ping timed out"));
    }, timeoutMs);
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

const status = (up: boolean): DependencyStatus => (up ? "up" : "down");

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * PostgreSQL is the system of record, so without it the API can't serve
   * anything useful. Redis only carries rate limits and queues: without it,
   * ticket work continues and background work waits in the outbox, so the
   * instance stays in rotation and reports `degraded` (ARCHITECTURE.md,
   * "When a dependency fails").
   */
  async readiness(): Promise<Readiness> {
    const [database, redis] = await Promise.all([
      pingDatabase(this.pool, CHECK_TIMEOUT_MS),
      pingRedis(this.redis, CHECK_TIMEOUT_MS),
    ]);
    return {
      status: !database ? "unavailable" : redis ? "ok" : "degraded",
      checks: { database: status(database), redis: status(redis) },
    };
  }
}

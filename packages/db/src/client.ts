import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Pool = pg.Pool;
export type Database = NodePgDatabase;

export interface PoolOptions {
  /** A `postgres://` URL. Each service connects as its own role (ADR-0008). */
  connectionString: string;
  /** Shows up in `pg_stat_activity`, so connections can be traced to a service. */
  applicationName: string;
  /**
   * Called when an idle pooled connection fails, for example because the
   * server restarted. Without a listener, node-postgres would crash the
   * process; with one, the pool discards the connection and carries on.
   */
  onError: (error: Error) => void;
  max?: number;
  connectionTimeoutMillis?: number;
}

export function createPool(options: PoolOptions): Pool {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", options.onError);
  return pool;
}

export function createDb(pool: Pool): Database {
  return drizzle({ client: pool });
}

/**
 * Whether the database answers a trivial query within `timeoutMs`. Used by
 * readiness checks, so it reports rather than throws.
 */
export async function pingDatabase(
  pool: Pool,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`database ping timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    await Promise.race([pool.query("SELECT 1"), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

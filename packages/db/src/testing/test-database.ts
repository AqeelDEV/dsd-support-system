import { createPool, type Pool } from "../client.js";
import { runMigrations } from "../migrate.js";

/**
 * Throwaway databases for tests that need real PostgreSQL: its constraints,
 * triggers and privileges are exactly what these tests are about, so a mock
 * would prove nothing.
 *
 * Each database is created on the compose PostgreSQL (or whatever the
 * environment points at) the same way the container's first-time setup
 * creates `dsd`: owned by `dsd_migrator`, connectable by the three roles,
 * with pgvector installed by a superuser. Then the real migrations run.
 */

/** Defaults match the development credentials in compose.yaml. */
const settings = {
  adminUrl:
    process.env.TEST_DATABASE_ADMIN_URL ??
    `postgres://postgres:${process.env.POSTGRES_PASSWORD ?? "postgres-dev-password"}@127.0.0.1:${process.env.POSTGRES_PORT ?? "15432"}/postgres`,
  passwords: {
    dsd_migrator: process.env.DSD_MIGRATOR_PASSWORD ?? "migrator-dev-password",
    dsd_api: process.env.DSD_API_PASSWORD ?? "api-dev-password",
    dsd_worker: process.env.DSD_WORKER_PASSWORD ?? "worker-dev-password",
  },
};

export type Role = keyof typeof settings.passwords;

export interface TestDatabase {
  readonly name: string;
  /** A connection string for `role` on this database. */
  url(role: Role): string;
  /** A pool connected as `role`, closed by `drop()`. */
  pool(role: Role): Pool;
  /** Closes every pool and drops the database. */
  drop(): Promise<void>;
}

const SAFE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

function withDatabase(url: string, database: string, role?: Role): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (role !== undefined) {
    parsed.username = role;
    parsed.password = settings.passwords[role];
  }
  return parsed.toString();
}

function adminPool(database: string): Pool {
  return createPool({
    connectionString: withDatabase(settings.adminUrl, database),
    applicationName: "dsd-test-admin",
    max: 1,
    onError: () => undefined,
  });
}

/**
 * Creates `name` from scratch (dropping any leftover from an earlier run)
 * and migrates it. Use a distinct name per test file, so files can run in
 * parallel.
 */
export async function createTestDatabase(
  name: string,
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  if (!SAFE_NAME.test(name))
    throw new Error(`Unsafe test database name: ${name}`);

  const admin = adminPool("postgres");
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}" OWNER dsd_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.query(
      `GRANT CONNECT ON DATABASE "${name}" TO dsd_migrator, dsd_api, dsd_worker`,
    );
  } finally {
    await admin.end();
  }

  const adminOnNew = adminPool(name);
  try {
    await adminOnNew.query("CREATE EXTENSION IF NOT EXISTS vector");
  } finally {
    await adminOnNew.end();
  }

  const pools = new Map<Role, Pool>();
  const database: TestDatabase = {
    name,
    url: (role) => withDatabase(settings.adminUrl, name, role),
    pool(role) {
      let pool = pools.get(role);
      if (pool === undefined) {
        pool = createPool({
          connectionString: database.url(role),
          applicationName: `dsd-test-${role}`,
          max: 4,
          onError: () => undefined,
        });
        pools.set(role, pool);
      }
      return pool;
    },
    async drop() {
      await Promise.all([...pools.values()].map((pool) => pool.end()));
      pools.clear();
      const cleanup = adminPool("postgres");
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };

  if (options.migrate ?? true) {
    await runMigrations(database.pool("dsd_migrator"));
  }
  return database;
}

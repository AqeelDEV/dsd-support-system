import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb, type Pool } from "./client.js";

/** The SQL migrations shipped with this package. */
export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../migrations", import.meta.url),
);

/**
 * Applies every pending migration, in order, in one transaction. Run as
 * `dsd_migrator`, the role that owns the schema; the API and worker roles
 * can't run DDL.
 */
export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}

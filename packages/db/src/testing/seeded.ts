import { seedDatabase } from "../seed/index.js";
import { createTestDatabase, type TestDatabase } from "./test-database.js";

/** A fixed "now" for the demo data, so every run sees the same rows. */
export const SEED_ANCHOR = new Date("2026-09-30T12:00:00Z");

/**
 * A freshly migrated database with the demo data, for one test file. The
 * name must be unique per file, because files run in parallel.
 */
export async function createSeededDatabase(
  name: string,
): Promise<TestDatabase> {
  const database = await createTestDatabase(name);
  await seedDatabase(database.pool("dsd_migrator"), { anchor: SEED_ANCHOR });
  return database;
}

/** Runs one statement as the schema owner, to arrange or inspect rows a test needs. */
export async function asOwner<Row extends object = Record<string, unknown>>(
  database: TestDatabase,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await database.pool("dsd_migrator").query(text, values);
  return result.rows as Row[];
}

/** The ID of a seeded account, by email. */
export async function idOf(
  database: TestDatabase,
  table: "agents" | "customers",
  email: string,
): Promise<string> {
  const [row] = await asOwner<{ id: string }>(
    database,
    `SELECT id FROM ${table} WHERE email_normalized = $1`,
    [email],
  );
  if (row === undefined) throw new Error(`no ${table} row for ${email}`);
  return row.id;
}

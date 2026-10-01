import { randomUUID } from "node:crypto";

import {
  createTestDatabase,
  seedDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import type { AppModuleOptions } from "../../src/app.module.js";
import { startApp } from "./app.js";

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

/**
 * The real application, connected to `database` as the API's own role, with
 * Redis keys under a prefix of its own so test files never share counters.
 */
export function startAppOn(
  database: TestDatabase,
  overrides: Record<string, string> = {},
  options: AppModuleOptions = {},
): Promise<NestFastifyApplication> {
  return startApp(
    {
      DATABASE_URL: database.url("dsd_api"),
      REDIS_KEY_PREFIX: `test:${database.name}:${randomUUID()}:`,
      ...overrides,
    },
    options,
  );
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

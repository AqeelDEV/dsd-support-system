import { runMigrations } from "../src/migrate.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  documentedChecks,
  documentedTables,
  documentedTriggers,
  documentedViews,
} from "./docs.js";

describe("migrations", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    // Creating the database runs every migration from zero.
    db = await createTestDatabase("dsd_test_migrations");
  });

  afterAll(async () => {
    await db.drop();
  });

  const names = async (query: string) =>
    (await db.pool("dsd_migrator").query<{ name: string }>(query)).rows
      .map((row) => row.name)
      .sort();

  it("records every migration once, and a second run changes nothing", async () => {
    const applied = async () =>
      (
        await db
          .pool("dsd_migrator")
          .query("SELECT hash FROM drizzle.__drizzle_migrations")
      ).rowCount;
    const before = await applied();
    expect(before).toBeGreaterThanOrEqual(5);

    await runMigrations(db.pool("dsd_migrator"));
    expect(await applied()).toBe(before);
  });

  it("creates exactly the tables in DATA_MODEL.md", async () => {
    const tables = await names(
      "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(tables).toEqual(documentedTables().sort());
  });

  it("creates exactly the views in DATA_MODEL.md", async () => {
    const views = await names(
      "SELECT viewname AS name FROM pg_views WHERE schemaname = 'public'",
    );
    expect(views).toEqual([...documentedViews().keys()].sort());
  });

  it("creates exactly the CHECK constraints in DATA_MODEL.md, by name", async () => {
    const checks = await names(
      "SELECT conname AS name FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace",
    );
    expect(checks).toEqual(documentedChecks().sort());
  });

  it("creates exactly the triggers in DATA_MODEL.md", async () => {
    const triggers = await names(
      "SELECT tgname AS name FROM pg_trigger WHERE NOT tgisinternal",
    );
    expect(triggers).toEqual(documentedTriggers().sort());
  });

  it("keeps every generated identifier within PostgreSQL's 63-byte limit", async () => {
    // Longer names are silently truncated, and would then differ from the
    // names recorded in the migration snapshots.
    const tooLong = await names(
      "SELECT conname AS name FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND length(conname) >= 63 UNION SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND length(indexname) >= 63",
    );
    expect(tooLong).toEqual([]);
  });
});

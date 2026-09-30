import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit compares the schema with the snapshots in migrations/meta to
 * write new migrations. It never inspects a live database, so the
 * hand-written migrations (triggers, grants) are not seen as drift.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});

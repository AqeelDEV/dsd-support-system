import { createPool } from "../client.js";
import { runMigrations } from "../migrate.js";
import { databaseUrlFromEnv, fail } from "./env.js";

async function main(): Promise<void> {
  const pool = createPool({
    connectionString: databaseUrlFromEnv(),
    applicationName: "dsd-migrate",
    max: 1,
    onError: (error) => {
      process.stderr.write(`Database connection error: ${error.message}\n`);
    },
  });
  try {
    await runMigrations(pool);
    process.stdout.write("Migrations are up to date.\n");
  } finally {
    await pool.end();
  }
}

main().catch(fail("Migration failed"));

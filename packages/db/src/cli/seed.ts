import { createPool } from "../client.js";
import { seedDatabase } from "../seed/index.js";
import { databaseUrlFromEnv, fail } from "./env.js";

async function main(): Promise<void> {
  const pool = createPool({
    connectionString: databaseUrlFromEnv(),
    applicationName: "dsd-seed",
    max: 1,
    onError: (error) => {
      process.stderr.write(`Database connection error: ${error.message}\n`);
    },
  });
  try {
    const result = await seedDatabase(pool);
    process.stdout.write(
      result.seeded
        ? `Seeded demo data: ${result.counts.agents} staff, ${result.counts.customers} customers, ${result.counts.tickets} tickets.\n`
        : `Skipped seeding: ${result.reason}.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch(fail("Seeding failed"));

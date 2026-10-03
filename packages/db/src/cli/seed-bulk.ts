import { createPool } from "../client.js";
import { seedBulkTickets } from "../seed/index.js";
import { databaseUrlFromEnv, fail } from "./env.js";

/*
 * Adds generated tickets for performance work (NFR-1) to a database the
 * demo seed has filled:
 *
 *   node dist/cli/seed-bulk.js [count]     (default 5000)
 *
 * On the Compose stack: `docker compose run --rm migrate node
 * dist/cli/seed-bulk.js 5000`. It can run once per database; the demo
 * data is left as it is.
 */
async function main(): Promise<void> {
  const argument = process.argv[2] ?? "5000";
  const tickets = Number(argument);
  if (!Number.isInteger(tickets) || tickets < 1) {
    throw new Error(`"${argument}" isn't a ticket count`);
  }
  const pool = createPool({
    connectionString: databaseUrlFromEnv(),
    applicationName: "dsd-seed-bulk",
    max: 1,
    onError: (error) => {
      process.stderr.write(`Database connection error: ${error.message}\n`);
    },
  });
  try {
    const started = performance.now();
    const result = await seedBulkTickets(pool, { tickets });
    process.stdout.write(
      `Added ${String(result.tickets)} tickets, ${String(result.customers)} customers, ${String(result.messages)} messages and ${String(result.auditEvents)} audit events in ${((performance.now() - started) / 1000).toFixed(1)} s.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch(fail("Bulk seeding failed"));

import {
  bootstrapProduction,
  bootstrapSettingsFromEnv,
  PRODUCTION_BRAND,
} from "../bootstrap.js";
import { createPool } from "../client.js";
import { fail } from "./env.js";

/**
 * Runs after the migrations on a real deployment, in place of the demo
 * seed. It never prints the admin's password, or anything else it reads.
 */
async function main(): Promise<void> {
  const { databaseUrl, settings } = bootstrapSettingsFromEnv(process.env);
  const pool = createPool({
    connectionString: databaseUrl,
    applicationName: "dsd-bootstrap",
    max: 1,
    onError: (error) => {
      process.stderr.write(`Database connection error: ${error.message}\n`);
    },
  });
  try {
    const result = await bootstrapProduction(pool, settings);
    process.stdout.write(
      result.bootstrapped
        ? `Bootstrapped brand ${PRODUCTION_BRAND.slug} and its first admin.\n`
        : `Skipped bootstrap: ${result.reason}.\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch(fail("Bootstrap failed"));

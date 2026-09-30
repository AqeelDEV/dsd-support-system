import { eq } from "drizzle-orm";

import { createDb, type Pool } from "../client.js";
import { brands } from "../schema/index.js";
import { DEMO_BRAND, DEMO_PASSWORD, generateSeedPlan } from "./generate.js";
import { hashPassword } from "./password.js";
import { writeSeedPlan } from "./write.js";

export { DEMO_PASSWORD, generateSeedPlan, type SeedPlan } from "./generate.js";

export type SeedResult =
  | { seeded: false; reason: string }
  | {
      seeded: true;
      counts: { agents: number; customers: number; tickets: number };
    };

/**
 * Loads the demo data into an empty database. It runs only once: if the
 * demo brand already exists it does nothing, because history rows can't be
 * deleted to seed again (`docker compose down -v` starts from scratch).
 *
 * `anchor` is "now" for the demo, so the data always looks recent. Tests
 * pass a fixed anchor to get identical data every time.
 */
export async function seedDatabase(
  pool: Pool,
  options: { anchor?: Date } = {},
): Promise<SeedResult> {
  const existing = await createDb(pool)
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.slug, DEMO_BRAND.slug))
    .limit(1);
  if (existing.length > 0) {
    return { seeded: false, reason: "the demo brand already exists" };
  }

  const anchor = options.anchor ?? startOfHour(new Date());
  const plan = generateSeedPlan(anchor);
  await writeSeedPlan(pool, plan, await hashPassword(DEMO_PASSWORD));
  return {
    seeded: true,
    counts: {
      agents: plan.agents.length,
      customers: plan.customers.length,
      tickets: plan.tickets.length,
    },
  };
}

function startOfHour(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

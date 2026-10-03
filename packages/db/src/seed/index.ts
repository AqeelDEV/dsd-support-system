import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { createDb, type Pool } from "../client.js";
import { brands } from "../schema/index.js";
import {
  type SeedObjectStore,
  seedFile,
  sha256,
  type StoredFile,
} from "./files.js";
import {
  DEMO_BRAND,
  DEMO_PASSWORD,
  generateSeedPlan,
  type SeedPlan,
} from "./generate.js";
import { hashPassword } from "./password.js";
import { writeSeedPlan } from "./write.js";

export {
  type BulkSeedResult,
  FIRST_BULK_CUSTOMER,
  seedBulkTickets,
} from "./bulk.js";
export { type SeedFileKind, type SeedObjectStore, seedFile } from "./files.js";
export { DEMO_PASSWORD, generateSeedPlan, type SeedPlan } from "./generate.js";

export type SeedResult =
  | { seeded: false; reason: string }
  | {
      seeded: true;
      counts: {
        agents: number;
        customers: number;
        tickets: number;
        attachments: number;
      };
    };

/**
 * Loads the demo data into an empty database. It runs only once: if the
 * demo brand already exists it does nothing, because history rows can't be
 * deleted to seed again (`docker compose down -v` starts from scratch).
 *
 * `anchor` is "now" for the demo, so the data always looks recent. Tests
 * pass a fixed anchor to get identical data every time.
 *
 * With `objects`, the customers' files go into the object store first (its
 * bucket made if missing), and their rows are written with the rest. A row
 * then never points at a file that isn't there; a file whose rows failed is
 * left for the worker's orphan sweep.
 */
export async function seedDatabase(
  pool: Pool,
  options: { anchor?: Date; objects?: SeedObjectStore } = {},
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
  const stored =
    options.objects === undefined
      ? new Map<string, StoredFile>()
      : await storeFiles(plan, options.objects);
  await writeSeedPlan(pool, plan, await hashPassword(DEMO_PASSWORD), stored);
  return {
    seeded: true,
    counts: {
      agents: plan.agents.length,
      customers: plan.customers.length,
      tickets: plan.tickets.length,
      attachments: stored.size,
    },
  };
}

/** Puts every planned file in the store, under a random key as uploads get (ADR-0009). */
async function storeFiles(
  plan: SeedPlan,
  objects: SeedObjectStore,
): Promise<Map<string, StoredFile>> {
  await objects.ensureBucket();
  const stored = new Map<string, StoredFile>();
  for (const attachment of plan.tickets.flatMap(
    (ticket) => ticket.attachments,
  )) {
    const file = seedFile(attachment.kind, attachment.details);
    const objectKey = `attachments/${randomUUID()}`;
    await objects.put(objectKey, file.bytes, file.contentType);
    stored.set(attachment.key, {
      objectKey,
      contentType: file.contentType,
      sizeBytes: file.bytes.length,
      sha256: sha256(file.bytes),
    });
  }
  return stored;
}

function startOfHour(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

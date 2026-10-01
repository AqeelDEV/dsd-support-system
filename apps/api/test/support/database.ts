import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import type { AppModuleOptions } from "../../src/app.module.js";
import { startApp } from "./app.js";

// The seeded-database helpers live in @dsd/db/testing, shared with the worker.
export {
  asOwner,
  createSeededDatabase,
  idOf,
  SEED_ANCHOR,
} from "@dsd/db/testing";

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

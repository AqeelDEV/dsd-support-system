/**
 * Helpers for tests that run against real PostgreSQL. Test code only:
 * nothing in a running service imports this.
 */
export {
  createTestDatabase,
  type Role,
  type TestDatabase,
} from "./test-database.js";
export {
  expectPgError,
  inRolledBackTransaction,
  SQLSTATE,
  type PgErrorFields,
} from "./pg-errors.js";
/**
 * The demo data, for tests in other packages that need realistic rows:
 * the API's auth and RBAC tests sign in as the seeded demo accounts.
 */
export { DEMO_PASSWORD, seedDatabase, type SeedResult } from "../seed/index.js";
export { asOwner, createSeededDatabase, idOf, SEED_ANCHOR } from "./seeded.js";

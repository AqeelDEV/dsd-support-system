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

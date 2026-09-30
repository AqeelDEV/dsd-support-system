import type { PoolClient } from "pg";

import type { Pool } from "../client.js";

/** The parts of a PostgreSQL error that tests assert on. */
export interface PgErrorFields {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
}

function asPgError(error: unknown): PgErrorFields | undefined {
  // Drizzle wraps driver errors; the PostgreSQL fields live on the cause.
  const candidate =
    error instanceof Error && "cause" in error && error.cause instanceof Error
      ? error.cause
      : error;
  if (
    candidate instanceof Error &&
    "code" in candidate &&
    typeof candidate.code === "string"
  ) {
    const fields = candidate as Error & {
      code: string;
      constraint?: string;
      table?: string;
    };
    return {
      code: fields.code,
      message: fields.message,
      ...(fields.constraint === undefined
        ? {}
        : { constraint: fields.constraint }),
      ...(fields.table === undefined ? {} : { table: fields.table }),
    };
  }
  return undefined;
}

/**
 * Runs `work` in a transaction that is always rolled back, so each test
 * leaves the database as it found it.
 */
export async function inRolledBackTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await work(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

/**
 * Runs one statement that is expected to fail, inside a savepoint so the
 * surrounding transaction stays usable, and returns the error's fields.
 * Throws if the statement succeeds.
 */
export async function expectPgError(
  client: PoolClient,
  statement: string,
  values: unknown[] = [],
): Promise<PgErrorFields> {
  await client.query("SAVEPOINT expect_error");
  try {
    await client.query(statement, values);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT expect_error");
    const fields = asPgError(error);
    if (fields === undefined) throw error;
    return fields;
  }
  await client.query("RELEASE SAVEPOINT expect_error");
  throw new Error(
    `Expected this statement to fail, but it succeeded: ${statement}`,
  );
}

/** SQLSTATE codes the tests use. */
export const SQLSTATE = {
  checkViolation: "23514",
  foreignKeyViolation: "23503",
  uniqueViolation: "23505",
  notNullViolation: "23502",
  insufficientPrivilege: "42501",
  raiseException: "P0001",
} as const;

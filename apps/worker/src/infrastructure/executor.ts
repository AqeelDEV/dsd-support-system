import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Anything that runs queries: the database itself or an open transaction,
 * so several repository calls can share one transaction.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";

/**
 * Anything that runs queries: the database itself or an open transaction.
 * Repository methods take one, so a service can run several of them in a
 * single transaction.
 */
export type Executor = PgDatabase<NodePgQueryResultHKT>;

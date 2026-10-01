/** Dependency-injection tokens for values that aren't classes. */
export const ENV = Symbol("ENV");
export const DB_POOL = Symbol("DB_POOL");
/** The Drizzle query builder over DB_POOL. */
export const DB = Symbol("DB");
export const REDIS = Symbol("REDIS");

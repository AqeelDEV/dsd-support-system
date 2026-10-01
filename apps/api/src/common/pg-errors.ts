/** The PostgreSQL error code on `error`, or on the error it wraps (Drizzle wraps driver errors). */
export function sqlState(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** The constraint a PostgreSQL error names, from the error itself or the one it wraps. */
function constraintOf(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** Whether `error` is a unique violation (23505) of `constraint`. */
export function violates(error: unknown, constraint: string): boolean {
  return sqlState(error) === "23505" && constraintOf(error) === constraint;
}

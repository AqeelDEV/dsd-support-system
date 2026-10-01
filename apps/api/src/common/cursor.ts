import { ZodValidationException } from "nestjs-zod";
import { z } from "zod";

/*
 * Keyset pagination cursors (ARCHITECTURE, "API conventions"). A cursor
 * holds the sort order it belongs to, the sort key of the last row on the
 * page and that row's ID, so the next page starts exactly after it, and
 * later pages cost the same as the first.
 *
 * Cursors are opaque to clients but not signed: every query still filters
 * on what the caller may see, so a hand-made cursor can only move where a
 * page starts, never reveal a row.
 */

/** A timestamp as PostgreSQL stores it, to the microsecond, in UTC. */
export const exactTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

const envelope = z.object({
  sort: z.string(),
  keys: z.array(z.union([z.string(), z.number()])),
  id: z.uuid(),
});

export interface Position<Keys> {
  keys: Keys;
  id: string;
}

export function encodeCursor(
  sort: string,
  position: Position<readonly (string | number)[]>,
): string {
  return Buffer.from(
    JSON.stringify({ sort, keys: position.keys, id: position.id }),
  ).toString("base64url");
}

const invalidCursor = () =>
  new ZodValidationException(
    new z.ZodError([
      {
        code: "custom",
        path: ["cursor"],
        message: "Not a cursor from this list; start again without one",
        input: undefined,
      },
    ]),
  );

/**
 * Reads a cursor made by `encodeCursor` for the same `sort`, checking its
 * keys against `keys`. Anything else, including a cursor from another sort
 * order, is a 400.
 */
export function decodeCursor<Keys extends z.ZodType>(
  cursor: string,
  sort: string,
  keys: Keys,
): Position<z.output<Keys>> {
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  const parsed = envelope.safeParse(raw);
  if (!parsed.success || parsed.data.sort !== sort) throw invalidCursor();
  const parsedKeys = keys.safeParse(parsed.data.keys);
  if (!parsedKeys.success) throw invalidCursor();
  return { keys: parsedKeys.data, id: parsed.data.id };
}

/**
 * One page from `rows`, which the query fetched with one row more than
 * `limit` to learn whether another page follows.
 */
export function pageFrom<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => string,
): { items: Item[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toItem),
    nextCursor:
      rows.length > limit && last !== undefined ? cursorOf(last) : null,
  };
}

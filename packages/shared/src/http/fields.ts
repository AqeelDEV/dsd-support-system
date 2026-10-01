import { z } from "zod";

/*
 * Building blocks for request schemas, shared by every resource so text,
 * repeated query parameters and paging behave the same everywhere.
 */

/**
 * Free text as PostgreSQL can store it: trimmed, within the column's CHECK
 * limit, and without NUL characters, which a `text` column can't hold.
 * zod counts UTF-16 units and the CHECK counts characters, so anything
 * zod accepts the database accepts too.
 */
export const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\u0000"), {
      message: "must not contain NUL characters",
    });

/** `?status=open&status=resolved` arrives as an array, a single value as a string. */
export const repeatable = <Item extends z.ZodType>(item: Item) =>
  z
    .preprocess(
      (value) => (typeof value === "string" ? [value] : value),
      z.array(item).min(1),
    )
    .optional();

/** `limit` and `cursor` for keyset-paged lists (ARCHITECTURE, "API conventions"). */
export const pageFields = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Items per page, 1 to 100"),
  cursor: z
    .string()
    .max(512)
    .optional()
    .describe("`nextCursor` from the previous page"),
};

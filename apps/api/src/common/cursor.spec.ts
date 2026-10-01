import { ZodValidationException } from "nestjs-zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  decodeCursor,
  encodeCursor,
  exactTimestamp,
  pageFrom,
} from "./cursor.js";

const ID = "0199a1b2-0000-7000-8000-000000000001";
const AT = "2026-10-01T09:12:44.123456Z";
const keys = z.tuple([exactTimestamp]);

describe("cursors", () => {
  it("round-trip the sort key and ID of the last row", () => {
    const cursor = encodeCursor("newest", { keys: [AT], id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, "newest", keys)).toEqual({
      keys: [AT],
      id: ID,
    });
  });

  it.each([
    ["garbage", "not-a-cursor"],
    ["JSON of the wrong shape", Buffer.from('{"a":1}').toString("base64url")],
    [
      "a cursor from another sort order",
      encodeCursor("oldest", { keys: [AT], id: ID }),
    ],
    [
      "keys of the wrong type",
      encodeCursor("newest", { keys: ["yesterday"], id: ID }),
    ],
    [
      "an ID that isn't a UUID",
      Buffer.from(
        JSON.stringify({ sort: "newest", keys: [AT], id: "1 OR 1=1" }),
      ).toString("base64url"),
    ],
  ])("refuse %s with a 400", (_name, cursor) => {
    expect(() => decodeCursor(cursor, "newest", keys)).toThrow(
      ZodValidationException,
    );
  });

  it("keep timestamps to the microsecond, as PostgreSQL stores them", () => {
    expect(exactTimestamp.safeParse("2026-10-01T09:12:44.123Z").success).toBe(
      false,
    );
  });
});

describe("pageFrom", () => {
  const rows = [1, 2, 3];
  const page = (limit: number) =>
    pageFrom(
      rows,
      limit,
      (row) => row * 10,
      (row) => `after-${String(row)}`,
    );

  it("offers a next page only when the extra row came back", () => {
    expect(page(2)).toEqual({ items: [10, 20], nextCursor: "after-2" });
    expect(page(3)).toEqual({ items: [10, 20, 30], nextCursor: null });
  });
});

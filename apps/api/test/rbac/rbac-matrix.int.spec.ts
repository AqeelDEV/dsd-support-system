import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORIGIN } from "../support/auth.js";
import { createSeededDatabase, startAppOn } from "../support/database.js";
import { headersFor, identities } from "./actors.js";
import { ACTORS, MATRIX, type MatrixRow } from "./matrix.js";

const VERBS = {
  GET: "get",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
} as const satisfies Record<MatrixRow["method"], string>;

/**
 * Every route against every kind of caller (ADR-0004; FR-17, NFR-6,
 * NFR-11). Each cell sends a real request through the full pipeline,
 * against seeded PostgreSQL and real Redis.
 */
describe("RBAC matrix", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let seeded: Awaited<ReturnType<typeof identities>>;
  let cell = 0;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_rbac_matrix");
    // Each cell comes from its own client address, through a trusted
    // proxy, so the sign-in rate limits never decide a cell's outcome.
    app = await startAppOn(database, { TRUST_PROXY: "127.0.0.1,::1" });
    seeded = await identities(database);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe.each(MATRIX)("$method $path", (row) => {
    it.each(ACTORS)(
      `gives %s the status in the matrix (${row.rule})`,
      async (actor) => {
        const caller = await headersFor(app, seeded, actor);
        const http = request(app.getHttpServer());
        const call = http[VERBS[row.method]](row.path)
          .set("origin", ORIGIN)
          .set(
            "x-forwarded-for",
            `10.${Math.floor(cell / 250)}.0.${(cell % 250) + 1}`,
          );
        cell += 1;
        if (caller.cookie !== undefined) void call.set("cookie", caller.cookie);
        if (caller.csrfToken !== undefined) {
          void call.set("x-csrf-token", caller.csrfToken);
        }
        const response = await (row.body === undefined
          ? call
          : call.send(row.body));
        expect(response.status).toBe(row.expected[actor]);
      },
    );
  });
});

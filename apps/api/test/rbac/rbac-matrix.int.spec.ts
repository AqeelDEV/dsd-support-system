import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ORIGIN } from "../support/auth.js";
import { createSeededDatabase, startAppOn } from "../support/database.js";
import { newTicket, otherBrandId } from "../support/tickets.js";
import { headersFor, identities } from "./actors.js";
import {
  ACTORS,
  type Cell,
  type Fixtures,
  MATRIX,
  type MatrixRow,
} from "./matrix.js";

/** The registered path with each `:name` replaced by the cell's value. */
function pathFor(row: MatrixRow, cell: Cell): string {
  return row.path.replace(/:(\w+)/g, (_segment, name: string) => {
    const value = cell.params?.[name];
    if (value === undefined) {
      throw new Error(`${row.method} ${row.path} needs a value for :${name}`);
    }
    return value;
  });
}

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
  let fixtures: Fixtures;
  let cell = 0;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_rbac_matrix");
    // Each cell comes from its own client address, through a trusted
    // proxy, so the sign-in rate limits never decide a cell's outcome.
    app = await startAppOn(database, { TRUST_PROXY: "127.0.0.1,::1" });
    fixtures = {
      database,
      seeded: await identities(database),
      newTicket: (ticket) => newTicket(database, ticket),
      otherBrandId: () => otherBrandId(database),
    };
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe.each(MATRIX)("$method $path", (row) => {
    it.each(ACTORS)(
      `gives %s the status in the matrix (${row.rule})`,
      async (actor) => {
        const arranged = (await row.arrange?.(fixtures)) ?? {};
        const caller = await headersFor(
          app,
          fixtures.seeded,
          actor,
          arranged.guestTicketId,
        );
        const http = request(app.getHttpServer());
        const call = http[VERBS[row.method]](pathFor(row, arranged))
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
        const form = arranged.form ?? row.form;
        const body = arranged.body ?? row.body;
        for (const [name, value] of Object.entries(form ?? {})) {
          void call.field(name, value);
        }
        const response = await (body === undefined ? call : call.send(body));
        expect(response.status).toBe(row.expected[actor]);
      },
    );
  });
});

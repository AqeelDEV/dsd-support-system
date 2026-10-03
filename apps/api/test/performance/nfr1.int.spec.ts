import { writeFileSync } from "node:fs";

import { seedBulkTickets, type TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  SEED_ANCHOR,
  startAppOn,
} from "../support/database.js";

/*
 * NFR-1: loading the queue, opening a ticket and replying take under about
 * a second of server time. This runs each of them against a database with
 * 5,000 generated tickets on top of the demo data (packages/db, bulk.ts)
 * and reads the time from the `Server-Timing` header, which covers the
 * whole request on the server: guards, validation, queries and
 * serialisation.
 *
 * In `pnpm test` it takes a small sample and holds every operation's p95
 * under the budget, so a slow query fails CI. `pnpm --filter @dsd/api perf`
 * takes a larger sample and prints the table that docs/PERFORMANCE.md
 * records.
 */

const TICKETS = 5_000;
const BUDGET_MS = 1_000;
const SAMPLES = Number(process.env.NFR1_SAMPLES ?? "15");
const WARM_UP = 3;

interface Timing {
  operation: string;
  samples: number[];
}

function serverMs(response: request.Response): number {
  const value: unknown = response.headers["server-timing"];
  const header = typeof value === "string" ? value : "";
  const match = /^app;dur=([\d.]+)$/.exec(header);
  if (match?.[1] === undefined) {
    throw new Error(`No Server-Timing on ${response.status} response`);
  }
  return Number(match[1]);
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? Number.NaN;
}

describe(`NFR-1 on ${TICKETS.toLocaleString("en-GB")} tickets`, () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let agent: Credentials;
  let ordinary: string;
  let longest: { id: string; messages: number };
  let replyTargets: string[];
  const timings: Timing[] = [];
  const plans: string[] = [];

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_nfr1");
    await seedBulkTickets(database.pool("dsd_migrator"), {
      tickets: TICKETS,
      anchor: SEED_ANCHOR,
    });
    app = await startAppOn(database);
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });

    const open = await asOwner<{ id: string }>(
      database,
      `SELECT t.id FROM tickets t
        WHERE t.status = 'open' AND t.description LIKE 'Generated%'
          AND (SELECT count(*) FROM messages m WHERE m.ticket_id = t.id) BETWEEN 3 AND 5
        ORDER BY t.number LIMIT $1`,
      [1 + 2 * (SAMPLES + WARM_UP)],
    );
    ordinary = open[0]?.id ?? "";
    replyTargets = open.slice(1).map((row) => row.id);
    const [big] = await asOwner<{ id: string; messages: number }>(
      database,
      "SELECT ticket_id AS id, count(*)::int AS messages FROM messages GROUP BY ticket_id ORDER BY count(*) DESC LIMIT 1",
    );
    if (big === undefined) throw new Error("no messages were generated");
    longest = big;

    // How the planner serves the queue and a thread at this size, with no
    // settings forced, for the record.
    const [brand] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM brands WHERE slug = 'dsd'",
    );
    for (const [label, query, values] of [
      [
        "Open queue, most urgent first",
        "SELECT id FROM tickets WHERE brand_id = $1 AND status = 'open' ORDER BY priority DESC, created_at LIMIT 26",
        [brand?.id],
      ],
      [
        "The longest thread",
        "SELECT id FROM messages WHERE ticket_id = $1 ORDER BY created_at, id",
        [longest.id],
      ],
    ] as const) {
      const rows = await asOwner<{ "QUERY PLAN": string }>(
        database,
        `EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY ON) ${query}`,
        [...values],
      );
      plans.push(
        `${label}:\n${rows.map((row) => `    ${row["QUERY PLAN"]}`).join("\n")}`,
      );
    }
  }, 180_000);

  afterAll(async () => {
    const lines = [
      `| Operation | Requests | p50 (ms) | p95 (ms) | Max (ms) |`,
      `| --- | --- | --- | --- | --- |`,
      ...timings.map(
        ({ operation, samples }) =>
          `| ${operation} | ${String(samples.length)} | ${percentile(samples, 0.5).toFixed(1)} | ${percentile(samples, 0.95).toFixed(1)} | ${Math.max(...samples).toFixed(1)} |`,
      ),
      "",
      ...plans,
      "",
    ].join("\n");
    process.stdout.write(
      `\nServer time per request (Server-Timing):\n\n${lines}`,
    );
    if (process.env.NFR1_REPORT !== undefined) {
      writeFileSync(process.env.NFR1_REPORT, lines);
    }
    await app.close();
    await database.drop();
  });

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set("cookie", agent.cookie);
  const reply = (ticketId: string, status?: string) => {
    const call = request(app.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/replies`)
      .set("origin", ORIGIN)
      .set("cookie", agent.cookie)
      .set("x-csrf-token", agent.csrfToken)
      .field("body", "Thanks for the detail. Here is what to try next.");
    return status === undefined ? call : call.field("status", status);
  };

  /** Runs `call` WARM_UP + SAMPLES times and records the timed ones. */
  async function measure(
    operation: string,
    call: (index: number) => request.Test,
    expected: number,
  ): Promise<number[]> {
    const samples: number[] = [];
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      const response = await call(i);
      expect(response.status).toBe(expected);
      if (i >= WARM_UP) samples.push(serverMs(response));
    }
    timings.push({ operation, samples });
    return samples;
  }

  const QUEUE_CASES: [string, string][] = [
    ["Queue: open, most urgent first (the default)", "/api/v1/staff/tickets"],
    [
      "Queue: every status, newest first",
      "/api/v1/staff/tickets?status=open&status=pending_customer&status=resolved&status=closed&sort=newest",
    ],
    [
      "Queue: my open and waiting tickets",
      "/api/v1/staff/tickets?status=open&status=pending_customer&assignee=me",
    ],
    [
      "Queue: urgent and high, unassigned",
      "/api/v1/staff/tickets?priority=urgent&priority=high&assignee=unassigned",
    ],
  ];

  it.each(QUEUE_CASES)(
    "%s stays under the budget",
    async (operation, path) => {
      const samples = await measure(operation, () => get(path), 200);
      expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
    },
    120_000,
  );

  it("paging deep into the queue stays under the budget", async () => {
    // Follow the cursor ten pages in, then time that page.
    let path = "/api/v1/staff/tickets?status=open&status=closed&sort=oldest";
    for (let page = 0; page < 10; page += 1) {
      const body = (await get(path).expect(200)).body as {
        nextCursor: string | null;
      };
      if (body.nextCursor === null) break;
      path = `/api/v1/staff/tickets?status=open&status=closed&sort=oldest&cursor=${encodeURIComponent(body.nextCursor)}`;
    }
    const samples = await measure(
      "Queue: page 11, by age",
      () => get(path),
      200,
    );
    expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("opening a ticket stays under the budget", async () => {
    const samples = await measure(
      "Open a ticket (4 messages)",
      () => get(`/api/v1/staff/tickets/${ordinary}`),
      200,
    );
    expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("opening the longest thread stays under the budget", async () => {
    const samples = await measure(
      `Open the longest ticket (${String(longest.messages)} messages)`,
      () => get(`/api/v1/staff/tickets/${longest.id}`),
      200,
    );
    expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("replying stays under the budget", async () => {
    const samples = await measure(
      "Reply",
      (index) => reply(replyTargets[index] ?? ordinary),
      201,
    );
    expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
  }, 120_000);

  it("replying and moving the ticket on stays under the budget", async () => {
    const offset = WARM_UP + SAMPLES;
    const samples = await measure(
      "Reply and wait for the customer",
      (index) =>
        reply(replyTargets[offset + index] ?? ordinary, "pending_customer"),
      201,
    );
    expect(percentile(samples, 0.95)).toBeLessThan(BUDGET_MS);
  }, 120_000);
});

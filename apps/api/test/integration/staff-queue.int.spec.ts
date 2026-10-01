import type { TestDatabase } from "@dsd/db/testing";
import type { StaffTicketSummary } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newTicket, otherBrandId } from "../support/tickets.js";

interface Page {
  items: StaffTicketSummary[];
  nextCursor: string | null;
}

/** The staff queue (FR-7; ADR-0004, section 6). */
describe("staff queue", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let agentId: string;
  let agent: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_staff_queue");
    app = await startAppOn(database);
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const queue = (query: string, caller = agent) =>
    request(app.getHttpServer())
      .get(`/api/v1/staff/tickets${query}`)
      .set("cookie", caller.cookie);

  /** Every page of a query, followed through its cursors. */
  async function allPages(query: string, limit: number): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const separator = query === "" ? "?" : "&";
      const response = await queue(
        `${query}${separator}limit=${String(limit)}${cursor === null ? "" : `&cursor=${cursor}`}`,
      );
      expect(response.status).toBe(200);
      const page = response.body as Page;
      expect(page.items.length).toBeLessThanOrEqual(limit);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    return ids;
  }

  const idsWhere = async (
    where: string,
    order: string,
    values: unknown[] = [],
  ) =>
    (
      await asOwner<{ id: string }>(
        database,
        `SELECT id FROM tickets
          WHERE brand_id = (SELECT id FROM brands WHERE slug = 'dsd') AND ${where}
          ORDER BY ${order}`,
        values,
      )
    ).map((row) => row.id);

  const BY_PRIORITY = "priority DESC, created_at, id";

  it("shows open tickets by default, most urgent first, then oldest", async () => {
    const response = await queue("?limit=100");
    expect(response.status).toBe(200);
    expect((response.body as Page).items.map((item) => item.id)).toEqual(
      await idsWhere("status = 'open'", BY_PRIORITY),
    );
  });

  it("returns every ticket exactly once across pages", async () => {
    expect(await allPages("?status=open&status=pending_customer", 4)).toEqual(
      await idsWhere("status IN ('open', 'pending_customer')", BY_PRIORITY),
    );
  });

  it.each([
    ["oldest", "created_at, id"],
    ["newest", "created_at DESC, id DESC"],
  ])("sorts by age, %s first, across pages", async (sort, order) => {
    expect(
      await allPages(`?sort=${sort}&status=open&status=resolved`, 3),
    ).toEqual(await idsWhere("status IN ('open', 'resolved')", order));
  });

  it("filters by status and priority, each taking several values", async () => {
    const response = await queue(
      "?status=pending_customer&status=resolved&priority=high&priority=urgent&limit=100",
    );
    expect((response.body as Page).items.map((item) => item.id)).toEqual(
      await idsWhere(
        "status IN ('pending_customer', 'resolved') AND priority IN ('high', 'urgent')",
        BY_PRIORITY,
      ),
    );
  });

  it("filters by assignee: me, unassigned, or a named agent", async () => {
    const statuses = "status=open&status=pending_customer&limit=100";
    const [colleague] = await asOwner<{ assignee_agent_id: string }>(
      database,
      `SELECT assignee_agent_id FROM tickets
        WHERE assignee_agent_id IS NOT NULL AND assignee_agent_id <> $1 LIMIT 1`,
      [agentId],
    );
    const cases: [string, string, unknown[]][] = [
      ["me", "assignee_agent_id = $1", [agentId]],
      ["unassigned", "assignee_agent_id IS NULL", []],
      [
        colleague?.assignee_agent_id ?? "",
        "assignee_agent_id = $1",
        [colleague?.assignee_agent_id],
      ],
    ];
    for (const [assignee, where, values] of cases) {
      const response = await queue(`?assignee=${assignee}&${statuses}`);
      expect((response.body as Page).items.map((item) => item.id)).toEqual(
        await idsWhere(
          `${where} AND status IN ('open', 'pending_customer')`,
          BY_PRIORITY,
          values,
        ),
      );
    }
  });

  it("finds escalated tickets, and the rest", async () => {
    const statuses = "status=open&status=pending_customer&limit=100";
    const escalated = (await queue(`?escalated=true&${statuses}`)).body as Page;
    expect(escalated.items.length).toBeGreaterThan(0);
    expect(escalated.items.map((item) => item.id)).toEqual(
      await idsWhere(
        "escalated_at IS NOT NULL AND status IN ('open', 'pending_customer')",
        BY_PRIORITY,
      ),
    );
    const rest = (await queue(`?escalated=false&${statuses}`)).body as Page;
    expect(rest.items.every((item) => item.escalatedAt === null)).toBe(true);
  });

  it("holds tickets from every channel in the one queue (FR-6, FR-7)", async () => {
    const [customer] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM customers LIMIT 1",
    );
    const emailTicket = await newTicket(database, {
      customerId: customer?.id ?? "",
      priority: "urgent",
      channel: "email",
    });
    const page = (await queue("?limit=100")).body as Page;
    expect(page.items.find((item) => item.id === emailTicket)?.channel).toBe(
      "email",
    );
  });

  it("shows only tickets in the agent's brands", async () => {
    const brandId = await otherBrandId(database);
    const [customer] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM customers LIMIT 1",
    );
    const elsewhere = await newTicket(database, {
      customerId: customer?.id ?? "",
      brandId,
      priority: "urgent",
    });
    const visible = async () =>
      ((await queue("?limit=100")).body as Page).items.some(
        (item) => item.id === elsewhere,
      );
    expect(await visible()).toBe(false);
    await asOwner(
      database,
      "INSERT INTO agent_brand_memberships (agent_id, brand_id) VALUES ($1, $2)",
      [agentId, brandId],
    );
    try {
      expect(await visible()).toBe(true);
    } finally {
      await asOwner(
        database,
        "DELETE FROM agent_brand_memberships WHERE agent_id = $1 AND brand_id = $2",
        [agentId, brandId],
      );
    }
  });

  it.each([
    ["an unknown status", "?status=lost"],
    ["an unknown parameter", "?offset=10"],
    ["a cursor from another sort order", ""],
  ])("refuses %s with 400", async (_name, query) => {
    let path = query;
    if (query === "") {
      const first = (await queue("?limit=1")).body as Page;
      path = `?sort=oldest&cursor=${first.nextCursor ?? ""}`;
    }
    expect((await queue(path)).status).toBe(400);
  });
});

import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { StaffCustomer, StaffTicket } from "@dsd/shared";
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

/** Opening a ticket and its customer as staff (FR-8; ADR-0004, sections 5 and 6). */
describe("staff ticket view", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let agentId: string;
  let agent: Credentials;
  let supervisor: Credentials;
  let colleagueId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_staff_view");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.supervisor),
    });
    const [colleague] = await asOwner<{ id: string }>(
      database,
      `SELECT id FROM agents WHERE role = 'agent' AND deactivated_at IS NULL
          AND email_normalized <> $1 LIMIT 1`,
      [DEMO.agent],
    );
    colleagueId = colleague?.id ?? "";
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const get = (path: string, caller: Credentials) =>
    request(app.getHttpServer()).get(path).set("cookie", caller.cookie);

  it("shows the whole thread, internal notes included, with each author", async () => {
    const [ticket] = await asOwner<{ id: string }>(
      database,
      `SELECT t.id FROM tickets t WHERE EXISTS
         (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.visibility = 'internal')
       ORDER BY t.number LIMIT 1`,
    );
    const response = await get(
      `/api/v1/staff/tickets/${ticket?.id ?? ""}`,
      agent,
    );
    expect(response.status).toBe(200);
    const view = response.body as StaffTicket;
    const thread = await asOwner<{
      id: string;
      visibility: string;
      author_agent_id: string | null;
      author_customer_id: string | null;
    }>(
      database,
      `SELECT id, visibility, author_agent_id, author_customer_id FROM messages
        WHERE ticket_id = $1 ORDER BY created_at, id`,
      [ticket?.id],
    );
    expect(
      view.messages.map((message) => ({
        id: message.id,
        visibility: message.visibility,
        author: message.author.id,
      })),
    ).toEqual(
      thread.map((row) => ({
        id: row.id,
        visibility: row.visibility,
        author: row.author_agent_id ?? row.author_customer_id,
      })),
    );
    expect(
      view.messages.some((message) => message.visibility === "internal"),
    ).toBe(true);
    expect(view.description.length).toBeGreaterThan(0);
  });

  it("describes the customer and whether their contact is verified", async () => {
    const ticketId = await newTicket(database, { customerId });
    const view = (await get(`/api/v1/staff/tickets/${ticketId}`, agent))
      .body as StaffTicket;
    expect(view.customer).toEqual({
      id: customerId,
      email: DEMO.customer,
      displayName: expect.any(String) as string,
      hasAccount: true,
    });
    expect(view.contactVerified).toBe(false);
    expect(view.channel).toBe("web");
  });

  it("tells each agent what they may do to this ticket now", async () => {
    const held = await newTicket(database, {
      customerId,
      assigneeId: colleagueId,
    });
    const asAgent = (await get(`/api/v1/staff/tickets/${held}`, agent))
      .body as StaffTicket;
    expect(asAgent.allowedTransitions).toEqual([
      "pending_customer",
      "resolved",
      "closed",
    ]);
    expect(asAgent.assignee?.id).toBe(colleagueId);
    expect(asAgent.allowedActions).toMatchObject({
      reply: true,
      claim: false,
      assign: false,
      unassign: false,
    });
    const asSupervisor = (
      await get(`/api/v1/staff/tickets/${held}`, supervisor)
    ).body as StaffTicket;
    expect(asSupervisor.allowedActions).toMatchObject({
      assign: true,
      unassign: true,
    });

    const closed = await newTicket(database, { customerId, status: "closed" });
    const closedView = (await get(`/api/v1/staff/tickets/${closed}`, agent))
      .body as StaffTicket;
    expect(closedView.allowedTransitions).toEqual([]);
    expect(closedView.allowedActions).toMatchObject({
      reply: false,
      addNote: true,
    });
  });

  it("answers 404 outside the agent's brands, even to a supervisor", async () => {
    const elsewhere = await newTicket(database, {
      customerId,
      brandId: await otherBrandId(database),
    });
    for (const caller of [agent, supervisor]) {
      expect(
        (await get(`/api/v1/staff/tickets/${elsewhere}`, caller)).status,
      ).toBe(404);
    }
    expect(
      (await get(`/api/v1/staff/tickets/${randomUUID()}`, agent)).status,
    ).toBe(404);
  });

  describe("the customer view", () => {
    it("shows the customer and their tickets in the agent's brands, newest first", async () => {
      const elsewhere = await newTicket(database, {
        customerId,
        brandId: await otherBrandId(database),
      });
      const response = await get(
        `/api/v1/staff/customers/${customerId}?limit=100`,
        agent,
      );
      expect(response.status).toBe(200);
      const view = response.body as StaffCustomer;
      expect(view.customer).toMatchObject({
        id: customerId,
        email: DEMO.customer,
        hasAccount: true,
      });
      const own = await asOwner<{ id: string }>(
        database,
        `SELECT id FROM tickets WHERE customer_id = $1
            AND brand_id = (SELECT id FROM brands WHERE slug = 'dsd')
          ORDER BY created_at DESC, id DESC`,
        [customerId],
      );
      expect(view.tickets.items.map((ticket) => ticket.id)).toEqual(
        own.map((row) => row.id),
      );
      expect(view.tickets.items.map((ticket) => ticket.id)).not.toContain(
        elsewhere,
      );
    });

    it("pages through the customer's tickets", async () => {
      const first = (
        await get(`/api/v1/staff/customers/${customerId}?limit=2`, agent)
      ).body as StaffCustomer;
      expect(first.tickets.items).toHaveLength(2);
      const second = (
        await get(
          `/api/v1/staff/customers/${customerId}?limit=2&cursor=${first.tickets.nextCursor ?? ""}`,
          agent,
        )
      ).body as StaffCustomer;
      expect(second.tickets.items[0]?.id).not.toBe(first.tickets.items[1]?.id);
    });

    it("answers 404 for a customer with nothing in the agent's brands", async () => {
      const [stranger] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO customers (email, email_normalized)
         VALUES ('stranger@example.com', 'stranger@example.com') RETURNING id`,
      );
      await newTicket(database, {
        customerId: stranger?.id ?? "",
        brandId: await otherBrandId(database),
      });
      expect(
        (await get(`/api/v1/staff/customers/${stranger?.id ?? ""}`, agent))
          .status,
      ).toBe(404);
      expect(
        (await get(`/api/v1/staff/customers/${randomUUID()}`, agent)).status,
      ).toBe(404);
    });
  });
});

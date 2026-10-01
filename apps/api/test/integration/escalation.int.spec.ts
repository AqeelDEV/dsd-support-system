import type { TestDatabase } from "@dsd/db/testing";
import type {
  StaffTicket,
  StaffTicketSummary,
  TicketPriority,
} from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newTicket } from "../support/tickets.js";

/** Escalating a ticket (UC-6; ADR-0007, section 6). */
describe("escalation", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let customer: Credentials;
  let agentId: string;
  let agent: Credentials;
  let supervisorId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_escalation");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
    supervisorId = await idOf(database, "agents", DEMO.supervisor);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const escalate = (ticketId: string, body: Record<string, string>) =>
    request(app.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/escalate`)
      .set("origin", ORIGIN)
      .set("cookie", agent.cookie)
      .set("x-csrf-token", agent.csrfToken)
      .send(body);

  const actions = async (ticketId: string) =>
    (
      await asOwner<{ action: string }>(
        database,
        "SELECT action FROM audit_events WHERE ticket_id = $1 ORDER BY created_at, id",
        [ticketId],
      )
    ).map((row) => row.action);

  it("keeps the reason as a note, raises the priority and marks the ticket escalated", async () => {
    const ticketId = await newTicket(database, {
      customerId,
      status: "pending_customer",
    });
    const response = await escalate(ticketId, {
      reason: "Third reset failed; the customer has waited four days.",
    });
    expect(response.status).toBe(200);
    const view = response.body as StaffTicket;
    expect(view).toMatchObject({
      status: "pending_customer",
      priority: "high",
      escalatedBy: { id: agentId },
    });
    expect(view.escalatedAt).not.toBeNull();
    expect(view.messages.at(-1)).toMatchObject({
      visibility: "internal",
      body: "Escalated: Third reset failed; the customer has waited four days.",
    });
    expect(await actions(ticketId)).toEqual([
      "message.created",
      "ticket.escalated",
      "ticket.priority_changed",
    ]);
    const events = await asOwner<{ event_type: string; payload: unknown }>(
      database,
      "SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY id",
      [ticketId],
    );
    expect(events.map((event) => event.event_type)).toEqual([
      "message.created",
      "ticket.escalated",
      "ticket.priority_changed",
    ]);
    expect(events[1]?.payload).toEqual({
      ticketId,
      escalatedByAgentId: agentId,
      assigneeAgentId: null,
    });
  });

  it.each([
    ["low", "high"],
    ["normal", "high"],
    ["high", "high"],
    ["urgent", "urgent"],
  ] as const)(
    "takes %s priority to %s",
    async (from: TicketPriority, to: TicketPriority) => {
      const ticketId = await newTicket(database, {
        customerId,
        priority: from,
      });
      const response = await escalate(ticketId, {
        reason: "Needs a supervisor",
      });
      expect((response.body as StaffTicket).priority).toBe(to);
      expect(
        (await actions(ticketId)).includes("ticket.priority_changed"),
      ).toBe(from !== to);
    },
  );

  it("hands the ticket to the chosen supervisor, whoever held it", async () => {
    const [colleague] = await asOwner<{ id: string }>(
      database,
      `SELECT id FROM agents WHERE role = 'agent' AND deactivated_at IS NULL
          AND email_normalized <> $1 LIMIT 1`,
      [DEMO.agent],
    );
    const ticketId = await newTicket(database, {
      customerId,
      assigneeId: colleague?.id ?? null,
    });
    const response = await escalate(ticketId, {
      reason: "Refund over the agent limit",
      supervisorId,
    });
    expect(response.status).toBe(200);
    expect((response.body as StaffTicket).assignee?.id).toBe(supervisorId);
    expect((await actions(ticketId)).at(-1)).toBe("ticket.assigned");
  });

  it("refuses a target who isn't an active supervisor in the brand (422), and writes nothing", async () => {
    const [plainAgent] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM agents WHERE role = 'agent' AND deactivated_at IS NULL LIMIT 1",
    );
    const ticketId = await newTicket(database, { customerId });
    const response = await escalate(ticketId, {
      reason: "Escalating to a peer",
      supervisorId: plainAgent?.id ?? "",
    });
    expect(response.status).toBe(422);
    expect(await actions(ticketId)).toEqual([]);
  });

  it("refuses a closed ticket (409)", async () => {
    const ticketId = await newTicket(database, {
      customerId,
      status: "closed",
    });
    expect((await escalate(ticketId, { reason: "Too late" })).status).toBe(409);
  });

  it("can happen again, and the history keeps both", async () => {
    const ticketId = await newTicket(database, { customerId });
    await escalate(ticketId, { reason: "First time" });
    const again = await escalate(ticketId, { reason: "Still stuck" });
    expect(again.status).toBe(200);
    const escalations = await asOwner<{ before: unknown }>(
      database,
      `SELECT before FROM audit_events
        WHERE ticket_id = $1 AND action = 'ticket.escalated' ORDER BY created_at, id`,
      [ticketId],
    );
    expect(escalations.map((row) => row.before)).toEqual([
      { escalated: false },
      { escalated: true },
    ]);
  });

  it("is found by the queue's escalated filter, after it resolves too", async () => {
    const ticketId = await newTicket(database, { customerId });
    await escalate(ticketId, { reason: "For the filter" });
    const queue = await request(app.getHttpServer())
      .get("/api/v1/staff/tickets?escalated=true&limit=100")
      .set("cookie", agent.cookie);
    expect(
      (queue.body as { items: StaffTicketSummary[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(ticketId);

    await asOwner(
      database,
      "UPDATE tickets SET status = 'resolved', resolved_at = now() WHERE id = $1",
      [ticketId],
    );
    const resolved = await request(app.getHttpServer())
      .get("/api/v1/staff/tickets?escalated=true&status=resolved&limit=100")
      .set("cookie", agent.cookie);
    expect(
      (resolved.body as { items: StaffTicketSummary[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(ticketId);
  });

  it("shows the customer none of it", async () => {
    const ticketId = await newTicket(database, { customerId });
    await escalate(ticketId, {
      reason: "Customer threatened a chargeback",
      supervisorId,
    });
    const view = await request(app.getHttpServer())
      .get(`/api/v1/customer/tickets/${ticketId}`)
      .set("cookie", customer.cookie);
    const text = JSON.stringify(view.body);
    expect(text).not.toContain("chargeback");
    expect(text).not.toContain("Escalated");
    expect(text).not.toContain("escalat");
    expect(text).not.toContain("priority");
    expect(text).not.toContain(supervisorId);
  });
});

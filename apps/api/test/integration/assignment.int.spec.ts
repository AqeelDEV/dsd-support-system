import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { StaffTicket } from "@dsd/shared";
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

/** Claiming, assigning and reassigning (FR-11; ADR-0007, section 5). */
describe("assignment", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let agentId: string;
  let colleagueId: string;
  let agent: Credentials;
  let colleague: Credentials;
  let supervisor: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_assignment");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    agentId = await idOf(database, "agents", DEMO.agent);
    const [other] = await asOwner<{ id: string }>(
      database,
      `SELECT id FROM agents WHERE role = 'agent' AND deactivated_at IS NULL
          AND password_hash IS NOT NULL AND email_normalized <> $1 LIMIT 1`,
      [DEMO.agent],
    );
    colleagueId = other?.id ?? "";
    agent = await sessionFor(app, { kind: "staff", agentId });
    colleague = await sessionFor(app, { kind: "staff", agentId: colleagueId });
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.supervisor),
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const assign = (
    ticketId: string,
    caller: Credentials,
    body: Record<string, string>,
  ) =>
    request(app.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/assignment`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken)
      .send(body);

  const assigneeOf = async (ticketId: string) => {
    const [row] = await asOwner<{ assignee_agent_id: string | null }>(
      database,
      "SELECT assignee_agent_id FROM tickets WHERE id = $1",
      [ticketId],
    );
    return row?.assignee_agent_id;
  };

  const history = (ticketId: string) =>
    asOwner<{ actor_agent_id: string; before: unknown; after: unknown }>(
      database,
      `SELECT actor_agent_id, before, after FROM audit_events
        WHERE ticket_id = $1 AND action = 'ticket.assigned' ORDER BY created_at, id`,
      [ticketId],
    );

  it("lets an agent claim an unassigned ticket, with its history", async () => {
    const ticketId = await newTicket(database, { customerId });
    const response = await assign(ticketId, agent, { action: "claim" });
    expect(response.status).toBe(200);
    expect((response.body as StaffTicket).assignee?.id).toBe(agentId);
    expect((response.body as StaffTicket).allowedActions).toMatchObject({
      claim: false,
      unassign: true,
    });
    expect(await history(ticketId)).toEqual([
      {
        actor_agent_id: agentId,
        before: { assigneeAgentId: null },
        after: { assigneeAgentId: agentId },
      },
    ]);
    const [event] = await asOwner<{ payload: unknown }>(
      database,
      "SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'ticket.assigned'",
      [ticketId],
    );
    expect(event?.payload).toEqual({
      ticketId,
      fromAgentId: null,
      toAgentId: agentId,
    });
  });

  it("gives two simultaneous claims one success and one 409", async () => {
    const ticketId = await newTicket(database, { customerId });
    const responses = await Promise.all([
      assign(ticketId, agent, { action: "claim" }),
      assign(ticketId, colleague, { action: "claim" }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const lost = responses.find((response) => response.status === 409);
    expect(lost?.body).toMatchObject({
      type: "tag:dsd.example,2026:problems/already-assigned",
    });
    const winner = responses[0].status === 200 ? agentId : colleagueId;
    expect(await assigneeOf(ticketId)).toBe(winner);
    expect(await history(ticketId)).toHaveLength(1);
  });

  it("lets an agent hand an unassigned or their own ticket to a colleague", async () => {
    const unassigned = await newTicket(database, { customerId });
    expect(
      (
        await assign(unassigned, agent, {
          action: "assign",
          agentId: colleagueId,
        })
      ).status,
    ).toBe(200);
    expect(await assigneeOf(unassigned)).toBe(colleagueId);

    const mine = await newTicket(database, { customerId, assigneeId: agentId });
    expect(
      (await assign(mine, agent, { action: "assign", agentId: colleagueId }))
        .status,
    ).toBe(200);
    expect(await assigneeOf(mine)).toBe(colleagueId);
  });

  it("lets the holder give a ticket back", async () => {
    const mine = await newTicket(database, { customerId, assigneeId: agentId });
    expect((await assign(mine, agent, { action: "unassign" })).status).toBe(
      200,
    );
    expect(await assigneeOf(mine)).toBeNull();
  });

  it.each([
    ["take it", { action: "assign", agentId: "" }, 403],
    ["unassign it", { action: "unassign" }, 403],
    ["claim it", { action: "claim" }, 409],
  ])(
    "won't let an agent %s from a colleague",
    async (_name, body: Record<string, string>, status) => {
      const theirs = await newTicket(database, {
        customerId,
        assigneeId: colleagueId,
      });
      const request = body.agentId === "" ? { ...body, agentId } : body;
      expect((await assign(theirs, agent, request)).status).toBe(status);
      expect(await assigneeOf(theirs)).toBe(colleagueId);
      expect(await history(theirs)).toEqual([]);
    },
  );

  it("lets a supervisor reassign or unassign anyone's ticket", async () => {
    const theirs = await newTicket(database, {
      customerId,
      assigneeId: colleagueId,
    });
    expect(
      (await assign(theirs, supervisor, { action: "assign", agentId })).status,
    ).toBe(200);
    expect(await assigneeOf(theirs)).toBe(agentId);
    expect(
      (await assign(theirs, supervisor, { action: "unassign" })).status,
    ).toBe(200);
    expect(await assigneeOf(theirs)).toBeNull();
  });

  it("changes nothing when the ticket already ends up where asked", async () => {
    const mine = await newTicket(database, { customerId, assigneeId: agentId });
    expect((await assign(mine, agent, { action: "claim" })).status).toBe(200);
    expect(
      (await assign(mine, agent, { action: "assign", agentId })).status,
    ).toBe(200);
    expect(await history(mine)).toEqual([]);
  });

  it("refuses an agent who can't take the brand's tickets (422)", async () => {
    const [former] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM agents WHERE deactivated_at IS NOT NULL LIMIT 1",
    );
    const [outsider] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO agents (email, email_normalized, display_name, role)
       VALUES ('outsider@dsd.example', 'outsider@dsd.example', 'No Brand', 'agent')
       RETURNING id`,
    );
    for (const target of [former?.id, outsider?.id, randomUUID()]) {
      const ticketId = await newTicket(database, { customerId });
      const response = await assign(ticketId, agent, {
        action: "assign",
        agentId: target ?? "",
      });
      expect(response.status).toBe(422);
      expect(await assigneeOf(ticketId)).toBeNull();
    }
  });

  it("leaves a closed ticket with whoever had it (409)", async () => {
    const closed = await newTicket(database, {
      customerId,
      status: "closed",
      assigneeId: agentId,
    });
    const response = await assign(closed, supervisor, { action: "unassign" });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      type: "tag:dsd.example,2026:problems/ticket-closed",
    });
  });

  it.each([
    [{ action: "assign" }],
    [{ action: "claim", agentId: randomUUID() }],
    [{ action: "steal" }],
  ])("refuses a malformed request (400): %j", async (body) => {
    const ticketId = await newTicket(database, { customerId });
    expect((await assign(ticketId, agent, body)).status).toBe(400);
  });
});

import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { AuditEvent } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ObjectMissingError,
  ObjectStore,
} from "../../src/infrastructure/object-store.js";
import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { FILES } from "../support/files.js";
import { newTicket } from "../support/tickets.js";

interface Page {
  items: AuditEvent[];
  nextCursor: string | null;
}

/**
 * The audit trail (FR-18; ADR-0008, section 3): every change writes its
 * event, with its actor and request, in the same transaction as the change.
 */
describe("audit trail", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let customer: Credentials;
  let agentId: string;
  let agent: Credentials;
  let supervisorId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_audit_trail");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
    supervisorId = await idOf(database, "agents", DEMO.supervisor);

    // Test-only: fail any audit insert whose request is listed here, to
    // prove a failure rolls back the change it belonged to.
    await asOwner(
      database,
      "CREATE TABLE failing_requests (request_id text PRIMARY KEY)",
    );
    await asOwner(
      database,
      `CREATE FUNCTION fail_listed_requests() RETURNS trigger
       LANGUAGE plpgsql SECURITY DEFINER AS $$
       BEGIN
         IF EXISTS (SELECT 1 FROM failing_requests WHERE request_id = NEW.request_id) THEN
           RAISE EXCEPTION 'audit insert failed on purpose';
         END IF;
         RETURN NEW;
       END;
       $$`,
    );
    await asOwner(
      database,
      `CREATE TRIGGER audit_events_fail_listed BEFORE INSERT ON audit_events
       FOR EACH ROW EXECUTE FUNCTION fail_listed_requests()`,
    );
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const send = (
    method: "post" | "patch",
    path: string,
    caller: Credentials,
    requestId: string,
  ) => {
    const http = request(app.getHttpServer());
    return (method === "post" ? http.post(path) : http.patch(path))
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken)
      .set("x-request-id", requestId);
  };

  const count = async (sql: string, values: unknown[] = []) => {
    const [row] = await asOwner<{ count: string }>(database, sql, values);
    return Number(row?.count);
  };

  it("records every change with its actor and the request that made it", async () => {
    const ids = Array.from({ length: 8 }, () => randomUUID());
    const submitted = await send(
      "post",
      "/api/v1/customer/tickets",
      customer,
      ids[0] ?? "",
    )
      .field("subject", "Camera offline after update")
      .field("description", "It shows offline since last night.")
      .attach("attachments", FILES.png, "status-page.png");
    expect(submitted.status).toBe(201);
    const ticketId = (submitted.body as { id: string }).id;
    const path = `/api/v1/staff/tickets/${ticketId}`;

    // Each step is sent only after the one before it has finished.
    const steps = [
      () =>
        send("post", `${path}/replies`, agent, ids[1] ?? "")
          .field("body", "Please power-cycle it.")
          .field("status", "pending_customer"),
      () =>
        send(
          "post",
          `/api/v1/customer/tickets/${ticketId}/messages`,
          customer,
          ids[2] ?? "",
        ).field("body", "Still offline."),
      () =>
        send("patch", `${path}/priority`, agent, ids[3] ?? "").send({
          priority: "high",
        }),
      () =>
        send("post", `${path}/assignment`, agent, ids[4] ?? "").send({
          action: "claim",
        }),
      () =>
        send("post", `${path}/escalate`, agent, ids[5] ?? "").send({
          reason: "Firmware bug suspected",
          supervisorId,
        }),
      () =>
        send("post", `${path}/notes`, agent, ids[6] ?? "").field(
          "body",
          "Logged with the firmware team.",
        ),
      () =>
        send("patch", `${path}/status`, agent, ids[7] ?? "").send({
          status: "resolved",
        }),
    ];
    for (const step of steps)
      expect([200, 201]).toContain((await step()).status);

    // Read it back a page at a time, as the agent app would.
    const events: AuditEvent[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? "" : `&cursor=${cursor}`;
      const page = await request(app.getHttpServer())
        .get(`${path}/audit-events?limit=3${query}`)
        .set("cookie", agent.cookie);
      expect(page.status).toBe(200);
      events.push(...(page.body as Page).items);
      cursor = (page.body as Page).nextCursor;
    } while (cursor !== null);

    const C = { type: "customer", id: customerId };
    const A = { type: "agent", id: agentId };
    expect(
      events.map((event) => [
        event.action,
        event.actor.type,
        event.actor.id,
        event.requestId,
      ]),
    ).toEqual([
      ["ticket.created", C.type, C.id, ids[0]],
      ["attachment.created", C.type, C.id, ids[0]],
      ["message.created", A.type, A.id, ids[1]],
      ["ticket.status_changed", A.type, A.id, ids[1]],
      ["message.created", C.type, C.id, ids[2]],
      ["ticket.status_changed", C.type, C.id, ids[2]],
      ["ticket.priority_changed", A.type, A.id, ids[3]],
      ["ticket.assigned", A.type, A.id, ids[4]],
      ["message.created", A.type, A.id, ids[5]],
      ["ticket.escalated", A.type, A.id, ids[5]],
      ["ticket.assigned", A.type, A.id, ids[5]],
      ["message.created", A.type, A.id, ids[6]],
      ["ticket.status_changed", A.type, A.id, ids[7]],
    ]);
    expect(events.every((event) => event.actor.name !== null)).toBe(true);
    expect(
      events.find((event) => event.action === "ticket.assigned"),
    ).toMatchObject({
      before: { assigneeAgentId: null },
      after: { assigneeAgentId: agentId },
    });
    // Message bodies stay in the messages table, never in the history.
    expect(JSON.stringify(events)).not.toContain("power-cycle");
  });

  it("refuses a customer session (401); the RBAC matrix covers the rest", async () => {
    const ticketId = await newTicket(database, { customerId });
    const asCustomer = await request(app.getHttpServer())
      .get(`/api/v1/staff/tickets/${ticketId}/audit-events`)
      .set("cookie", customer.cookie);
    expect(asCustomer.status).toBe(401);
  });

  it("rolls back a submission whose audit event fails: no ticket, no event, no file", async () => {
    const requestId = randomUUID();
    await asOwner(database, "INSERT INTO failing_requests VALUES ($1)", [
      requestId,
    ]);
    const objects = app.get(ObjectStore);
    const put = vi.spyOn(objects, "put");
    const tickets = await count("SELECT count(*) FROM tickets");
    const events = await count("SELECT count(*) FROM outbox_events");

    const response = await request(app.getHttpServer())
      .post("/api/v1/public/tickets")
      .set("origin", ORIGIN)
      .set("x-request-id", requestId)
      .field("email", "rollback@example.com")
      .field("subject", "This must not survive")
      .field("description", "The audit insert fails.")
      .attach("attachments", FILES.pdf, "receipt.pdf");
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ requestId });

    expect(await count("SELECT count(*) FROM tickets")).toBe(tickets);
    expect(await count("SELECT count(*) FROM outbox_events")).toBe(events);
    const keys = put.mock.calls.map(([key]) => key);
    put.mockRestore();
    expect(keys).toHaveLength(1);
    await expect(objects.get(keys[0] ?? "")).rejects.toBeInstanceOf(
      ObjectMissingError,
    );
  });

  it("rolls back a reply and its status change together", async () => {
    const ticketId = await newTicket(database, { customerId });
    const requestId = randomUUID();
    await asOwner(database, "INSERT INTO failing_requests VALUES ($1)", [
      requestId,
    ]);
    const response = await send(
      "post",
      `/api/v1/staff/tickets/${ticketId}/replies`,
      agent,
      requestId,
    )
      .field("body", "Resolving now.")
      .field("status", "resolved");
    expect(response.status).toBe(500);
    expect(
      await count("SELECT count(*) FROM messages WHERE ticket_id = $1", [
        ticketId,
      ]),
    ).toBe(0);
    expect(
      await count(
        "SELECT count(*) FROM outbox_events WHERE aggregate_id = $1",
        [ticketId],
      ),
    ).toBe(0);
    const [row] = await asOwner<{
      status: string;
      first_response_at: Date | null;
    }>(
      database,
      "SELECT status, first_response_at FROM tickets WHERE id = $1",
      [ticketId],
    );
    expect(row).toEqual({ status: "open", first_response_at: null });
  });
});

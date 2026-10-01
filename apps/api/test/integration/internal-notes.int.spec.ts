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
import { FILES } from "../support/files.js";
import { newTicket } from "../support/tickets.js";

/**
 * Internal notes never reach a customer (FR-10). A canary note, with a
 * canary file, is planted through the API, and every customer-realm
 * response is searched for either.
 */
describe("internal notes", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let customer: Credentials;
  let agent: Credentials;
  let ticketId: string;
  const canary = `canary-${randomUUID()}`;
  const canaryFile = `${canary}.log`;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_internal_notes");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
    ticketId = await newTicket(database, { customerId });

    const note = await send(`/api/v1/staff/tickets/${ticketId}/notes`, agent)
      .field("body", `Customer sounds upset. ${canary}`)
      .attach("attachments", FILES.log, canaryFile);
    expect(note.status).toBe(201);
    const reply = await send(
      `/api/v1/staff/tickets/${ticketId}/replies`,
      agent,
    ).field("body", "We're looking into it.");
    expect(reply.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  function send(path: string, caller: Credentials) {
    return request(app.getHttpServer())
      .post(path)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
  }

  const get = (path: string, caller: Credentials) =>
    request(app.getHttpServer()).get(path).set("cookie", caller.cookie);

  const expectNoCanary = (body: unknown) => {
    const text = JSON.stringify(body);
    expect(text).not.toContain(canary);
    expect(text).not.toContain("internal");
  };

  it("is stored as an internal note, with its file, and shown to staff", async () => {
    const view = (await get(`/api/v1/staff/tickets/${ticketId}`, agent))
      .body as StaffTicket;
    const note = view.messages.find((message) => message.body.includes(canary));
    expect(note?.visibility).toBe("internal");
    expect(note?.attachments.map((file) => file.filename)).toEqual([
      canaryFile,
    ]);
  });

  it("keeps its file from the customer: the download is a 404", async () => {
    const [file] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM attachments WHERE filename = $1",
      [canaryFile],
    );
    const asCustomer = await get(
      `/api/v1/customer/tickets/${ticketId}/attachments/${file?.id ?? ""}`,
      customer,
    );
    expect(asCustomer.status).toBe(404);
    expectNoCanary(asCustomer.body);
    const asStaff = await get(
      `/api/v1/staff/tickets/${ticketId}/attachments/${file?.id ?? ""}`,
      agent,
    );
    expect(asStaff.status).toBe(200);
  });

  it("never appears in the customer's ticket list", async () => {
    expectNoCanary((await get("/api/v1/customer/tickets", customer)).body);
  });

  it("never appears in the customer's view of the ticket, nor does its file", async () => {
    const response = await get(
      `/api/v1/customer/tickets/${ticketId}`,
      customer,
    );
    expect(response.status).toBe(200);
    expectNoCanary(response.body);
    expect(JSON.stringify(response.body)).toContain("We're looking into it.");
  });

  it("never appears in the response to a customer's reply", async () => {
    const response = await send(
      `/api/v1/customer/tickets/${ticketId}/messages`,
      customer,
    ).field("body", "Thanks for the update.");
    expect(response.status).toBe(201);
    expectNoCanary(response.body);
  });

  it("is hidden from a guest session on the same ticket too", async () => {
    const guestTicket = await newTicket(database, { customerId });
    await send(`/api/v1/staff/tickets/${guestTicket}/notes`, agent).field(
      "body",
      `Guest ticket note ${canary}`,
    );
    const guest = await sessionFor(app, {
      kind: "guest",
      customerId,
      ticketId: guestTicket,
    });
    expectNoCanary(
      (await get(`/api/v1/customer/tickets/${guestTicket}`, guest)).body,
    );
    expectNoCanary((await get("/api/v1/customer/tickets", guest)).body);
  });

  it("is marked internal in its outbox event, so no email ever carries it", async () => {
    const [note] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM messages WHERE ticket_id = $1 AND visibility = 'internal'",
      [ticketId],
    );
    const [event] = await asOwner<{ payload: Record<string, unknown> }>(
      database,
      `SELECT payload FROM outbox_events
        WHERE event_type = 'message.created' AND payload ->> 'messageId' = $1`,
      [note?.id],
    );
    expect(event?.payload).toEqual({
      ticketId,
      messageId: note?.id,
      authorType: "agent",
      visibility: "internal",
    });
    expect(JSON.stringify(event)).not.toContain(canary);
  });

  it("can't be written by a customer, even by asking for one", async () => {
    const response = await send(
      `/api/v1/customer/tickets/${ticketId}/messages`,
      customer,
    )
      .field("body", "Let me in")
      .field("visibility", "internal");
    expect(response.status).toBe(400);
  });

  it("is allowed on a closed ticket, where a reply is not", async () => {
    const closed = await newTicket(database, { customerId, status: "closed" });
    const note = await send(
      `/api/v1/staff/tickets/${closed}/notes`,
      agent,
    ).field("body", "Follow-up for the record.");
    expect(note.status).toBe(201);
    const reply = await send(
      `/api/v1/staff/tickets/${closed}/replies`,
      agent,
    ).field("body", "One more thing.");
    expect(reply.status).toBe(409);
    expect(reply.body).toMatchObject({
      type: "tag:dsd.example,2026:problems/ticket-closed",
    });
  });
});

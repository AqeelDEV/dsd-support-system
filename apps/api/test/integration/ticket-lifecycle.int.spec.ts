import type { TestDatabase } from "@dsd/db/testing";
import type { CustomerTicket, TicketStatus } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Credentials,
  credentialsFrom,
  DEMO,
  ORIGIN,
  resetRateLimits,
  sessionFor,
} from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { FILES } from "../support/files.js";
import { newTicket } from "../support/tickets.js";
import { issueLinkToken } from "../support/tokens.js";

interface TicketRow {
  status: TicketStatus;
  resolved_at: Date | null;
  closed_at: Date | null;
  first_response_at: Date | null;
}

/**
 * The ticket lifecycle end to end (ADR-0007; FR-3, FR-9, FR-18, NFR-11):
 * every change goes through the API, and each leaves its message, its
 * audit event and its outbox event behind.
 */
describe("ticket lifecycle", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let customer: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_ticket_lifecycle");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const send = (
    method: "post" | "patch",
    path: string,
    caller: Credentials,
  ) => {
    const http = request(app.getHttpServer());
    return (method === "post" ? http.post(path) : http.patch(path))
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
  };

  const customerReply = (ticketId: string, caller: Credentials, body: string) =>
    send("post", `/api/v1/customer/tickets/${ticketId}/messages`, caller).field(
      "body",
      body,
    );

  const ticketRow = async (ticketId: string) => {
    const [row] = await asOwner<TicketRow>(
      database,
      "SELECT status, resolved_at, closed_at, first_response_at FROM tickets WHERE id = $1",
      [ticketId],
    );
    if (row === undefined) throw new Error(`no ticket ${ticketId}`);
    return row;
  };

  const historyOf = (ticketId: string) =>
    asOwner<{
      action: string;
      actor_type: string;
      actor_customer_id: string | null;
      before: unknown;
      after: unknown;
    }>(
      database,
      `SELECT action, actor_type, actor_customer_id, before, after FROM audit_events
        WHERE ticket_id = $1 ORDER BY created_at, id`,
      [ticketId],
    );

  const eventsOf = (ticketId: string) =>
    asOwner<{ event_type: string; payload: Record<string, unknown> }>(
      database,
      "SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1 ORDER BY id",
      [ticketId],
    );

  describe("a customer's reply", () => {
    it("leaves an open ticket open", async () => {
      const ticketId = await newTicket(database, { customerId });
      const response = await customerReply(ticketId, customer, "Any news?");
      expect(response.status).toBe(201);
      const ticket = response.body as CustomerTicket;
      expect(ticket.status).toBe("open");
      expect(ticket.messages.at(-1)).toMatchObject({
        body: "Any news?",
        author: { type: "customer" },
      });
      expect((await historyOf(ticketId)).map((event) => event.action)).toEqual([
        "message.created",
      ]);
    });

    it.each(["pending_customer", "resolved"] as const)(
      "reopens a %s ticket, as the customer, in the same transaction",
      async (from) => {
        const ticketId = await newTicket(database, {
          customerId,
          status: from,
        });
        const response = await customerReply(
          ticketId,
          customer,
          "It happened again this morning.",
        );
        expect(response.status).toBe(201);
        expect((response.body as CustomerTicket).status).toBe("open");
        expect((response.body as CustomerTicket).timeline.at(-1)?.status).toBe(
          "open",
        );
        expect(await ticketRow(ticketId)).toMatchObject({
          status: "open",
          resolved_at: null,
        });

        const [message] = await asOwner<{ id: string }>(
          database,
          `SELECT id FROM messages WHERE ticket_id = $1 AND author_type = 'customer'
              AND author_customer_id = $2 AND visibility = 'public'`,
          [ticketId, customerId],
        );
        expect(await historyOf(ticketId)).toEqual([
          expect.objectContaining({
            action: "message.created",
            actor_customer_id: customerId,
            after: { visibility: "public" },
          }),
          expect.objectContaining({
            action: "ticket.status_changed",
            actor_type: "customer",
            actor_customer_id: customerId,
            before: { status: from },
            after: { status: "open" },
          }),
        ]);
        expect(await eventsOf(ticketId)).toEqual([
          {
            event_type: "message.created",
            payload: {
              ticketId,
              messageId: message?.id,
              authorType: "customer",
              visibility: "public",
            },
          },
          {
            event_type: "ticket.status_changed",
            payload: {
              ticketId,
              fromStatus: from,
              toStatus: "open",
              messageId: message?.id,
            },
          },
        ]);
      },
    );

    it("is refused on a closed ticket, and writes nothing", async () => {
      const ticketId = await newTicket(database, {
        customerId,
        status: "closed",
      });
      const response = await customerReply(ticketId, customer, "Hello?");
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        type: "tag:dsd.example,2026:problems/ticket-closed",
      });
      expect(await historyOf(ticketId)).toEqual([]);
      expect(await eventsOf(ticketId)).toEqual([]);
    });

    it("carries files, which arrive with the reply", async () => {
      const ticketId = await newTicket(database, { customerId });
      const response = await customerReply(
        ticketId,
        customer,
        "Photo attached",
      ).attach("attachments", FILES.jpeg, "router-lights.jpg");
      expect(response.status).toBe(201);
      expect(
        (response.body as CustomerTicket).messages.at(-1)?.attachments,
      ).toEqual([
        expect.objectContaining({
          filename: "router-lights.jpg",
          contentType: "image/jpeg",
        }),
      ]);
    });

    it("can't reach another customer's ticket (404), and reads no file first", async () => {
      const [other] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM tickets WHERE customer_id <> $1 AND status = 'open' LIMIT 1",
        [customerId],
      );
      const response = await customerReply(
        other?.id ?? "",
        customer,
        "Mine now",
      ).attach("attachments", FILES.png, "a.png");
      expect(response.status).toBe(404);
    });
  });

  describe("a guest's reply", () => {
    it("works on the guest's own ticket, through the emailed link, and nowhere else", async () => {
      await resetRateLimits(app);
      const submitted = await request(app.getHttpServer())
        .post("/api/v1/public/tickets")
        .set("origin", ORIGIN)
        .field("email", "guest.reply@example.com")
        .field("subject", "Doorbell chime too quiet")
        .field("description", "I can't hear it upstairs.");
      expect(submitted.status).toBe(201);
      const [ticket] = await asOwner<{ id: string; customer_id: string }>(
        database,
        "SELECT id, customer_id FROM tickets WHERE reference = $1",
        [(submitted.body as { reference: string }).reference],
      );
      if (ticket === undefined) throw new Error("the ticket wasn't filed");

      // What the worker will send in the acknowledgement email.
      const { token } = await issueLinkToken(database, {
        purpose: "guest_ticket_access",
        customerId: ticket.customer_id,
        ticketId: ticket.id,
      });
      const opened = await request(app.getHttpServer())
        .post("/api/v1/auth/customer/guest-access/exchange")
        .set("origin", ORIGIN)
        .send({ token });
      expect(opened.status).toBe(200);
      const guest = credentialsFrom(app, "customer", opened).credentials;

      const reply = await customerReply(
        ticket.id,
        guest,
        "Here is a recording.",
      ).attach("attachments", FILES.log, "chime-test.txt");
      expect(reply.status).toBe(201);
      const [message] = await asOwner<{ author_customer_id: string }>(
        database,
        "SELECT author_customer_id FROM messages WHERE ticket_id = $1",
        [ticket.id],
      );
      expect(message?.author_customer_id).toBe(ticket.customer_id);
      expect((await historyOf(ticket.id)).at(-2)).toMatchObject({
        action: "message.created",
        actor_customer_id: ticket.customer_id,
      });

      // Another ticket of the same customer is outside the link's reach.
      const sibling = await newTicket(database, {
        customerId: ticket.customer_id,
      });
      expect(
        (await customerReply(sibling, guest, "And this one?")).status,
      ).toBe(404);
    });

    it("is refused once the guest's ticket is closed", async () => {
      const [guestCustomer] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM customers WHERE password_hash IS NULL LIMIT 1",
      );
      const ticketId = await newTicket(database, {
        customerId: guestCustomer?.id ?? "",
        status: "closed",
      });
      const guest = await sessionFor(app, {
        kind: "guest",
        customerId: guestCustomer?.id ?? "",
        ticketId,
      });
      const response = await customerReply(ticketId, guest, "Still broken");
      expect(response.status).toBe(409);
    });
  });
});

import type { TestDatabase } from "@dsd/db/testing";
import type { CustomerTicket, StaffTicket, TicketStatus } from "@dsd/shared";
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
  let agentId: string;
  let agent: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_ticket_lifecycle");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
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

  const agentReply = (
    ticketId: string,
    body: string,
    status?: TicketStatus,
  ) => {
    const call = send(
      "post",
      `/api/v1/staff/tickets/${ticketId}/replies`,
      agent,
    ).field("body", body);
    return status === undefined ? call : call.field("status", status);
  };

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

  describe("an agent's reply", () => {
    it("records the first response once, and an internal note doesn't count", async () => {
      const ticketId = await newTicket(database, { customerId });
      const note = await send(
        "post",
        `/api/v1/staff/tickets/${ticketId}/notes`,
        agent,
      ).field("body", "Checking the logs first.");
      expect(note.status).toBe(201);
      expect((await ticketRow(ticketId)).first_response_at).toBeNull();

      expect(
        (await agentReply(ticketId, "Can you restart the hub?")).status,
      ).toBe(201);
      const first = (await ticketRow(ticketId)).first_response_at;
      expect(first).toBeInstanceOf(Date);
      expect((await agentReply(ticketId, "Any luck?")).status).toBe(201);
      expect((await ticketRow(ticketId)).first_response_at).toEqual(first);
      // Neither the timestamp nor a reply without a status moves the status.
      expect((await ticketRow(ticketId)).status).toBe("open");
    });

    it("can move the ticket in the same request, as the agent", async () => {
      const ticketId = await newTicket(database, { customerId });
      const response = await agentReply(
        ticketId,
        "Please try the steps below and let us know.",
        "pending_customer",
      );
      expect(response.status).toBe(201);
      const view = response.body as StaffTicket;
      expect(view.status).toBe("pending_customer");
      expect(view.allowedTransitions).toEqual(["open", "resolved", "closed"]);

      const [message] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM messages WHERE ticket_id = $1",
        [ticketId],
      );
      expect((await historyOf(ticketId)).map((event) => event.action)).toEqual([
        "message.created",
        "ticket.status_changed",
      ]);
      expect((await eventsOf(ticketId)).at(-1)).toEqual({
        event_type: "ticket.status_changed",
        payload: {
          ticketId,
          fromStatus: "open",
          toStatus: "pending_customer",
          messageId: message?.id,
        },
      });
    });

    it("refuses a status the state machine doesn't allow, and sends nothing", async () => {
      const ticketId = await newTicket(database, {
        customerId,
        status: "resolved",
      });
      const response = await agentReply(
        ticketId,
        "Waiting on you",
        "pending_customer",
      );
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        type: "tag:dsd.example,2026:problems/invalid-status-transition",
        allowedTransitions: ["open", "closed"],
      });
      expect(await historyOf(ticketId)).toEqual([]);
      expect((await ticketRow(ticketId)).first_response_at).toBeNull();
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

      // The agent answers and waits for the customer.
      expect(
        (
          await agentReply(
            ticket.id,
            "Which chime model is it?",
            "pending_customer",
          )
        ).status,
      ).toBe(201);

      const reply = await customerReply(
        ticket.id,
        guest,
        "Here is a recording.",
      ).attach("attachments", FILES.log, "chime-test.txt");
      expect(reply.status).toBe(201);
      // The guest's reply reopens the ticket.
      expect((reply.body as CustomerTicket).status).toBe("open");
      expect(
        (reply.body as CustomerTicket).messages.map(
          (message) => message.author.type,
        ),
      ).toEqual(["agent", "customer"]);
      const [message] = await asOwner<{ author_customer_id: string }>(
        database,
        "SELECT author_customer_id FROM messages WHERE ticket_id = $1 AND author_type = 'customer'",
        [ticket.id],
      );
      expect(message?.author_customer_id).toBe(ticket.customer_id);
      expect((await historyOf(ticket.id)).slice(-3)).toEqual([
        expect.objectContaining({
          action: "message.created",
          actor_customer_id: ticket.customer_id,
        }),
        expect.objectContaining({ action: "attachment.created" }),
        expect.objectContaining({
          action: "ticket.status_changed",
          actor_customer_id: ticket.customer_id,
          after: { status: "open" },
        }),
      ]);

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

  describe("status and priority (FR-9)", () => {
    const patch = (
      ticketId: string,
      field: "status" | "priority",
      value: string,
    ) =>
      send("patch", `/api/v1/staff/tickets/${ticketId}/${field}`, agent).send({
        [field]: value,
      });

    it("walks a ticket from submission to closed, and every step is history", async () => {
      await resetRateLimits(app);
      const submitted = await send("post", "/api/v1/customer/tickets", customer)
        .field("subject", "Smart plug won't pair")
        .field("description", "It blinks red and the app can't find it.");
      expect(submitted.status).toBe(201);
      const ticketId = (submitted.body as { id: string }).id;

      // The agent replies and waits for the customer.
      expect(
        (
          await agentReply(
            ticketId,
            "Hold the button for ten seconds.",
            "pending_customer",
          )
        ).status,
      ).toBe(201);
      expect((await ticketRow(ticketId)).first_response_at).toBeInstanceOf(
        Date,
      );

      // The customer's reply reopens it.
      expect(
        (await customerReply(ticketId, customer, "Still red.")).status,
      ).toBe(201);
      expect((await ticketRow(ticketId)).status).toBe("open");

      // Resolved, then reopened by the customer, which clears resolved_at.
      expect((await patch(ticketId, "status", "resolved")).status).toBe(200);
      expect((await ticketRow(ticketId)).resolved_at).toBeInstanceOf(Date);
      expect(
        (await customerReply(ticketId, customer, "It came back.")).status,
      ).toBe(201);
      expect(await ticketRow(ticketId)).toMatchObject({
        status: "open",
        resolved_at: null,
      });

      // Resolved again, then closed: resolved_at stays, closed_at is set.
      const resolved = await agentReply(
        ticketId,
        "A firmware update fixed it.",
        "resolved",
      );
      expect(resolved.status).toBe(201);
      const closing = await patch(ticketId, "status", "closed");
      expect(closing.status).toBe(200);
      expect((closing.body as StaffTicket).allowedTransitions).toEqual([]);
      const closed = await ticketRow(ticketId);
      expect(closed.resolved_at).toBeInstanceOf(Date);
      expect(closed.closed_at).toBeInstanceOf(Date);

      // A closed ticket takes internal notes and nothing else.
      expect((await customerReply(ticketId, customer, "Thanks!")).status).toBe(
        409,
      );
      expect((await agentReply(ticketId, "Glad to help")).status).toBe(409);
      expect(
        (
          await send(
            "post",
            `/api/v1/staff/tickets/${ticketId}/notes`,
            agent,
          ).field("body", "Customer confirmed by phone.")
        ).status,
      ).toBe(201);
      const reopen = await patch(ticketId, "status", "open");
      expect(reopen.status).toBe(409);
      expect(reopen.body).toMatchObject({ allowedTransitions: [] });

      const statuses = (await historyOf(ticketId))
        .filter((event) => event.action === "ticket.status_changed")
        .map((event) => [event.actor_type, event.before, event.after]);
      expect(statuses).toEqual([
        ["agent", { status: "open" }, { status: "pending_customer" }],
        ["customer", { status: "pending_customer" }, { status: "open" }],
        ["agent", { status: "open" }, { status: "resolved" }],
        ["customer", { status: "resolved" }, { status: "open" }],
        ["agent", { status: "open" }, { status: "resolved" }],
        ["agent", { status: "resolved" }, { status: "closed" }],
      ]);
      const outboxStatuses = (await eventsOf(ticketId)).filter(
        (event) => event.event_type === "ticket.status_changed",
      );
      expect(outboxStatuses).toHaveLength(6);

      // The customer's timeline tells the same story.
      const view = await request(app.getHttpServer())
        .get(`/api/v1/customer/tickets/${ticketId}`)
        .set("cookie", customer.cookie);
      expect(
        (view.body as CustomerTicket).timeline.map((entry) => entry.status),
      ).toEqual([
        "open",
        "pending_customer",
        "open",
        "resolved",
        "open",
        "resolved",
        "closed",
      ]);
    });

    it("refuses a transition outside the table with the allowed targets", async () => {
      const ticketId = await newTicket(database, {
        customerId,
        status: "resolved",
      });
      const response = await patch(ticketId, "status", "pending_customer");
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({
        type: "tag:dsd.example,2026:problems/invalid-status-transition",
        allowedTransitions: ["open", "closed"],
      });
      expect(await historyOf(ticketId)).toEqual([]);
    });

    it("treats the current status as a no-op: 200 and no history", async () => {
      const ticketId = await newTicket(database, {
        customerId,
        status: "pending_customer",
      });
      const response = await patch(ticketId, "status", "pending_customer");
      expect(response.status).toBe(200);
      expect(await historyOf(ticketId)).toEqual([]);
      expect(await eventsOf(ticketId)).toEqual([]);
    });

    it("changes the priority with its history, and skips a no-op", async () => {
      const ticketId = await newTicket(database, { customerId });
      const response = await patch(ticketId, "priority", "urgent");
      expect(response.status).toBe(200);
      expect((response.body as StaffTicket).priority).toBe("urgent");
      expect((await patch(ticketId, "priority", "urgent")).status).toBe(200);
      expect(await historyOf(ticketId)).toEqual([
        expect.objectContaining({
          action: "ticket.priority_changed",
          actor_type: "agent",
          before: { priority: "normal" },
          after: { priority: "urgent" },
        }),
      ]);
      expect(await eventsOf(ticketId)).toEqual([
        {
          event_type: "ticket.priority_changed",
          payload: { ticketId, fromPriority: "normal", toPriority: "urgent" },
        },
      ]);
    });

    it("keeps a closed ticket's priority (409) and refuses an unknown one (400)", async () => {
      const closed = await newTicket(database, {
        customerId,
        status: "closed",
      });
      expect((await patch(closed, "priority", "high")).status).toBe(409);
      const open = await newTicket(database, { customerId });
      expect((await patch(open, "priority", "critical")).status).toBe(400);
    });

    it("serialises two simultaneous changes: the second sees the first", async () => {
      const ticketId = await newTicket(database, { customerId });
      const responses = await Promise.all([
        patch(ticketId, "status", "closed"),
        patch(ticketId, "status", "pending_customer"),
      ]);
      // Either order ends closed. If closing ran first, the other change was
      // checked against a closed ticket and refused; if it ran second, it
      // was checked against pending_customer, from which closing is allowed.
      expect((await ticketRow(ticketId)).status).toBe("closed");
      const changes = await historyOf(ticketId);
      const codes = responses.map((response) => response.status).sort();
      expect(codes).toEqual(changes.length === 2 ? [200, 200] : [200, 409]);
      // Each recorded change starts where the one before it ended.
      for (let index = 1; index < changes.length; index += 1) {
        expect(changes[index]?.before).toEqual(changes[index - 1]?.after);
      }
    });
  });
});

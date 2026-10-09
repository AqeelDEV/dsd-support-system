import { randomUUID } from "node:crypto";

import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Queue } from "bullmq";

import type { Env } from "../../src/config/env.js";
import type { Container } from "../../src/container.js";
import type { Worker } from "../../src/lifecycle.js";
import {
  anyEmailContains,
  type Email,
  emailsTo,
  eventually,
  fixtures,
  startTestWorker,
  storedToken,
  testEnv,
  tokenIn,
} from "../support/worker.js";

/**
 * Ticket notifications end to end (FR-5; ADR-0005, section 7): outbox rows
 * as the API writes them, the real worker, and the emails read back from
 * Mailpit. Every customer here has a fresh address, so a search finds only
 * this run's mail.
 */
describe("ticket notifications", () => {
  let database: TestDatabase;
  let worker: Worker;
  let container: Container;
  let env: Env;
  let agentId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_notifications");
    env = testEnv(database);
    ({ worker, container } = await startTestWorker(env));
    agentId = (await fixtures.agent(database)).id;
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  /** Waits until `address` has `count` emails, then a little longer to catch any extra. */
  const inbox = async (address: string, count: number): Promise<Email[]> => {
    await eventually(async () => {
      const emails = await emailsTo(address);
      return emails.length >= count ? emails : undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return emailsTo(address);
  };

  const deliveries = (eventId: string) =>
    asOwner<{ status: string; template: string; attempts: number }>(
      database,
      "SELECT status, template, attempts FROM notification_deliveries WHERE event_id = $1",
      [eventId],
    );

  it("acknowledges a guest's ticket with a link that opens it, valid for 7 days", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const eventId = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );

    const [email] = await inbox(customer.email, 1);
    expect(email?.subject).toBe(
      `[${ticket.reference}] We've received your request`,
    );
    expect(email?.from).toBe("support@dsd.example");
    expect(email?.text).toContain("http://customer.test/access#token=");
    const token = await storedToken(database, tokenIn(email));
    expect(token).toMatchObject({
      purpose: "guest_ticket_access",
      customer_id: customer.id,
      ticket_id: ticket.id,
    });
    expect(token?.minutes).toBeGreaterThan(7 * 24 * 60 - 5);
    expect(token?.minutes).toBeLessThanOrEqual(7 * 24 * 60);
    expect(await deliveries(eventId)).toEqual([
      { status: "sent", template: "ticketReceived", attempts: 1 },
    ]);
  });

  it("sends a customer with an account to their ticket page, with no token", async () => {
    const customer = await fixtures.customer(database, { hasAccount: true });
    const ticket = await fixtures.ticket(database, customer.id);
    await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    const [email] = await inbox(customer.email, 1);
    expect(email?.text).toContain(`http://customer.test/tickets/${ticket.id}`);
    expect(email?.text).not.toContain("#token=");
    const [tokens] = await asOwner<{ n: number }>(
      database,
      "SELECT count(*)::int AS n FROM auth_tokens WHERE customer_id = $1",
      [customer.id],
    );
    expect(tokens?.n).toBe(0);
  });

  it("emails an agent's reply once, mentioning the status the reply set", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const reply = `Please restart the hub and tell us what the light does. ${randomUUID()}`;
    const messageId = await fixtures.message(database, {
      ticketId: ticket.id,
      body: reply,
      author: { agentId },
    });
    // Written together by the API, in the reply's transaction. Two separate
    // inserts would let the worker send the reply before the status exists.
    await fixtures.events(database, [
      {
        type: "message.created",
        aggregate: { type: "ticket", id: ticket.id },
        payload: {
          ticketId: ticket.id,
          messageId,
          authorType: "agent",
          visibility: "public",
        },
      },
      {
        type: "ticket.status_changed",
        aggregate: { type: "ticket", id: ticket.id },
        payload: {
          ticketId: ticket.id,
          fromStatus: "open",
          toStatus: "pending_customer",
          messageId,
        },
      },
    ]);

    const emails = await inbox(customer.email, 1);
    expect(emails).toHaveLength(1);
    const [email] = emails;
    expect(email?.subject).toBe(
      `[${ticket.reference}] New reply: Hub keeps going offline`,
    );
    expect(email?.text).toContain("Sam Agent replied");
    expect(email?.text).toContain(reply);
    expect(email?.text).toContain("is waiting for your reply");
  });

  it("emails a status change made on its own", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    await fixtures.event(
      database,
      "ticket.status_changed",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        fromStatus: "open",
        toStatus: "resolved",
        messageId: null,
      },
    );
    const [email] = await inbox(customer.email, 1);
    expect(email?.subject).toBe(
      `[${ticket.reference}] Your ticket has been resolved`,
    );
  });

  it("never emails an internal note or a customer's own message, and never quotes a note", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const canary = `CANARY-${randomUUID()}`;
    const noteId = await fixtures.message(database, {
      ticketId: ticket.id,
      body: `Internal: refund approved off the record ${canary}`,
      author: { agentId },
      visibility: "internal",
    });
    const customerMessageId = await fixtures.message(database, {
      ticketId: ticket.id,
      body: "Any news?",
      author: { customerId: customer.id },
    });
    await fixtures.event(
      database,
      "message.created",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        messageId: noteId,
        authorType: "agent",
        visibility: "internal",
      },
    );
    // A customer's reply that reopens the ticket carries the reply's ID: no email either.
    await fixtures.event(
      database,
      "message.created",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        messageId: customerMessageId,
        authorType: "customer",
        visibility: "public",
      },
    );
    await fixtures.event(
      database,
      "ticket.status_changed",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        fromStatus: "pending_customer",
        toStatus: "open",
        messageId: customerMessageId,
      },
    );
    // A forged event claiming the note is public still can't reach its text:
    // the worker reads replies only through public_reply_bodies.
    await fixtures.event(
      database,
      "message.created",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        messageId: noteId,
        authorType: "agent",
        visibility: "public",
      },
    );

    await eventually(async () => {
      const [row] = await asOwner<{ n: number }>(
        database,
        "SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1 AND dispatched_at IS NULL",
        [ticket.id],
      );
      return row?.n === 0 ? true : undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await emailsTo(customer.email)).toEqual([]);
    expect(await anyEmailContains(canary)).toBe(false);
  });

  it("sends one email when the same event is handled twice", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const eventId = await fixtures.event(
      database,
      "ticket.status_changed",
      { type: "ticket", id: ticket.id },
      {
        ticketId: ticket.id,
        fromStatus: "open",
        toStatus: "closed",
        messageId: null,
      },
    );
    await inbox(customer.email, 1);

    // The same event handled again, as at-least-once delivery allows: a
    // second job for it, under an ID BullMQ hasn't seen.
    const queue = new Queue("notifications", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      const job = await queue.add(
        "ticket.status_changed",
        {
          eventId,
          type: "ticket.status_changed",
          payload: {
            ticketId: ticket.id,
            fromStatus: "open",
            toStatus: "closed",
            messageId: null,
          },
        },
        { jobId: `${eventId}.again` },
      );
      await eventually(async () =>
        (await job.isCompleted()) ? true : undefined,
      );
    } finally {
      await queue.close();
    }
    expect(await inbox(customer.email, 1)).toHaveLength(1);
    expect(await deliveries(eventId)).toEqual([
      { status: "sent", template: "statusChanged", attempts: 1 },
    ]);
  });
});

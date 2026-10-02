import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { CustomerTicket, CustomerTicketSummary } from "@dsd/shared";
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
import { newTicket } from "../support/tickets.js";

interface Page {
  items: CustomerTicketSummary[];
  nextCursor: string | null;
}

/** What a customer sees of their own tickets (FR-3; ADR-0007, section 7). */
describe("customer ticket view", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let customer: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_customer_view");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const get = (path: string, caller: Credentials) =>
    request(app.getHttpServer()).get(path).set("cookie", caller.cookie);

  /** A seeded ticket of the demo customer's with an internal note and a status change. */
  async function workedTicket(): Promise<string> {
    const [row] = await asOwner<{ id: string }>(
      database,
      `SELECT t.id FROM tickets t
        WHERE t.customer_id = $1
          AND EXISTS (SELECT 1 FROM messages m WHERE m.ticket_id = t.id AND m.visibility = 'internal')
          AND EXISTS (SELECT 1 FROM audit_events a WHERE a.ticket_id = t.id AND a.action = 'ticket.status_changed')
        ORDER BY t.number LIMIT 1`,
      [customerId],
    );
    if (row === undefined) throw new Error("the seed has no worked ticket");
    return row.id;
  }

  describe("the list", () => {
    it("holds only the customer's own tickets, newest first", async () => {
      const response = await get(
        "/api/v1/customer/tickets?limit=100",
        customer,
      );
      expect(response.status).toBe(200);
      const page = response.body as Page;
      const own = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM tickets WHERE customer_id = $1 ORDER BY created_at DESC, id DESC",
        [customerId],
      );
      expect(page.items.map((item) => item.id)).toEqual(
        own.map((row) => row.id),
      );
      expect(page.nextCursor).toBeNull();
      expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
        ["createdAt", "id", "reference", "status", "subject"].sort(),
      );
    });

    it("pages through every ticket once, with tickets created in the same instant", async () => {
      const { pool } = { pool: database.pool("dsd_migrator") };
      // Same created_at to the microsecond: only the ID tells them apart.
      await pool.query(
        `INSERT INTO tickets (brand_id, customer_id, channel, subject, description, created_at)
         SELECT b.id, $1, 'web', 'Twin ' || g, 'Same instant', '2026-09-30T08:00:00.123456Z'
           FROM brands b, generate_series(1, 3) g WHERE b.slug = 'dsd'`,
        [customerId],
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? "" : `&cursor=${cursor}`;
        const response = await get(
          `/api/v1/customer/tickets?limit=2${query}`,
          customer,
        );
        expect(response.status).toBe(200);
        const page = response.body as Page;
        expect(page.items.length).toBeLessThanOrEqual(2);
        seen.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      const all = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM tickets WHERE customer_id = $1 ORDER BY created_at DESC, id DESC",
        [customerId],
      );
      expect(seen).toEqual(all.map((row) => row.id));
    });

    it("refuses a cursor it didn't make (400)", async () => {
      const response = await get(
        "/api/v1/customer/tickets?cursor=bogus",
        customer,
      );
      expect(response.status).toBe(400);
    });

    it("shows a guest session only the ticket its link opened", async () => {
      const [guest] = await asOwner<{ id: string; customer_id: string }>(
        database,
        `SELECT t.id, t.customer_id FROM tickets t JOIN customers c ON c.id = t.customer_id
          WHERE c.password_hash IS NULL ORDER BY t.number LIMIT 1`,
      );
      if (guest === undefined) throw new Error("no guest ticket");
      // The same customer has another ticket the link doesn't cover.
      await newTicket(database, { customerId: guest.customer_id });
      const caller = await sessionFor(app, {
        kind: "guest",
        customerId: guest.customer_id,
        ticketId: guest.id,
      });
      const response = await get("/api/v1/customer/tickets", caller);
      expect((response.body as Page).items.map((item) => item.id)).toEqual([
        guest.id,
      ]);
    });
  });

  describe("one ticket", () => {
    it("shows the description, the public replies and the status timeline, and no internal notes", async () => {
      const ticketId = await workedTicket();
      const response = await get(
        `/api/v1/customer/tickets/${ticketId}`,
        customer,
      );
      expect(response.status).toBe(200);
      const ticket = response.body as CustomerTicket;

      const publicMessages = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM messages WHERE ticket_id = $1 AND visibility = 'public' ORDER BY created_at, id",
        [ticketId],
      );
      expect(ticket.messages.map((message) => message.id)).toEqual(
        publicMessages.map((row) => row.id),
      );
      const notes = await asOwner<{ body: string }>(
        database,
        "SELECT body FROM messages WHERE ticket_id = $1 AND visibility = 'internal'",
        [ticketId],
      );
      const text = JSON.stringify(response.body);
      for (const note of notes) expect(text).not.toContain(note.body);

      const changes = await asOwner<{ status: string }>(
        database,
        `SELECT after ->> 'status' AS status FROM audit_events
          WHERE ticket_id = $1 AND action = 'ticket.status_changed' ORDER BY created_at, id`,
        [ticketId],
      );
      expect(ticket.timeline.map((entry) => entry.status)).toEqual([
        "open",
        ...changes.map((change) => change.status),
      ]);
      expect(ticket.timeline.at(-1)?.status).toBe(ticket.status);
      for (const field of [
        "priority",
        "assignee",
        "escalatedAt",
        "visibility",
      ]) {
        expect(text).not.toContain(`"${field}"`);
      }
    });

    it("says whether the customer can reply: every status but closed", async () => {
      const rows = await asOwner<{ id: string; status: string }>(
        database,
        `SELECT DISTINCT ON (status) id, status FROM tickets
          WHERE customer_id = $1 ORDER BY status, number`,
        [customerId],
      );
      expect(rows.map((row) => row.status)).toContain("closed");
      for (const row of rows) {
        const response = await get(
          `/api/v1/customer/tickets/${row.id}`,
          customer,
        );
        expect((response.body as CustomerTicket).canReply).toBe(
          row.status !== "closed",
        );
      }
    });

    it("names who wrote each reply, by display name only", async () => {
      const ticketId = await workedTicket();
      const response = await get(
        `/api/v1/customer/tickets/${ticketId}`,
        customer,
      );
      const agentReply = (response.body as CustomerTicket).messages.find(
        (message) => message.author.type === "agent",
      );
      expect(agentReply?.author.name).toEqual(expect.any(String));
      expect(JSON.stringify(response.body)).not.toContain("@dsd.example");
    });

    it("lists files on the ticket and on public replies, never on internal notes", async () => {
      const ticketId = await workedTicket();
      const [note] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM messages WHERE ticket_id = $1 AND visibility = 'internal' LIMIT 1",
        [ticketId],
      );
      const [reply] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM messages WHERE ticket_id = $1 AND visibility = 'public' LIMIT 1",
        [ticketId],
      );
      const attach = async (messageId: string | null, filename: string) => {
        await asOwner(
          database,
          `INSERT INTO attachments (ticket_id, message_id, uploader_type, uploader_customer_id,
                                    object_key, filename, content_type, size_bytes, sha256)
           VALUES ($1, $2, 'customer', $3, $4, $5, 'image/png', 70, $6)`,
          [
            ticketId,
            messageId,
            customerId,
            `attachments/${randomUUID()}`,
            filename,
            Buffer.alloc(32),
          ],
        );
      };
      await attach(null, "on-the-ticket.png");
      await attach(reply?.id ?? null, "on-a-reply.png");
      await attach(note?.id ?? null, "on-a-note.png");

      const response = await get(
        `/api/v1/customer/tickets/${ticketId}`,
        customer,
      );
      const ticket = response.body as CustomerTicket;
      expect(ticket.attachments.map((file) => file.filename)).toEqual([
        "on-the-ticket.png",
      ]);
      expect(
        ticket.messages
          .find((message) => message.id === reply?.id)
          ?.attachments.map((file) => file.filename),
      ).toEqual(["on-a-reply.png"]);
      expect(JSON.stringify(response.body)).not.toContain("on-a-note.png");
    });

    it.each([
      ["another customer's ticket", "other"],
      ["a ticket that doesn't exist", "missing"],
    ])("answers 404 for %s, the same either way", async (_name, which) => {
      const [other] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM tickets WHERE customer_id <> $1 LIMIT 1",
        [customerId],
      );
      const ticketId = which === "other" ? (other?.id ?? "") : randomUUID();
      const response = await get(
        `/api/v1/customer/tickets/${ticketId}`,
        customer,
      );
      expect(response.status).toBe(404);
      expect((response.body as { detail: string }).detail).toBe(
        "No such ticket.",
      );
    });

    it("refuses a guest session any ticket but its own (404)", async () => {
      const [guest] = await asOwner<{ id: string; customer_id: string }>(
        database,
        `SELECT t.id, t.customer_id FROM tickets t JOIN customers c ON c.id = t.customer_id
          WHERE c.password_hash IS NULL ORDER BY t.number LIMIT 1`,
      );
      if (guest === undefined) throw new Error("no guest ticket");
      const sibling = await newTicket(database, {
        customerId: guest.customer_id,
      });
      const caller = await sessionFor(app, {
        kind: "guest",
        customerId: guest.customer_id,
        ticketId: guest.id,
      });
      expect(
        (await get(`/api/v1/customer/tickets/${guest.id}`, caller)).status,
      ).toBe(200);
      expect(
        (await get(`/api/v1/customer/tickets/${sibling}`, caller)).status,
      ).toBe(404);
    });

    it("refuses a malformed ID with 400", async () => {
      const response = await get(
        "/api/v1/customer/tickets/not-a-uuid",
        customer,
      );
      expect(response.status).toBe(400);
    });
  });
});

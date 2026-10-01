import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closedPort } from "../support/app.js";
import { DEMO, ORIGIN, resetRateLimits, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { FILES } from "../support/files.js";

const REFERENCE = /^DSD-\d{6,}$/;

const referenceOf = (response: request.Response) =>
  (response.body as { reference: string }).reference;

interface TicketRow {
  id: string;
  customer_id: string;
  channel: string;
  status: string;
  priority: string;
  contact_verified_at: Date | null;
}

/**
 * Raising a ticket, as a guest and as a signed-in customer (FR-1, FR-2,
 * FR-6, NFR-9; ADR-0003, section 6; ADR-0011).
 */
describe("ticket submission", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let address = 0;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_tickets_create");
    app = await startAppOn(database, { TRUST_PROXY: "127.0.0.1,::1" });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  beforeEach(async () => {
    await resetRateLimits(app);
  });

  /** A browser on our own pages, from an address of its own unless told otherwise. */
  const post = (path: string, target = app, ip?: string) => {
    address += 1;
    return request(target.getHttpServer())
      .post(path)
      .set("origin", ORIGIN)
      .set("x-forwarded-for", ip ?? `192.0.2.${address % 250}`);
  };

  const guestForm = (email: string, subject = "Hub keeps dropping Wi-Fi") =>
    post("/api/v1/public/tickets")
      .field("email", email)
      .field("subject", subject)
      .field("description", "It disconnects every evening around 8pm.");

  const ticketByReference = async (reference: string) => {
    const [row] = await asOwner<TicketRow>(
      database,
      "SELECT * FROM tickets WHERE reference = $1",
      [reference],
    );
    if (row === undefined) throw new Error(`no ticket ${reference}`);
    return row;
  };

  describe("as a guest", () => {
    it("files an open web ticket, answers with its reference and signs nobody in", async () => {
      const requestId = randomUUID();
      const response = await guestForm("New.Guest@Example.com").set(
        "x-request-id",
        requestId,
      );
      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        reference: expect.stringMatching(REFERENCE) as string,
      });
      expect(response.headers["set-cookie"]).toBeUndefined();

      const ticket = await ticketByReference(referenceOf(response));
      expect(ticket).toMatchObject({
        channel: "web",
        status: "open",
        priority: "normal",
        contact_verified_at: null,
      });
      const [customer] = await asOwner<{
        email: string;
        password_hash: string | null;
      }>(database, "SELECT email, password_hash FROM customers WHERE id = $1", [
        ticket.customer_id,
      ]);
      expect(customer).toEqual({
        email: "New.Guest@Example.com",
        password_hash: null,
      });

      const audit = await asOwner(
        database,
        `SELECT action, entity_type, actor_type, actor_customer_id, after, request_id
           FROM audit_events WHERE ticket_id = $1`,
        [ticket.id],
      );
      expect(audit).toEqual([
        {
          action: "ticket.created",
          entity_type: "ticket",
          actor_type: "customer",
          actor_customer_id: ticket.customer_id,
          after: { status: "open", priority: "normal", channel: "web" },
          request_id: requestId,
        },
      ]);
      const outbox = await asOwner(
        database,
        "SELECT event_type, payload FROM outbox_events WHERE aggregate_id = $1",
        [ticket.id],
      );
      expect(outbox).toEqual([
        {
          event_type: "ticket.created",
          payload: { ticketId: ticket.id, customerId: ticket.customer_id },
        },
      ]);
    });

    it("puts a ticket for a known email on that customer, unverified", async () => {
      const response = await guestForm("CUSTOMER@example.com");
      expect(response.status).toBe(201);
      const ticket = await ticketByReference(referenceOf(response));
      expect(ticket.customer_id).toBe(
        await idOf(database, "customers", DEMO.customer),
      );
      expect(ticket.contact_verified_at).toBeNull();
    });

    it("stores attachments on the ticket, typed by their content", async () => {
      const response = await guestForm("files@example.com")
        .attach("attachments", FILES.png, "screenshot.png")
        .attach("attachments", FILES.log, "C:\\Users\\me\\hub.log");
      expect(response.status).toBe(201);
      const ticket = await ticketByReference(referenceOf(response));
      const files = await asOwner<{ id: string }>(
        database,
        `SELECT id, message_id, uploader_type, uploader_customer_id, filename, content_type, size_bytes
           FROM attachments WHERE ticket_id = $1 ORDER BY filename`,
        [ticket.id],
      );
      expect(files.map(({ id: _id, ...file }) => file)).toEqual([
        {
          message_id: null,
          uploader_type: "customer",
          uploader_customer_id: ticket.customer_id,
          filename: "hub.log",
          content_type: "text/plain; charset=utf-8",
          size_bytes: FILES.log.length,
        },
        {
          message_id: null,
          uploader_type: "customer",
          uploader_customer_id: ticket.customer_id,
          filename: "screenshot.png",
          content_type: "image/png",
          size_bytes: FILES.png.length,
        },
      ]);
      const audited = await asOwner<{ entity_id: string }>(
        database,
        "SELECT entity_id FROM audit_events WHERE ticket_id = $1 AND action = 'attachment.created'",
        [ticket.id],
      );
      expect(audited.map((row) => row.entity_id).sort()).toEqual(
        files.map((file) => file.id).sort(),
      );
    });

    it.each([
      [
        "an unknown field (mass assignment)",
        (form: request.Test) => form.field("priority", "urgent"),
        "priority",
      ],
      [
        "a field after a file",
        (form: request.Test) =>
          form
            .attach("attachments", FILES.png, "a.png")
            .field("status", "closed"),
        "status",
      ],
      [
        "a file in the wrong field",
        (form: request.Test) => form.attach("evidence", FILES.png, "a.png"),
        "evidence",
      ],
    ])("refuses %s with a validation problem", async (_name, extend, path) => {
      const response = await extend(guestForm("strict@example.com"));
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        type: "tag:dsd.example,2026:problems/validation-error",
      });
      // An unknown key is reported on the form itself, naming the key.
      const errors = (
        response.body as { errors: { path: string; message: string }[] }
      ).errors;
      expect(
        errors.some(
          (error) => error.path === path || error.message.includes(`"${path}"`),
        ),
      ).toBe(true);
    });

    it("refuses a form without its description", async () => {
      const response = await post("/api/v1/public/tickets")
        .field("email", "short@example.com")
        .field("subject", "Only a subject");
      expect(response.status).toBe(400);
      expect((response.body as { errors: unknown[] }).errors).toEqual([
        expect.objectContaining({ path: "description" }),
      ]);
    });

    it("refuses JSON, because the route takes files", async () => {
      const response = await post("/api/v1/public/tickets").send({
        email: "json@example.com",
        subject: "JSON",
        description: "Sent as JSON",
      });
      expect(response.status).toBe(415);
    });

    it("refuses a renamed executable and files nothing", async () => {
      const before = await asOwner<{ count: string }>(
        database,
        "SELECT count(*) FROM tickets",
      );
      const response = await guestForm("exe@example.com").attach(
        "attachments",
        FILES.exe,
        "invoice.pdf",
      );
      expect(response.status).toBe(415);
      const after = await asOwner<{ count: string }>(
        database,
        "SELECT count(*) FROM tickets",
      );
      expect(after).toEqual(before);
    });

    it("limits each email to 5 tickets an hour (429 with Retry-After)", async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await guestForm("busy@example.com")).status).toBe(201);
      }
      const limited = await guestForm("BUSY@example.com");
      expect(limited.status).toBe(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    });

    it("limits each address to 10 tickets an hour", async () => {
      const from = (index: number) =>
        post("/api/v1/public/tickets", app, "198.51.100.77")
          .field("email", `sender${index}@example.com`)
          .field("subject", "Flood")
          .field("description", "One of many");
      for (let index = 0; index < 10; index += 1) {
        expect((await from(index)).status).toBe(201);
      }
      expect((await from(10)).status).toBe(429);
    });
  });

  describe("as a signed-in customer", () => {
    it("files the ticket on the account, with the contact already verified", async () => {
      const customerId = await idOf(database, "customers", DEMO.customer);
      const caller = await sessionFor(app, { kind: "customer", customerId });
      const response = await post("/api/v1/customer/tickets")
        .set("cookie", caller.cookie)
        .set("x-csrf-token", caller.csrfToken)
        .field("subject", "Thermostat shows the wrong time")
        .field("description", "It is an hour behind since the clocks changed.")
        .attach("attachments", FILES.jpeg, "display.jpg");
      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        reference: expect.stringMatching(REFERENCE) as string,
        subject: "Thermostat shows the wrong time",
        status: "open",
      });
      const ticket = await ticketByReference(referenceOf(response));
      expect(ticket.customer_id).toBe(customerId);
      expect(ticket.contact_verified_at).toBeInstanceOf(Date);
    });

    it("refuses a guest session, which can only see its one ticket (403)", async () => {
      const [guest] = await asOwner<{ id: string; customer_id: string }>(
        database,
        `SELECT t.id, t.customer_id FROM tickets t JOIN customers c ON c.id = t.customer_id
          WHERE c.password_hash IS NULL LIMIT 1`,
      );
      if (guest === undefined) throw new Error("no guest ticket");
      const caller = await sessionFor(app, {
        kind: "guest",
        customerId: guest.customer_id,
        ticketId: guest.id,
      });
      const response = await post("/api/v1/customer/tickets")
        .set("cookie", caller.cookie)
        .set("x-csrf-token", caller.csrfToken)
        .field("subject", "Another one")
        .field("description", "From a guest link");
      expect(response.status).toBe(403);
    });

    it("counts the account's email against the same limit", async () => {
      const customerId = await idOf(database, "customers", DEMO.customer);
      const caller = await sessionFor(app, { kind: "customer", customerId });
      const submit = () =>
        post("/api/v1/customer/tickets")
          .set("cookie", caller.cookie)
          .set("x-csrf-token", caller.csrfToken)
          .field("subject", "Again")
          .field("description", "And again");
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await submit()).status).toBe(201);
      }
      expect((await submit()).status).toBe(429);
    });
  });

  describe("when a dependency is down (NFR-10)", () => {
    it("still takes tickets without Redis, unlimited rather than refused", async () => {
      const withoutRedis = await startAppOn(database, {
        REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
      });
      try {
        const response = await post("/api/v1/public/tickets", withoutRedis)
          .field("email", "no-redis@example.com")
          .field("subject", "Redis is down")
          .field("description", "The ticket still arrives.");
        expect(response.status).toBe(201);
      } finally {
        await withoutRedis.close();
      }
    });

    it("answers 503 for files without the object store, and still takes tickets without files", async () => {
      const withoutStore = await startAppOn(database, {
        S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}`,
      });
      try {
        const withFile = await post("/api/v1/public/tickets", withoutStore)
          .field("email", "no-store@example.com")
          .field("subject", "Store is down")
          .field("description", "With a file")
          .attach("attachments", FILES.png, "a.png");
        expect(withFile.status).toBe(503);
        const withoutFile = await post("/api/v1/public/tickets", withoutStore)
          .field("email", "no-store@example.com")
          .field("subject", "Store is down")
          .field("description", "Without a file");
        expect(withoutFile.status).toBe(201);
      } finally {
        await withoutStore.close();
      }
    });
  });
});

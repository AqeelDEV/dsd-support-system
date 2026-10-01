import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  customerMeSchema,
  guestAccessRequestedSchema,
  PROBLEM_TYPES,
  problemDetailsSchema,
} from "@dsd/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ORIGIN, resetRateLimits, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  startAppOn,
} from "../support/database.js";
import { issueLinkToken } from "../support/tokens.js";

interface GuestTicket {
  ticket_id: string;
  reference: string;
  customer_id: string;
  email: string;
}

/** Guest access to one ticket through emailed links (ADR-0003, section 6; FR-2). */
describe("guest access links", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let guest: GuestTicket;
  let otherTicketId: string;
  const http = () => request(app.getHttpServer());

  const outbox = () =>
    asOwner<{ event_type: string; aggregate_id: string; payload: unknown }>(
      database,
      "SELECT event_type, aggregate_id, payload FROM outbox_events WHERE event_type = 'guest_access.requested' ORDER BY id",
    );

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_guest_access");
    app = await startAppOn(database);
    // A guest (no password) with at least two tickets.
    const [row] = await asOwner<GuestTicket>(
      database,
      `SELECT t.id AS ticket_id, t.reference, c.id AS customer_id, c.email
         FROM tickets t JOIN customers c ON c.id = t.customer_id
        WHERE c.password_hash IS NULL
          AND (SELECT count(*) FROM tickets o WHERE o.customer_id = c.id) > 1
        ORDER BY t.number LIMIT 1`,
    );
    if (row === undefined)
      throw new Error("the seed has no guest with two tickets");
    guest = row;
    const [other] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM tickets WHERE customer_id = $1 AND id <> $2 LIMIT 1",
      [guest.customer_id, guest.ticket_id],
    );
    otherTicketId = other?.id ?? "";
  });

  afterEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe("asking for a link", () => {
    const ask = (email: string, reference: string) =>
      http()
        .post("/api/v1/auth/customer/guest-access/request")
        .set("origin", ORIGIN)
        .send({ email, reference });

    it("queues an email when the address and reference match, carrying IDs only", async () => {
      const before = (await outbox()).length;
      const response = await ask(
        guest.email.toUpperCase(),
        guest.reference.toLowerCase(),
      ).expect(202);
      expect(response.text).toBe("");
      expect(response.headers["set-cookie"]).toBeUndefined();

      const events = await outbox();
      expect(events).toHaveLength(before + 1);
      const event = events.at(-1);
      expect(event?.aggregate_id).toBe(guest.ticket_id);
      expect(guestAccessRequestedSchema.strict().parse(event?.payload)).toEqual(
        { ticketId: guest.ticket_id, customerId: guest.customer_id },
      );
      expect(JSON.stringify(event?.payload)).not.toContain(guest.email);
    });

    it.each([
      ["an unknown email", "nobody@example.com", () => guest.reference],
      ["someone else's ticket", "customer@example.com", () => guest.reference],
      ["an unknown reference", () => guest.email, "DSD-999999"],
    ] as const)(
      "answers %s exactly the same way, and sends nothing",
      async (_, email, reference) => {
        const before = (await outbox()).length;
        const response = await ask(
          typeof email === "function" ? email() : email,
          typeof reference === "function" ? reference() : reference,
        ).expect(202);
        expect(response.text).toBe("");
        expect(await outbox()).toHaveLength(before);
      },
    );

    it("limits requests per email: 3 an hour", async () => {
      for (let i = 0; i < 3; i += 1) {
        await ask(guest.email, guest.reference).expect(202);
      }
      const limited = await ask(guest.email, guest.reference).expect(429);
      expect(problemDetailsSchema.parse(limited.body).type).toBe(
        PROBLEM_TYPES.rateLimited,
      );
    });
  });

  describe("opening a link", () => {
    const exchange = (token: string) =>
      http()
        .post("/api/v1/auth/customer/guest-access/exchange")
        .set("origin", ORIGIN)
        .send({ token });

    it("gives a guest session for exactly that ticket and verifies the contact", async () => {
      await asOwner(
        database,
        "UPDATE tickets SET contact_verified_at = NULL WHERE id = $1",
        [guest.ticket_id],
      );
      const { token } = await issueLinkToken(database, {
        purpose: "guest_ticket_access",
        customerId: guest.customer_id,
        ticketId: guest.ticket_id,
      });
      const response = await exchange(token).expect(200);
      const me = customerMeSchema.parse(response.body);
      expect(me.guestTicketId).toBe(guest.ticket_id);
      expect(me.guestTicketId).not.toBe(otherTicketId);
      expect(me.customer.id).toBe(guest.customer_id);

      const [session] = await asOwner<{
        guest_ticket_id: string;
        lifetime: number;
      }>(
        database,
        `SELECT guest_ticket_id, extract(epoch FROM expires_at - created_at)::int AS lifetime
           FROM sessions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [guest.customer_id],
      );
      expect(session).toEqual({
        guest_ticket_id: guest.ticket_id,
        lifetime: 24 * 3600,
      });
      const [ticket] = await asOwner<{ verified: boolean }>(
        database,
        "SELECT contact_verified_at IS NOT NULL AS verified FROM tickets WHERE id = $1",
        [guest.ticket_id],
      );
      expect(ticket?.verified).toBe(true);

      const cookie = ([] as string[])
        .concat(response.headers["set-cookie"] ?? [])
        .map((value) => value.split(";")[0])
        .join("; ");
      const again = await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", cookie)
        .expect(200);
      expect(customerMeSchema.parse(again.body).guestTicketId).toBe(
        guest.ticket_id,
      );
    });

    it("works again until it expires, because every email carries the newest link", async () => {
      const { token } = await issueLinkToken(database, {
        purpose: "guest_ticket_access",
        customerId: guest.customer_id,
        ticketId: guest.ticket_id,
      });
      await exchange(token).expect(200);
      await exchange(token).expect(200);
    });

    it.each([
      [
        "an expired link",
        () =>
          issueLinkToken(database, {
            purpose: "guest_ticket_access",
            customerId: guest.customer_id,
            ticketId: guest.ticket_id,
            validForMinutes: -1,
          }),
      ],
      [
        "a sign-up link",
        () =>
          issueLinkToken(database, {
            purpose: "customer_signup",
            customerId: guest.customer_id,
          }),
      ],
      ["an unknown token", () => Promise.resolve({ token: "B".repeat(43) })],
    ])("refuses %s", async (_, issue) => {
      const { token } = await issue();
      const response = await exchange(token).expect(400);
      expect(problemDetailsSchema.parse(response.body).type).toBe(
        PROBLEM_TYPES.invalidToken,
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
    });

    it("leaves the browser's session alone when a link fails, and replaces it when one works", async () => {
      const current = await sessionFor(app, {
        kind: "customer",
        customerId: guest.customer_id,
      });
      const me = () =>
        http().get("/api/v1/auth/customer/me").set("cookie", current.cookie);

      await http()
        .post("/api/v1/auth/customer/guest-access/exchange")
        .set("origin", ORIGIN)
        .set("cookie", current.cookie)
        .send({ token: "E".repeat(43) })
        .expect(400);
      await me().expect(200);

      const { token } = await issueLinkToken(database, {
        purpose: "guest_ticket_access",
        customerId: guest.customer_id,
        ticketId: guest.ticket_id,
      });
      await http()
        .post("/api/v1/auth/customer/guest-access/exchange")
        .set("origin", ORIGIN)
        .set("cookie", current.cookie)
        .send({ token })
        .expect(200);
      await me().expect(401);
    });

    it("rejects something that isn't a token before looking it up", async () => {
      const response = await exchange("not-a-token").expect(400);
      expect(problemDetailsSchema.parse(response.body).type).toBe(
        PROBLEM_TYPES.validation,
      );
    });
  });
});

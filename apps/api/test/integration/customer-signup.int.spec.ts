import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  customerMeSchema,
  customerSignupRequestedSchema,
  PROBLEM_TYPES,
  problemDetailsSchema,
} from "@dsd/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO,
  DEMO_PASSWORD,
  ORIGIN,
  resetRateLimits,
  signIn,
} from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { issueLinkToken } from "../support/tokens.js";

const NEW_PASSWORD = "a brand new passphrase";

/** Email-first registration (ADR-0003, section 7; FR-2). */
describe("customer sign-up", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());

  const start = (email: string) =>
    http()
      .post("/api/v1/auth/customer/signup")
      .set("origin", ORIGIN)
      .send({ email });

  const complete = (token: string, password = NEW_PASSWORD) =>
    http()
      .post("/api/v1/auth/customer/signup/complete")
      .set("origin", ORIGIN)
      .send({ token, displayName: "  Robin Guest  ", password });

  const customerRow = async (email: string) => {
    const [row] = await asOwner<{
      id: string;
      password_hash: string | null;
      email_verified_at: Date | null;
      display_name: string | null;
    }>(
      database,
      "SELECT id, password_hash, email_verified_at, display_name FROM customers WHERE email_normalized = $1",
      [email],
    );
    return row;
  };

  const signupEvents = (customerId: string) =>
    asOwner<{ payload: unknown }>(
      database,
      "SELECT payload FROM outbox_events WHERE event_type = 'customer.signup_requested' AND aggregate_id = $1",
      [customerId],
    );

  /** A seeded guest with tickets, and those tickets. */
  const aGuestWithTickets = async () => {
    const [guest] = await asOwner<{ id: string; email: string }>(
      database,
      `SELECT c.id, c.email FROM customers c
        WHERE c.password_hash IS NULL
          AND EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.id)
          AND NOT EXISTS (SELECT 1 FROM outbox_events o WHERE o.aggregate_id = c.id)
        LIMIT 1`,
    );
    if (guest === undefined) throw new Error("no unused seeded guest left");
    return guest;
  };

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_customer_signup");
    app = await startAppOn(database);
  });

  afterEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe("starting", () => {
    it("creates an unverified customer without a password and queues the email", async () => {
      const email = "new.person@example.com";
      const response = await start("New.Person@Example.com").expect(202);
      expect(response.text).toBe("");
      expect(response.headers["set-cookie"]).toBeUndefined();

      const row = await customerRow(email);
      expect(row).toMatchObject({
        password_hash: null,
        email_verified_at: null,
      });
      const events = await signupEvents(row?.id ?? "");
      expect(events).toHaveLength(1);
      expect(
        customerSignupRequestedSchema.strict().parse(events[0]?.payload),
      ).toEqual({ customerId: row?.id });
    });

    it("answers a registered email the same way and changes nothing", async () => {
      const before = await customerRow(DEMO.customer);
      const response = await start(DEMO.customer).expect(202);
      expect(response.text).toBe("");
      expect(await customerRow(DEMO.customer)).toEqual(before);
      // The worker sends a "you already have an account" email instead.
      expect(await signupEvents(before?.id ?? "")).toHaveLength(1);
    });

    it("rejects a body with a password: it isn't chosen until the inbox is proven", async () => {
      await http()
        .post("/api/v1/auth/customer/signup")
        .set("origin", ORIGIN)
        .send({ email: "eager@example.com", password: NEW_PASSWORD })
        .expect(400);
      expect(await customerRow("eager@example.com")).toBeUndefined();
    });

    it("limits requests per email: 3 an hour", async () => {
      for (let i = 0; i < 3; i += 1) {
        await start("often@example.com").expect(202);
      }
      await start("often@example.com").expect(429);
    });
  });

  describe("completing", () => {
    it("sets the password on the guest's own row, so their tickets are already in the account", async () => {
      const guest = await aGuestWithTickets();
      await start(guest.email).expect(202);
      const { token } = await issueLinkToken(database, {
        purpose: "customer_signup",
        customerId: guest.id,
      });

      const response = await complete(token).expect(200);
      const me = customerMeSchema.parse(response.body);
      expect(me).toMatchObject({
        customer: { id: guest.id, displayName: "Robin Guest" },
        guestTicketId: null,
      });
      expect(response.headers["set-cookie"]).toHaveLength(2);

      const row = await customerRow(guest.email);
      expect(row?.password_hash).toMatch(/^\$argon2id\$/);
      expect(row?.email_verified_at).not.toBeNull();
      const [tickets] = await asOwner<{ count: number }>(
        database,
        "SELECT count(*)::int AS count FROM tickets WHERE customer_id = $1",
        [me.customer.id],
      );
      expect(tickets?.count).toBeGreaterThan(0);

      const { response: login } = await signIn(
        app,
        "customer",
        guest.email,
        NEW_PASSWORD,
      );
      expect(login.status).toBe(200);
    });

    it("can't be used twice", async () => {
      const guest = await aGuestWithTickets();
      const { token } = await issueLinkToken(database, {
        purpose: "customer_signup",
        customerId: guest.id,
      });
      await complete(token).expect(200);
      const again = await complete(token, "a different passphrase").expect(400);
      expect(problemDetailsSchema.parse(again.body).type).toBe(
        PROBLEM_TYPES.invalidToken,
      );
    });

    it("never changes the password of an account that already has one", async () => {
      const customerId = await idOf(database, "customers", DEMO.customer);
      const { token } = await issueLinkToken(database, {
        purpose: "customer_signup",
        customerId,
      });
      await complete(token, "an attacker passphrase").expect(400);
      const { response } = await signIn(
        app,
        "customer",
        DEMO.customer,
        DEMO_PASSWORD,
      );
      expect(response.status).toBe(200);
    });

    it.each([
      ["an expired link", { purpose: "customer_signup", validForMinutes: -1 }],
      ["a guest link", { purpose: "guest_ticket_access" }],
    ] as const)("refuses %s", async (_, link) => {
      const guest = await aGuestWithTickets();
      const [ticket] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM tickets WHERE customer_id = $1 LIMIT 1",
        [guest.id],
      );
      const { token } = await issueLinkToken(database, {
        ...link,
        customerId: guest.id,
        ...(link.purpose === "guest_ticket_access"
          ? { ticketId: ticket?.id }
          : {}),
      });
      await complete(token).expect(400);
      expect((await customerRow(guest.email))?.password_hash).toBeNull();
    });

    it("judges the new password by length only", async () => {
      await complete("C".repeat(43), "short").expect(400);
    });
  });

  describe("account pre-hijacking (ADR-0003, section 7)", () => {
    it("gives someone who starts a sign-up for another person's email nothing to use", async () => {
      const victim = await aGuestWithTickets();
      // The attacker can trigger the email, but never sees the link...
      const attempt = await start(victim.email).expect(202);
      expect(attempt.headers["set-cookie"]).toBeUndefined();
      expect(attempt.text).toBe("");
      // ...no password is set, so there is nothing to sign in with...
      expect((await customerRow(victim.email))?.password_hash).toBeNull();
      const { response } = await signIn(
        app,
        "customer",
        victim.email,
        NEW_PASSWORD,
      );
      expect(response.status).toBe(401);
      // ...and a guessed link is just an unknown token.
      await complete("D".repeat(43)).expect(400);
    });
  });
});

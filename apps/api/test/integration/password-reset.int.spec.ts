import type { TestDatabase } from "@dsd/db/testing";
import { customerMeSchema, PROBLEM_TYPES } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  type Credentials,
  DEMO,
  ORIGIN,
  resetRateLimits,
  sessionFor,
  signIn,
} from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newTicket } from "../support/tickets.js";
import { issueLinkToken } from "../support/tokens.js";

const NEW_PASSWORD = "a different long passphrase";

/**
 * Resetting a customer's password from an emailed link (ADR-0003,
 * amended). The worker sends the links; here they are created the way the
 * worker creates them, as its own database role.
 */
describe("password reset", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_password_reset");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
  });

  afterEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const ask = (email: string) =>
    http()
      .post("/api/v1/auth/customer/password-reset/request")
      .set("origin", ORIGIN)
      .send({ email });

  const complete = (token: string, cookie?: string) => {
    const call = http()
      .post("/api/v1/auth/customer/password-reset/complete")
      .set("origin", ORIGIN);
    if (cookie !== undefined) void call.set("cookie", cookie);
    return call.send({ token, password: NEW_PASSWORD });
  };

  const resetEvents = (id: string) =>
    asOwner<{ payload: unknown }>(
      database,
      `SELECT payload FROM outbox_events
        WHERE event_type = 'customer.password_reset_requested' AND aggregate_id = $1`,
      [id],
    );

  const works = async (credentials: Credentials) =>
    (
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", credentials.cookie)
    ).status === 200;

  it("answers 202 whatever the address, and asks the worker only for a known one", async () => {
    const known = await ask("Customer@Example.com");
    const unknown = await ask("nobody-here@example.com");
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.text).toBe(unknown.text);
    expect(await resetEvents(customerId)).toEqual([
      { payload: { customerId } },
    ]);
    const [count] = await asOwner<{ n: number }>(
      database,
      "SELECT count(*)::int AS n FROM outbox_events WHERE event_type = 'customer.password_reset_requested'",
    );
    expect(count?.n).toBe(1);
  });

  it("sets the new password, signs out every other session, guest ones included, and signs this browser in", async () => {
    const [registered] = await asOwner<{ id: string; email: string }>(
      database,
      `SELECT id, email_normalized AS email FROM customers
        WHERE password_hash IS NOT NULL AND email_normalized <> $1 LIMIT 1`,
      [DEMO.customer],
    );
    const id = registered?.id ?? "";
    const elsewhere = await sessionFor(app, {
      kind: "customer",
      customerId: id,
    });
    const guest = await sessionFor(app, {
      kind: "guest",
      customerId: id,
      ticketId: await newTicket(database, { customerId: id }),
    });
    const { token } = await issueLinkToken(database, {
      purpose: "password_reset",
      customerId: id,
    });
    const spare = await issueLinkToken(database, {
      purpose: "password_reset",
      customerId: id,
    });

    const response = await complete(token);
    expect(response.status).toBe(200);
    expect(customerMeSchema.parse(response.body).customer.id).toBe(id);
    expect(await works(elsewhere)).toBe(false);
    expect(await works(guest)).toBe(false);

    const signedIn = await signIn(
      app,
      "customer",
      registered?.email ?? "",
      NEW_PASSWORD,
    );
    expect(signedIn.response.status).toBe(200);

    // The link works once, and the other link sent earlier no longer works.
    expect((await complete(token)).status).toBe(400);
    const second = await complete(spare.token);
    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({ type: PROBLEM_TYPES.invalidToken });
  });

  it("never gives a password to an address that has none", async () => {
    const [guestOnly] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM customers WHERE password_hash IS NULL LIMIT 1",
    );
    const id = guestOnly?.id ?? "";
    const { token } = await issueLinkToken(database, {
      purpose: "password_reset",
      customerId: id,
    });
    const response = await complete(token);
    expect(response.status).toBe(400);
    const [row] = await asOwner<{ password_hash: string | null }>(
      database,
      "SELECT password_hash FROM customers WHERE id = $1",
      [id],
    );
    expect(row?.password_hash).toBeNull();
  });

  it("refuses an expired link, and links made for anything else", async () => {
    const expired = await issueLinkToken(database, {
      purpose: "password_reset",
      customerId,
      validForMinutes: -1,
    });
    expect((await complete(expired.token)).status).toBe(400);
    const signup = await issueLinkToken(database, {
      purpose: "customer_signup",
      customerId,
    });
    expect((await complete(signup.token)).status).toBe(400);
  });

  it("limits requests per address", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push((await ask("limited@example.com")).status);
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});

import { createSeededDatabase, type TestDatabase } from "@dsd/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Worker } from "../../src/lifecycle.js";
import {
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
 * The emails behind links (FR-2; ADR-0003, sections 6 to 9): sign-up,
 * guest access, password reset and agent invites. Each token is created as
 * its email is sent, and only its hash is stored; the tests find the row
 * by hashing the token from the email, exactly as the API does.
 */
describe("emailed links", () => {
  let database: TestDatabase;
  let worker: Worker;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_emailed_links");
    ({ worker } = await startTestWorker(testEnv(database)));
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  const firstEmailTo = (address: string): Promise<Email> =>
    eventually(async () => (await emailsTo(address))[0]);

  /** Waits until every outbox row is dispatched, and then for jobs to finish. */
  const settled = async () => {
    await eventually(async () => {
      const { rows } = await database
        .pool("dsd_migrator")
        .query<{ n: number }>(
          "SELECT count(*)::int AS n FROM outbox_events WHERE dispatched_at IS NULL",
        );
      return rows[0]?.n === 0 ? true : undefined;
    });
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  };

  it("sends a sign-up link that lasts 24 hours to an address without an account", async () => {
    const customer = await fixtures.customer(database);
    await fixtures.event(
      database,
      "customer.signup_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    const email = await firstEmailTo(customer.email);
    expect(email.subject).toBe("Finish creating your DSD account");
    expect(email.text).toContain("http://customer.test/signup/complete#token=");
    const token = await storedToken(database, tokenIn(email));
    expect(token).toMatchObject({
      purpose: "customer_signup",
      customer_id: customer.id,
      agent_id: null,
      ticket_id: null,
    });
    expect(token?.minutes).toBeGreaterThan(24 * 60 - 5);
  });

  it("reminds an address that already has an account to sign in, with no token", async () => {
    const customer = await fixtures.customer(database, { hasAccount: true });
    await fixtures.event(
      database,
      "customer.signup_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    const email = await firstEmailTo(customer.email);
    expect(email.subject).toBe("You already have a DSD account");
    expect(email.text).toContain("http://customer.test/sign-in");
    expect(email.text).not.toContain("#token=");
  });

  it("sends a fresh guest link to a ticket", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    await fixtures.event(
      database,
      "guest_access.requested",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    const email = await firstEmailTo(customer.email);
    expect(email.subject).toBe(
      `[${ticket.reference}] Your link to this ticket`,
    );
    expect(await storedToken(database, tokenIn(email))).toMatchObject({
      purpose: "guest_ticket_access",
      ticket_id: ticket.id,
    });
  });

  it("sends a password reset link that lasts an hour to an account", async () => {
    const customer = await fixtures.customer(database, { hasAccount: true });
    await fixtures.event(
      database,
      "customer.password_reset_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    const email = await firstEmailTo(customer.email);
    expect(email.subject).toBe("Reset your DSD password");
    expect(email.text).toContain("http://customer.test/reset-password#token=");
    const token = await storedToken(database, tokenIn(email));
    expect(token).toMatchObject({
      purpose: "password_reset",
      customer_id: customer.id,
    });
    expect(token?.minutes).toBeGreaterThan(55);
    expect(token?.minutes).toBeLessThanOrEqual(60);
  });

  it("points an address without a password to sign-up instead of resetting", async () => {
    const customer = await fixtures.customer(database);
    await fixtures.event(
      database,
      "customer.password_reset_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    const email = await firstEmailTo(customer.email);
    expect(email.subject).toBe("About your DSD password");
    expect(email.text).toContain("http://customer.test/signup");
    expect(email.text).not.toContain("#token=");
  });

  it("sends an invite that lasts 72 hours to an invited agent, through the agent app", async () => {
    const agent = await fixtures.agent(database, { hasPassword: false });
    await fixtures.event(
      database,
      "agent.invited",
      { type: "agent", id: agent.id },
      { agentId: agent.id },
    );
    const email = await firstEmailTo(agent.email);
    expect(email.subject).toBe("You've been invited to DSD Support");
    expect(email.text).toContain("Hi Sam Agent");
    expect(email.text).toContain("http://agent.test/invite#token=");
    const token = await storedToken(database, tokenIn(email));
    expect(token).toMatchObject({
      purpose: "agent_invite",
      agent_id: agent.id,
    });
    expect(token?.minutes).toBeGreaterThan(72 * 60 - 5);
  });

  it("sends no invite to an agent who has a password or was deactivated", async () => {
    const accepted = await fixtures.agent(database, { hasPassword: true });
    const deactivated = await fixtures.agent(database, {
      hasPassword: false,
      active: false,
    });
    for (const agent of [accepted, deactivated]) {
      await fixtures.event(
        database,
        "agent.invited",
        { type: "agent", id: agent.id },
        { agentId: agent.id },
      );
    }
    await settled();
    expect(await emailsTo(accepted.email)).toEqual([]);
    expect(await emailsTo(deactivated.email)).toEqual([]);
  });

  it("escapes everything it puts in HTML", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    await database
      .pool("dsd_migrator")
      .query("UPDATE brands SET name = $1 WHERE slug = 'dsd'", [
        'DSD <script>alert("x")</script>',
      ]);
    try {
      await fixtures.event(
        database,
        "ticket.created",
        { type: "ticket", id: ticket.id },
        { ticketId: ticket.id, customerId: customer.id },
      );
      const email = await firstEmailTo(customer.email);
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
    } finally {
      await database
        .pool("dsd_migrator")
        .query("UPDATE brands SET name = 'DSD' WHERE slug = 'dsd'");
    }
  });
});

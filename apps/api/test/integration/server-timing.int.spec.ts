import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Credentials,
  DEMO,
  DEMO_PASSWORD,
  ORIGIN,
  sessionFor,
} from "../support/auth.js";
import { createSeededDatabase, idOf, startAppOn } from "../support/database.js";
import { newTicket } from "../support/tickets.js";

const TIMING = /^app;dur=\d+\.\d$/;

/**
 * `Server-Timing` on the three operations NFR-1 budgets for, and nowhere a
 * precise timing could help an attacker (ARCHITECTURE, Observability).
 */
describe("Server-Timing", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let agent: Credentials;
  let customer: Credentials;
  let customerId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_server_timing");
    app = await startAppOn(database);
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
    customerId = await idOf(database, "customers", DEMO.customer);
    customer = await sessionFor(app, { kind: "customer", customerId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const http = () => request(app.getHttpServer());

  it("times loading the queue, opening a ticket and replying", async () => {
    const ticketId = await newTicket(database, { customerId });
    const queue = await http()
      .get("/api/v1/staff/tickets")
      .set("cookie", agent.cookie)
      .expect(200);
    const view = await http()
      .get(`/api/v1/staff/tickets/${ticketId}`)
      .set("cookie", agent.cookie)
      .expect(200);
    const reply = await http()
      .post(`/api/v1/staff/tickets/${ticketId}/replies`)
      .set("origin", ORIGIN)
      .set("cookie", agent.cookie)
      .set("x-csrf-token", agent.csrfToken)
      .field("body", "Thanks, I'm on it.")
      .expect(201);
    for (const response of [queue, view, reply]) {
      expect(response.headers["server-timing"]).toMatch(TIMING);
    }
  });

  it("times a refusal too, so a slow 404 shows up", async () => {
    const response = await http()
      .get("/api/v1/staff/tickets/0199a1b2-0000-7000-8000-000000000999")
      .set("cookie", agent.cookie)
      .expect(404);
    expect(response.headers["server-timing"]).toMatch(TIMING);
  });

  it("isn't sent by sign-in, customer routes or the help centre", async () => {
    const responses = [
      await http()
        .post("/api/v1/auth/staff/login")
        .set("origin", ORIGIN)
        .send({ email: DEMO.agent, password: DEMO_PASSWORD }),
      await http()
        .get("/api/v1/customer/tickets")
        .set("cookie", customer.cookie),
      await http().get("/api/v1/public/kb/articles?q=refund"),
    ];
    for (const response of responses) {
      expect(response.status).toBeLessThan(300);
      expect(response.headers["server-timing"]).toBeUndefined();
    }
  });
});

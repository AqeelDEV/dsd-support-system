import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { staffMeSchema } from "@dsd/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEMO, ORIGIN, signIn } from "../support/auth.js";
import { createSeededDatabase, startAppOn } from "../support/database.js";

/**
 * Any instance can serve any request (NFR-2): sessions live in PostgreSQL
 * and rate-limit counters in Redis, never in process memory.
 */
describe("statelessness", () => {
  let database: TestDatabase;
  let first: NestFastifyApplication;
  let second: NestFastifyApplication;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_stateless");
    // Two instances sharing PostgreSQL and Redis, as behind a load balancer.
    const shared = { REDIS_KEY_PREFIX: `test:stateless:${randomUUID()}:` };
    first = await startAppOn(database, shared);
    second = await startAppOn(database, shared);
  });

  afterAll(async () => {
    await first.close();
    await second.close();
    await database.drop();
  });

  it("serves a session created on one instance from another", async () => {
    const { credentials } = await signIn(first, "staff", DEMO.agent);
    const me = await request(second.getHttpServer())
      .get("/api/v1/auth/staff/me")
      .set("cookie", credentials.cookie)
      .expect(200);
    expect(staffMeSchema.parse(me.body).agent.email).toBe(DEMO.agent);
  });

  it("accepts one instance's CSRF token on another, and sees its sign-out", async () => {
    const { credentials } = await signIn(first, "customer", DEMO.customer);
    await request(second.getHttpServer())
      .post("/api/v1/auth/customer/logout")
      .set("origin", ORIGIN)
      .set("cookie", credentials.cookie)
      .set("x-csrf-token", credentials.csrfToken)
      .expect(204);
    await request(first.getHttpServer())
      .get("/api/v1/auth/customer/me")
      .set("cookie", credentials.cookie)
      .expect(401);
  });

  it("shares rate limits, so spreading attempts across instances doesn't help", async () => {
    const email = "spread.out@example.com";
    const attempt = (app: NestFastifyApplication) =>
      request(app.getHttpServer())
        .post("/api/v1/auth/customer/login")
        .set("origin", ORIGIN)
        .send({ email, password: "wrong password" });
    for (let i = 0; i < 5; i += 1) {
      await attempt(i % 2 === 0 ? first : second).expect(401);
    }
    await attempt(first).expect(429);
    await attempt(second).expect(429);
  });
});

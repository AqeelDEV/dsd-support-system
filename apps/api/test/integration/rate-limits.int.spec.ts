import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PROBLEM_TYPES, problemDetailsSchema } from "@dsd/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO,
  DEMO_PASSWORD,
  ORIGIN,
  resetRateLimits,
} from "../support/auth.js";
import { closedPort } from "../support/app.js";
import { createSeededDatabase, startAppOn } from "../support/database.js";

/** One sign-in attempt, optionally claiming to come through a proxy for `forwardedFor`. */
function attempt(
  app: NestFastifyApplication,
  realm: "customer" | "staff",
  email: string,
  options: { password?: string; forwardedFor?: string } = {},
) {
  const call = request(app.getHttpServer())
    .post(`/api/v1/auth/${realm}/login`)
    .set("origin", ORIGIN);
  if (options.forwardedFor !== undefined) {
    void call.set("x-forwarded-for", options.forwardedFor);
  }
  return call.send({ email, password: options.password ?? "wrong password" });
}

/** Rate limits on sign-in (ADR-0003, section 10; NFR-9). */
describe("sign-in rate limits", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_rate_limits");
  });

  afterAll(async () => {
    await database.drop();
  });

  describe("with clients connecting directly", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startAppOn(database);
    });

    afterEach(async () => {
      await resetRateLimits(app);
    });

    afterAll(async () => {
      await app.close();
    });

    it("allows 5 attempts per email in 15 minutes, then answers 429 even to the right password", async () => {
      for (let i = 0; i < 5; i += 1) {
        await attempt(app, "customer", DEMO.customer).expect(401);
      }
      const limited = await attempt(app, "customer", DEMO.customer, {
        password: DEMO_PASSWORD,
      }).expect(429);
      expect(problemDetailsSchema.parse(limited.body).type).toBe(
        PROBLEM_TYPES.rateLimited,
      );
      const retryAfter = Number(limited.headers["retry-after"]);
      expect(retryAfter).toBeGreaterThan(800);
      expect(retryAfter).toBeLessThanOrEqual(900);
    });

    it("counts an email however it is written", async () => {
      for (let i = 0; i < 5; i += 1) {
        await attempt(
          app,
          "customer",
          i % 2 === 0 ? "Ana@Example.com" : "ana@example.COM",
        ).expect(401);
      }
      await attempt(app, "customer", "ANA@EXAMPLE.COM").expect(429);
    });

    it("allows 20 attempts per IP in 15 minutes, whatever the emails", async () => {
      for (let i = 0; i < 20; i += 1) {
        await attempt(app, "customer", `person${i}@example.com`).expect(401);
      }
      await attempt(app, "customer", "someone.new@example.com").expect(429);
    });

    it("counts customer and staff sign-in separately", async () => {
      for (let i = 0; i < 5; i += 1) {
        await attempt(app, "staff", DEMO.agent).expect(401);
      }
      await attempt(app, "staff", DEMO.agent).expect(429);
      await attempt(app, "customer", DEMO.agent).expect(401);
    });

    it("ignores X-Forwarded-For from a client that isn't a trusted proxy", async () => {
      for (let i = 0; i < 20; i += 1) {
        await attempt(app, "customer", `spoof${i}@example.com`, {
          forwardedFor: `203.0.113.${i}`,
        }).expect(401);
      }
      await attempt(app, "customer", "spoof.more@example.com", {
        forwardedFor: "203.0.113.200",
      }).expect(429);
    });
  });

  describe("behind a trusted proxy", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startAppOn(database, { TRUST_PROXY: "127.0.0.1,::1" });
    });

    afterAll(async () => {
      await app.close();
    });

    it("counts each forwarded client separately", async () => {
      for (let i = 0; i < 20; i += 1) {
        await attempt(app, "customer", `client${i}@example.com`, {
          forwardedFor: "198.51.100.1",
        }).expect(401);
      }
      await attempt(app, "customer", "client.more@example.com", {
        forwardedFor: "198.51.100.1",
      }).expect(429);
      await attempt(app, "customer", "client.other@example.com", {
        forwardedFor: "198.51.100.2",
      }).expect(401);
    });
  });

  describe("when Redis is down", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startAppOn(database, {
        REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(["customer", "staff"] as const)(
      "refuses %s sign-in with 503 rather than allow unlimited guessing",
      async (realm) => {
        const response = await attempt(app, realm, DEMO.customer, {
          password: DEMO_PASSWORD,
        }).expect(503);
        expect(response.headers["retry-after"]).toBeDefined();
      },
    );
  });
});

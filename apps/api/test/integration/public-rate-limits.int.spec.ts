import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PROBLEM_TYPES, problemDetailsSchema } from "@dsd/shared";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { RATE_LIMITS } from "../../src/auth/rate-limit/policies.js";
import {
  type Credentials,
  DEMO,
  ORIGIN,
  resetRateLimits,
  sessionFor,
} from "../support/auth.js";
import { closedPort } from "../support/app.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newTicket } from "../support/tickets.js";

const SEARCH_MAX = RATE_LIMITS.kbArticles.limits[0].max;
const REPLY_MAX = RATE_LIMITS.customerReply.limits[0].max;

/** One help-centre search, optionally claiming to come through a proxy for `forwardedFor`. */
function search(app: NestFastifyApplication, forwardedFor?: string) {
  const call = request(app.getHttpServer()).get(
    "/api/v1/public/kb/articles?q=refund",
  );
  if (forwardedFor !== undefined) {
    void call.set("x-forwarded-for", forwardedFor);
  }
  return call;
}

/** Searches `times` times as `forwardedFor`, each answered 200. */
async function searchUpTo(
  app: NestFastifyApplication,
  times: number,
  forwardedFor?: string,
): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await search(app, forwardedFor).expect(200);
  }
}

function expectRateLimited(response: request.Response): void {
  expect(response.status).toBe(429);
  expect(Number(response.headers["retry-after"])).toBeGreaterThan(0);
  expect(problemDetailsSchema.parse(response.body).type).toBe(
    PROBLEM_TYPES.rateLimited,
  );
}

/**
 * Limits on the help centre's search and on customers' replies (ADR-0003,
 * amended in Phase 10). Per-address limits count the browser's address,
 * which behind the web apps arrives in X-Forwarded-For from a trusted
 * proxy (ADR-0010), and never a forged one.
 */
describe("help-centre and reply rate limits", () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_public_rate_limits");
  });

  afterAll(async () => {
    await database.drop();
  });

  describe("help-centre search, with clients connecting directly", () => {
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

    it(`allows ${String(SEARCH_MAX)} a minute from one address, then answers 429 with Retry-After`, async () => {
      await searchUpTo(app, SEARCH_MAX);
      expectRateLimited(await search(app));
    });

    it("doesn't limit reading a single article", async () => {
      await searchUpTo(app, SEARCH_MAX);
      await request(app.getHttpServer())
        .get("/api/v1/public/kb/articles/refund-timescales")
        .expect(200);
    });

    it("counts the connecting address when X-Forwarded-For comes from a client that isn't a trusted proxy", async () => {
      for (let i = 0; i < SEARCH_MAX; i += 1) {
        await search(app, `203.0.113.${String(i % 250)}`).expect(200);
      }
      expectRateLimited(await search(app, "203.0.113.251"));
    });
  });

  describe("help-centre search, behind a trusted proxy", () => {
    let app: NestFastifyApplication;

    beforeAll(async () => {
      app = await startAppOn(database, { TRUST_PROXY: "127.0.0.1,::1" });
    });

    afterEach(async () => {
      await resetRateLimits(app);
    });

    afterAll(async () => {
      await app.close();
    });

    it("counts each browser's forwarded address, not the proxy's own", async () => {
      await searchUpTo(app, SEARCH_MAX, "198.51.100.1");
      expectRateLimited(await search(app, "198.51.100.1"));
      await search(app, "198.51.100.2").expect(200);
      await search(app).expect(200);
    });

    it("counts the address the trusted proxy saw, not one the browser claims", async () => {
      // The browser sends its own X-Forwarded-For; the proxy appends the
      // address it really saw. Only the last untrusted hop counts.
      await searchUpTo(app, SEARCH_MAX, "203.0.113.7, 198.51.100.9");
      expectRateLimited(await search(app, "203.0.113.8, 198.51.100.9"));
    });
  });

  describe("customers' replies", () => {
    let app: NestFastifyApplication;
    let customerId: string;
    let customer: Credentials;
    let otherCustomerId: string;
    let otherCustomer: Credentials;

    beforeAll(async () => {
      app = await startAppOn(database);
      customerId = await idOf(database, "customers", DEMO.customer);
      customer = await sessionFor(app, { kind: "customer", customerId });
      const [other] = await asOwner<{ id: string }>(
        database,
        "SELECT id FROM customers WHERE id <> $1 AND password_hash IS NOT NULL ORDER BY email LIMIT 1",
        [customerId],
      );
      if (other === undefined) throw new Error("the seed has one customer");
      otherCustomerId = other.id;
      otherCustomer = await sessionFor(app, {
        kind: "customer",
        customerId: otherCustomerId,
      });
    });

    afterEach(async () => {
      await resetRateLimits(app);
    });

    afterAll(async () => {
      await app.close();
    });

    const reply = (ticketId: string, caller: Credentials) =>
      request(app.getHttpServer())
        .post(`/api/v1/customer/tickets/${ticketId}/messages`)
        .set("origin", ORIGIN)
        .set("cookie", caller.cookie)
        .set("x-csrf-token", caller.csrfToken)
        .field("body", "One more detail about my problem.");

    it(`allows ${String(REPLY_MAX)} replies in 10 minutes per customer, across tickets, then answers 429`, async () => {
      const first = await newTicket(database, { customerId });
      const second = await newTicket(database, { customerId });
      for (let i = 0; i < REPLY_MAX; i += 1) {
        await reply(i % 2 === 0 ? first : second, customer).expect(201);
      }
      expectRateLimited(await reply(first, customer));
    });

    it("counts each customer separately", async () => {
      const mine = await newTicket(database, { customerId });
      for (let i = 0; i < REPLY_MAX; i += 1) {
        await reply(mine, customer).expect(201);
      }
      expectRateLimited(await reply(mine, customer));
      const theirs = await newTicket(database, {
        customerId: otherCustomerId,
      });
      await reply(theirs, otherCustomer).expect(201);
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

    it("still answers searches and takes customers' replies", async () => {
      await search(app).expect(200);
      const customerId = await idOf(database, "customers", DEMO.customer);
      const ticketId = await newTicket(database, { customerId });
      const caller = await sessionFor(app, { kind: "customer", customerId });
      await request(app.getHttpServer())
        .post(`/api/v1/customer/tickets/${ticketId}/messages`)
        .set("origin", ORIGIN)
        .set("cookie", caller.cookie)
        .set("x-csrf-token", caller.csrfToken)
        .field("body", "Still here while Redis is away.")
        .expect(201);
    });
  });
});

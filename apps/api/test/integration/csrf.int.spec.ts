import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { PROBLEM_TYPES, problemDetailsSchema } from "@dsd/shared";
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

const LOGIN = { email: DEMO.customer, password: DEMO_PASSWORD };

/**
 * CSRF protection (ADR-0003, section 5): unsafe requests must come from a
 * trusted origin, and cookie-authenticated ones must carry their session's
 * token.
 */
describe("CSRF protection", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());
  const customer = async (): Promise<Credentials> =>
    sessionFor(app, {
      kind: "customer",
      customerId: await idOf(database, "customers", DEMO.customer),
    });

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_csrf");
    app = await startAppOn(database);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe("before sign-in (login CSRF)", () => {
    it.each([
      ["another site's Origin", { origin: "https://attacker.example" }],
      ["no Origin and no same-origin claim", {}],
      ["a cross-site fetch", { "sec-fetch-site": "cross-site" }],
    ])("refuses a sign-in with %s", async (_, headers) => {
      const response = await http()
        .post("/api/v1/auth/customer/login")
        .set(headers)
        .send(LOGIN)
        .expect(403);
      expect(problemDetailsSchema.parse(response.body).type).toBe(
        PROBLEM_TYPES.csrfRejected,
      );
      expect(response.headers["set-cookie"]).toBeUndefined();
    });

    it("accepts a sign-in from a trusted origin", async () => {
      await http()
        .post("/api/v1/auth/customer/login")
        .set("origin", ORIGIN)
        .send(LOGIN)
        .expect(200);
    });

    it("accepts a same-origin sign-in whose browser sent no Origin", async () => {
      await http()
        .post("/api/v1/auth/staff/login")
        .set("sec-fetch-site", "same-origin")
        .send({ email: DEMO.agent, password: DEMO_PASSWORD })
        .expect(200);
    });
  });

  describe("signed in", () => {
    it("refuses a sign-out without the CSRF header", async () => {
      const { cookie } = await customer();
      const response = await http()
        .post("/api/v1/auth/customer/logout")
        .set("origin", ORIGIN)
        .set("cookie", cookie)
        .expect(403);
      expect(problemDetailsSchema.parse(response.body).type).toBe(
        PROBLEM_TYPES.csrfRejected,
      );
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", cookie)
        .expect(200);
    });

    it("refuses another session's CSRF token", async () => {
      const victim = await customer();
      const attacker = await customer();
      await http()
        .post("/api/v1/auth/customer/logout")
        .set("origin", ORIGIN)
        .set("cookie", victim.cookie)
        .set("x-csrf-token", attacker.csrfToken)
        .expect(403);
    });

    it("refuses the right token from the wrong origin", async () => {
      const { cookie, csrfToken } = await customer();
      await http()
        .post("/api/v1/auth/customer/logout")
        .set("origin", "https://attacker.example")
        .set("cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .expect(403);
    });

    it("accepts the session's own token from a trusted origin", async () => {
      const { cookie, csrfToken } = await customer();
      await http()
        .post("/api/v1/auth/customer/logout")
        .set("origin", ORIGIN)
        .set("cookie", cookie)
        .set("x-csrf-token", csrfToken)
        .expect(204);
    });

    it("doesn't ask for a token to read", async () => {
      const { cookie } = await customer();
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", cookie)
        .expect(200);
    });

    it("answers 401, not 403, when there is no session at all", async () => {
      await http()
        .post("/api/v1/auth/customer/logout")
        .set("origin", "https://attacker.example")
        .expect(401);
    });
  });
});

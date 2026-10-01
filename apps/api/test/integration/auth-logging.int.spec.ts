import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { captureLogs, eventually } from "../support/app.js";
import { DEMO, DEMO_PASSWORD, ORIGIN, signIn } from "../support/auth.js";
import { createSeededDatabase, idOf, startAppOn } from "../support/database.js";
import { issueLinkToken } from "../support/tokens.js";

/**
 * Credentials are never logged (NFR-5; ADR-0003, section 3): every auth
 * flow runs with logging on, then the captured output is searched for
 * every secret that went over the wire.
 */
describe("auth logging", () => {
  const logs = captureLogs();
  let database: TestDatabase;
  let app: NestFastifyApplication;
  const secrets: string[] = [];

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_auth_logging");
    app = await startAppOn(
      database,
      { LOG_LEVEL: "info" },
      { logDestination: logs.stream },
    );
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("keeps passwords, tokens, cookies and emails out of the logs", async () => {
    const http = () => request(app.getHttpServer());

    // A failed and a successful sign-in, then the session in use.
    const wrong = "WRONG-PASSWORD-SECRET";
    await signIn(app, "customer", DEMO.customer, wrong);
    const { credentials } = await signIn(app, "staff", DEMO.supervisor);
    secrets.push(
      wrong,
      DEMO_PASSWORD,
      credentials.token,
      credentials.csrfToken,
    );
    await http()
      .get("/api/v1/auth/staff/me")
      .set("cookie", credentials.cookie)
      .expect(200);
    await http()
      .post("/api/v1/auth/staff/logout")
      .set("origin", ORIGIN)
      .set("cookie", credentials.cookie)
      .set("x-csrf-token", credentials.csrfToken)
      .expect(204);

    // Sign-up and its emailed link, with a new password.
    const email = "log.watcher@example.com";
    secrets.push(email);
    await http()
      .post("/api/v1/auth/customer/signup")
      .set("origin", ORIGIN)
      .send({ email })
      .expect(202);
    const signupLink = await issueLinkToken(database, {
      purpose: "customer_signup",
      customerId: await idOf(database, "customers", email),
    });
    const newPassword = "NEW-PASSWORD-SECRET-PHRASE";
    secrets.push(signupLink.token, newPassword);
    await http()
      .post("/api/v1/auth/customer/signup/complete")
      .set("origin", ORIGIN)
      .send({
        token: signupLink.token,
        displayName: "Log Watcher",
        password: newPassword,
      })
      .expect(200);

    // A guest link, used and refused.
    const guestLink = "G".repeat(43);
    secrets.push(guestLink);
    await http()
      .post("/api/v1/auth/customer/guest-access/exchange")
      .set("origin", ORIGIN)
      .send({ token: guestLink })
      .expect(400);

    await eventually(() => {
      expect(
        logs.records().filter((record) => record.req !== undefined).length,
      ).toBeGreaterThanOrEqual(7);
    });
    const text = logs.text();
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toContain(DEMO.customer);
    expect(text).not.toContain(DEMO.supervisor);
  });

  it("records a failed sign-in with its realm and address only", () => {
    const failure = logs
      .records()
      .find((record) => record.msg === "Sign-in failed");
    expect(failure).toMatchObject({ realm: "customer" });
    expect(failure).toHaveProperty("ip");
    expect(JSON.stringify(failure)).not.toMatch(/@|PASSWORD/);
  });
});

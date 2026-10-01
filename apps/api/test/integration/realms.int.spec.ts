import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  customerMeSchema,
  permissionsFor,
  problemDetailsSchema,
  staffMeSchema,
} from "@dsd/shared";
import { hash } from "@node-rs/argon2";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  DEMO,
  DEMO_PASSWORD,
  ORIGIN,
  resetRateLimits,
  sessionCookie,
  sessionFor,
  signIn,
} from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";

const INCORRECT = "The email or password is incorrect.";

/**
 * Sign-in, sign-out and the realm boundary (ADR-0003, FR-17), through the
 * real HTTP pipeline against seeded PostgreSQL and real Redis.
 */
describe("customer and staff realms", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_realms");
    app = await startAppOn(database);
  });

  afterEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  describe("customer sign-in", () => {
    it("starts a session in secure cookies and returns who signed in", async () => {
      const { response, setCookies, credentials } = await signIn(
        app,
        "customer",
        DEMO.customer,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        customer: { email: DEMO.customer },
        guestTicketId: null,
        csrfToken: credentials.csrfToken,
      });

      const session = setCookies.find((cookie) =>
        cookie.startsWith("__Host-dsd_customer_session="),
      );
      expect(session).toMatch(/; HttpOnly/);
      expect(session).toMatch(/; Secure/);
      expect(session).toMatch(/; SameSite=Lax/);
      expect(session).toMatch(/; Path=\//);
      expect(session).not.toMatch(/Domain=/i);
      const csrf = setCookies.find((cookie) =>
        cookie.startsWith("__Host-dsd_customer_csrf="),
      );
      expect(csrf).toMatch(/; Secure/);
      expect(csrf).not.toMatch(/HttpOnly/);
    });

    it("records the session's client and the sign-in time", async () => {
      const customerId = await idOf(database, "customers", DEMO.customer);
      await signIn(app, "customer", DEMO.customer);
      const [row] = await asOwner<{ user_agent: string; recent: boolean }>(
        database,
        `SELECT s.user_agent, c.last_login_at > now() - interval '1 minute' AS recent
           FROM sessions s JOIN customers c ON c.id = s.customer_id
          WHERE s.customer_id = $1 ORDER BY s.created_at DESC LIMIT 1`,
        [customerId],
      );
      expect(row).toEqual({ user_agent: "vitest-browser", recent: true });
    });

    it("accepts the email in any letter case", async () => {
      const { response } = await signIn(
        app,
        "customer",
        DEMO.customer.toUpperCase(),
      );
      expect(response.status).toBe(200);
    });

    it.each([
      ["a wrong password", DEMO.customer, "not the right password"],
      ["an unknown email", "nobody@example.com", DEMO_PASSWORD],
    ])("refuses %s with the same 401", async (_, email, password) => {
      const { response, setCookies } = await signIn(
        app,
        "customer",
        email,
        password,
      );
      expect(response.status).toBe(401);
      expect(problemDetailsSchema.parse(response.body).detail).toBe(INCORRECT);
      expect(setCookies).toEqual([]);
    });

    it("refuses a guest, who has no password, with the same 401", async () => {
      const [guest] = await asOwner<{ email: string }>(
        database,
        "SELECT email FROM customers WHERE password_hash IS NULL LIMIT 1",
      );
      const { response } = await signIn(app, "customer", guest?.email ?? "");
      expect(response.status).toBe(401);
      expect(problemDetailsSchema.parse(response.body).detail).toBe(INCORRECT);
    });

    it("revokes the browser's previous session when it signs in again", async () => {
      const first = await signIn(app, "customer", DEMO.customer);
      const second = await http()
        .post("/api/v1/auth/customer/login")
        .set("origin", ORIGIN)
        .set("cookie", first.credentials.cookie)
        .send({ email: DEMO.customer, password: DEMO_PASSWORD })
        .expect(200);
      expect(customerMeSchema.parse(second.body).csrfToken).not.toBe(
        first.credentials.csrfToken,
      );
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", first.credentials.cookie)
        .expect(401);
    });

    it("upgrades a hash made with outdated parameters at sign-in", async () => {
      const email = "upgrade.me@example.com";
      const older = await hash(DEMO_PASSWORD, {
        memoryCost: 8192,
        timeCost: 1,
        parallelism: 1,
      });
      await asOwner(
        database,
        `INSERT INTO customers (email, email_normalized, password_hash, email_verified_at)
         VALUES ($1, $1, $2, now())`,
        [email, older],
      );
      await signIn(app, "customer", email).then(({ response }) => {
        expect(response.status).toBe(200);
      });
      const [row] = await asOwner<{ password_hash: string }>(
        database,
        "SELECT password_hash FROM customers WHERE email_normalized = $1",
        [email],
      );
      expect(row?.password_hash).toMatch(
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/,
      );
      await signIn(app, "customer", email).then(({ response }) => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe("staff sign-in", () => {
    it.each(["agent", "supervisor", "admin"] as const)(
      "signs in the %s with their role's permissions",
      async (role) => {
        const { response } = await signIn(app, "staff", DEMO[role]);
        expect(response.status).toBe(200);
        expect(staffMeSchema.parse(response.body).agent).toMatchObject({
          email: DEMO[role],
          role,
        });
        expect(staffMeSchema.parse(response.body).permissions).toEqual([
          ...permissionsFor(role),
        ]);
      },
    );

    it.each([
      ["a deactivated agent", DEMO.formerAgent],
      ["an agent who hasn't accepted their invite", DEMO.invitedAgent],
      ["a customer's email", DEMO.customer],
    ])("refuses %s with the same 401", async (_, email) => {
      const { response } = await signIn(app, "staff", email);
      expect(response.status).toBe(401);
      expect(problemDetailsSchema.parse(response.body).detail).toBe(INCORRECT);
    });
  });

  describe("me and sign-out", () => {
    it.each(["customer", "staff"] as const)(
      "answers %s me only with a session",
      async (realm) => {
        await http().get(`/api/v1/auth/${realm}/me`).expect(401);
        const credentials =
          realm === "customer"
            ? await sessionFor(app, {
                kind: "customer",
                customerId: await idOf(database, "customers", DEMO.customer),
              })
            : await sessionFor(app, {
                kind: "staff",
                agentId: await idOf(database, "agents", DEMO.agent),
              });
        const me = await http()
          .get(`/api/v1/auth/${realm}/me`)
          .set("cookie", credentials.cookie)
          .expect(200);
        expect((me.body as { csrfToken: string }).csrfToken).toBe(
          credentials.csrfToken,
        );
      },
    );

    it.each(["customer", "staff"] as const)(
      "signs a %s out: the session is revoked and its cookies cleared",
      async (realm) => {
        const email = realm === "customer" ? DEMO.customer : DEMO.supervisor;
        const { credentials } = await signIn(app, realm, email);
        const response = await http()
          .post(`/api/v1/auth/${realm}/logout`)
          .set("origin", ORIGIN)
          .set("cookie", credentials.cookie)
          .set("x-csrf-token", credentials.csrfToken)
          .expect(204);
        const cleared = ([] as string[]).concat(
          response.headers["set-cookie"] ?? [],
        );
        expect(cleared).toHaveLength(2);
        for (const cookie of cleared) {
          expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
        }
        await http()
          .get(`/api/v1/auth/${realm}/me`)
          .set("cookie", credentials.cookie)
          .expect(401);
      },
    );
  });

  describe("the realm boundary", () => {
    it("refuses a customer token placed in the staff cookie", async () => {
      const customer = await sessionFor(app, {
        kind: "customer",
        customerId: await idOf(database, "customers", DEMO.customer),
      });
      await http()
        .get("/api/v1/auth/staff/me")
        .set("cookie", sessionCookie(app, "staff", customer.token))
        .expect(401);
    });

    it("refuses a staff token placed in the customer cookie", async () => {
      const staff = await sessionFor(app, {
        kind: "staff",
        agentId: await idOf(database, "agents", DEMO.admin),
      });
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", sessionCookie(app, "customer", staff.token))
        .expect(401);
    });

    it("never reads the other realm's cookie", async () => {
      const staff = await sessionFor(app, {
        kind: "staff",
        agentId: await idOf(database, "agents", DEMO.admin),
      });
      await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", staff.cookie)
        .expect(401);
    });

    it("serves each realm from its own cookie when a browser holds both", async () => {
      const customer = await sessionFor(app, {
        kind: "customer",
        customerId: await idOf(database, "customers", DEMO.customer),
      });
      const staff = await sessionFor(app, {
        kind: "staff",
        agentId: await idOf(database, "agents", DEMO.agent),
      });
      const both = `${customer.cookie}; ${staff.cookie}`;
      const asCustomer = await http()
        .get("/api/v1/auth/customer/me")
        .set("cookie", both)
        .expect(200);
      expect(customerMeSchema.parse(asCustomer.body).customer.email).toBe(
        DEMO.customer,
      );
      const asStaff = await http()
        .get("/api/v1/auth/staff/me")
        .set("cookie", both)
        .expect(200);
      expect(staffMeSchema.parse(asStaff.body).agent.email).toBe(DEMO.agent);
    });

    it("refuses a deactivated agent's existing session on the next request", async () => {
      // One of the seeded working agents, not a demo account.
      const [row] = await asOwner<{ id: string }>(
        database,
        `SELECT id FROM agents WHERE role = 'agent' AND deactivated_at IS NULL
            AND password_hash IS NOT NULL AND email_normalized <> $1 LIMIT 1`,
        [DEMO.agent],
      );
      const agentId = row?.id ?? "";
      const staff = await sessionFor(app, { kind: "staff", agentId });
      await http()
        .get("/api/v1/auth/staff/me")
        .set("cookie", staff.cookie)
        .expect(200);
      await asOwner(
        database,
        "UPDATE agents SET deactivated_at = now() WHERE id = $1",
        [agentId],
      );
      await http()
        .get("/api/v1/auth/staff/me")
        .set("cookie", staff.cookie)
        .expect(401);
    });
  });
});

describe("cookies on a local stack (COOKIE_SECURE=false)", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_local_cookies");
    app = await startAppOn(database, {
      TRUSTED_ORIGINS: "http://localhost:3000",
      COOKIE_SECURE: "false",
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("drops Secure and the __Host- prefix, which browsers refuse on http://localhost", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/customer/login")
      .set("origin", "http://localhost:3000")
      .send({ email: DEMO.customer, password: DEMO_PASSWORD })
      .expect(200);
    const cookies = ([] as string[]).concat(
      response.headers["set-cookie"] ?? [],
    );
    expect(cookies.map((cookie) => cookie.split("=")[0])).toEqual([
      "dsd_customer_session",
      "dsd_customer_csrf",
    ]);
    for (const cookie of cookies) expect(cookie).not.toMatch(/Secure/);
    expect(cookies[0]).toMatch(/HttpOnly; SameSite=Lax/);

    const session = cookies[0]?.split(";")[0] ?? "";
    await request(app.getHttpServer())
      .get("/api/v1/auth/customer/me")
      .set("cookie", session)
      .expect(200);
  });
});

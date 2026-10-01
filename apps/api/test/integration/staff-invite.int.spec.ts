import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  PROBLEM_TYPES,
  permissionsFor,
  problemDetailsSchema,
  staffMeSchema,
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

const PASSWORD = "my first staff passphrase";

/** Invited agents set their own password (ADR-0003, section 8). */
describe("accepting a staff invite", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let invited = 0;

  const accept = (token: string, password = PASSWORD) =>
    request(app.getHttpServer())
      .post("/api/v1/auth/staff/invite/complete")
      .set("origin", ORIGIN)
      .send({ token, password });

  /** A freshly invited agent, as Phase 5's agent management will create one. */
  const inviteAgent = async (role = "agent", deactivated = false) => {
    invited += 1;
    const email = `invited.${invited}@dsd.example`;
    const [row] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO agents (email, email_normalized, display_name, role, deactivated_at)
       VALUES ($1, $1, 'Invited Agent', $2, CASE WHEN $3 THEN now() END) RETURNING id`,
      [email, role, deactivated],
    );
    const agentId = row?.id ?? "";
    const { token } = await issueLinkToken(database, {
      purpose: "agent_invite",
      agentId,
    });
    return { agentId, email, token };
  };

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_staff_invite");
    app = await startAppOn(database);
  });

  afterEach(async () => {
    await resetRateLimits(app);
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  it("sets the first password and signs the agent in with their role's permissions", async () => {
    const agentId = await idOf(database, "agents", DEMO.invitedAgent);
    const { token } = await issueLinkToken(database, {
      purpose: "agent_invite",
      agentId,
    });
    const response = await accept(token).expect(200);
    const me = staffMeSchema.parse(response.body);
    expect(me.agent).toMatchObject({ id: agentId, email: DEMO.invitedAgent });
    expect(me.permissions).toEqual([...permissionsFor(me.agent.role)]);
    expect(response.headers["set-cookie"]).toHaveLength(2);

    const { response: login } = await signIn(
      app,
      "staff",
      DEMO.invitedAgent,
      PASSWORD,
    );
    expect(login.status).toBe(200);
  });

  it("gives a supervisor invite a supervisor's permissions", async () => {
    const { token } = await inviteAgent("supervisor");
    const me = staffMeSchema.parse((await accept(token).expect(200)).body);
    expect(me.permissions).toContain("user:manage");
  });

  it("can't be used twice", async () => {
    const { token } = await inviteAgent();
    await accept(token).expect(200);
    const again = await accept(token, "another passphrase here").expect(400);
    expect(problemDetailsSchema.parse(again.body).type).toBe(
      PROBLEM_TYPES.invalidToken,
    );
  });

  it("can't revive a deactivated agent", async () => {
    const { token, email } = await inviteAgent("agent", true);
    await accept(token).expect(400);
    const { response } = await signIn(app, "staff", email, PASSWORD);
    expect(response.status).toBe(401);
  });

  it("can't reset the password of an agent who already has one", async () => {
    const agentId = await idOf(database, "agents", DEMO.admin);
    const { token } = await issueLinkToken(database, {
      purpose: "agent_invite",
      agentId,
    });
    await accept(token, "an attacker passphrase").expect(400);
    const { response } = await signIn(app, "staff", DEMO.admin, DEMO_PASSWORD);
    expect(response.status).toBe(200);
  });

  it("refuses an expired invite", async () => {
    const { agentId } = await inviteAgent();
    const { token } = await issueLinkToken(database, {
      purpose: "agent_invite",
      agentId,
      validForMinutes: -1,
    });
    await accept(token).expect(400);
  });

  it("refuses a customer's sign-up link", async () => {
    const customerId = await idOf(database, "customers", DEMO.customer);
    const { token } = await issueLinkToken(database, {
      purpose: "customer_signup",
      customerId,
    });
    await accept(token).expect(400);
  });

  it("judges the new password by length only", async () => {
    const { token } = await inviteAgent();
    await accept(token, "too short").expect(400);
    await accept(token).expect(200);
  });
});

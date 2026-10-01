import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { permissionsFor } from "@dsd/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SessionService,
  type SessionSubject,
} from "../../src/auth/sessions/session.service.js";
import { hashToken } from "../../src/auth/tokens.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";

const CLIENT = { ip: "203.0.113.7", userAgent: "vitest" };

describe("session store (ADR-0003)", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let sessions: SessionService;
  let agentId: string;
  let customerId: string;
  let ticketId: string;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_sessions");
    app = await startAppOn(database);
    sessions = app.get(SessionService);
    agentId = await idOf(database, "agents", "agent@dsd.example");
    customerId = await idOf(database, "customers", "customer@example.com");
    const [ticket] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM tickets WHERE customer_id = $1 LIMIT 1",
      [customerId],
    );
    ticketId = ticket?.id ?? "";
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const row = async (id: string) => {
    const [found] = await asOwner<{
      token_hash: Buffer;
      ip: string | null;
      user_agent: string | null;
      max_age: number;
      idle: number;
    }>(
      database,
      `SELECT token_hash, host(ip) AS ip, user_agent,
              extract(epoch FROM expires_at - created_at)::int AS max_age,
              extract(epoch FROM idle_expires_at - created_at)::int AS idle
         FROM sessions WHERE id = $1`,
      [id],
    );
    if (found === undefined) throw new Error("session row missing");
    return found;
  };

  it("stores only the token's hash, with the client's address", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    const stored = await row(issued.id);
    expect(stored.token_hash).toEqual(hashToken(issued.token));
    expect(stored.token_hash.toString("base64url")).not.toBe(issued.token);
    expect(stored).toMatchObject({ ip: "203.0.113.7", user_agent: "vitest" });
  });

  it.each([
    ["staff", 12 * 3600, 2 * 3600],
    ["customer", 30 * 86_400, 7 * 86_400],
    ["guest", 86_400, 86_400],
  ] as const)(
    "gives a %s session its lifetimes",
    async (kind, maxAge, idle) => {
      const subjects: Record<typeof kind, SessionSubject> = {
        staff: { kind: "staff", agentId },
        customer: { kind: "customer", customerId },
        guest: { kind: "guest", customerId, ticketId },
      };
      const issued = await sessions.create(subjects[kind], CLIENT);
      expect(await row(issued.id)).toMatchObject({ max_age: maxAge, idle });
    },
  );

  it("resolves a staff session with the agent's current permissions", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    const principal = await sessions.resolve("staff", issued.token);
    expect(principal).toMatchObject({
      realm: "staff",
      sessionId: issued.id,
      agent: { id: agentId, email: "agent@dsd.example", role: "agent" },
    });
    expect(
      principal?.realm === "staff" ? [...principal.permissions] : [],
    ).toEqual([...permissionsFor("agent")]);
  });

  it("resolves a guest session to its one ticket", async () => {
    const issued = await sessions.create(
      { kind: "guest", customerId, ticketId },
      CLIENT,
    );
    expect(await sessions.resolve("customer", issued.token)).toMatchObject({
      realm: "customer",
      customer: { id: customerId },
      guestTicketId: ticketId,
    });
  });

  it("refuses a session from the other realm", async () => {
    const staff = await sessions.create({ kind: "staff", agentId }, CLIENT);
    const customer = await sessions.create(
      { kind: "customer", customerId },
      CLIENT,
    );
    expect(await sessions.resolve("customer", staff.token)).toBeNull();
    expect(await sessions.resolve("staff", customer.token)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await sessions.resolve("staff", "A".repeat(43))).toBeNull();
  });

  it("refuses a revoked session", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    await sessions.revoke(issued.id);
    expect(await sessions.resolve("staff", issued.token)).toBeNull();
  });

  it("refuses a session revoked through its token", async () => {
    const issued = await sessions.create(
      { kind: "customer", customerId },
      CLIENT,
    );
    await sessions.revokeToken(issued.token);
    expect(await sessions.resolve("customer", issued.token)).toBeNull();
  });

  it("refuses an expired session", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    await asOwner(
      database,
      `UPDATE sessions SET created_at = now() - interval '13 hours',
              expires_at = now() - interval '1 hour' WHERE id = $1`,
      [issued.id],
    );
    expect(await sessions.resolve("staff", issued.token)).toBeNull();
  });

  it("refuses an idle session", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    await asOwner(
      database,
      "UPDATE sessions SET idle_expires_at = now() - interval '1 second' WHERE id = $1",
      [issued.id],
    );
    expect(await sessions.resolve("staff", issued.token)).toBeNull();
  });

  it("refuses a deactivated agent's session on the next request", async () => {
    const formerId = await idOf(database, "agents", "former.agent@dsd.example");
    await asOwner(
      database,
      "UPDATE agents SET deactivated_at = NULL WHERE id = $1",
      [formerId],
    );
    const issued = await sessions.create(
      { kind: "staff", agentId: formerId },
      CLIENT,
    );
    expect(await sessions.resolve("staff", issued.token)).not.toBeNull();

    await asOwner(
      database,
      "UPDATE agents SET deactivated_at = now() WHERE id = $1",
      [formerId],
    );
    expect(await sessions.resolve("staff", issued.token)).toBeNull();
  });

  it("slides the idle deadline on activity, but not past the absolute expiry", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    await asOwner(
      database,
      `UPDATE sessions SET last_seen_at = now() - interval '5 minutes',
              idle_expires_at = now() + interval '1 minute',
              expires_at = now() + interval '30 minutes' WHERE id = $1`,
      [issued.id],
    );
    await sessions.resolve("staff", issued.token);
    const [after] = await asOwner<{ idle_left: number; touched: boolean }>(
      database,
      `SELECT extract(epoch FROM idle_expires_at - now())::int AS idle_left,
              last_seen_at > now() - interval '10 seconds' AS touched
         FROM sessions WHERE id = $1`,
      [issued.id],
    );
    expect(after?.touched).toBe(true);
    // Two more idle hours would pass the absolute expiry, so it stops there.
    expect(after?.idle_left).toBeGreaterThan(25 * 60);
    expect(after?.idle_left).toBeLessThanOrEqual(30 * 60);
  });

  it("doesn't write to the session on every request", async () => {
    const issued = await sessions.create({ kind: "staff", agentId }, CLIENT);
    const lastSeen = () =>
      asOwner<{ last_seen_at: Date }>(
        database,
        "SELECT last_seen_at FROM sessions WHERE id = $1",
        [issued.id],
      );
    const before = await lastSeen();
    await sessions.resolve("staff", issued.token);
    expect(await lastSeen()).toEqual(before);
  });
});

import type { TestDatabase } from "@dsd/db/testing";
import { type Agent, PROBLEM_TYPES } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newAgent } from "../support/agents.js";
import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { demoBrandId, newTicket, otherBrandId } from "../support/tickets.js";

/**
 * Managing agents (FR-14; ADR-0004, section 4, amended): the rank rules,
 * every attempt to escalate privilege, and what a role change or a
 * deactivation does to sessions and tickets.
 */
describe("agent management", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let supervisorId: string;
  let adminId: string;
  let customerId: string;
  let agent: Credentials;
  let supervisor: Credentials;
  let admin: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_agent_management");
    app = await startAppOn(database);
    supervisorId = await idOf(database, "agents", DEMO.supervisor);
    adminId = await idOf(database, "agents", DEMO.admin);
    customerId = await idOf(database, "customers", DEMO.customer);
    agent = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.agent),
    });
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: supervisorId,
    });
    admin = await sessionFor(app, { kind: "staff", agentId: adminId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const send = (
    method: "post" | "patch",
    path: string,
    caller: Credentials,
    body?: Record<string, unknown>,
  ) => {
    const http = request(app.getHttpServer());
    const call = http[method](`/api/v1/staff/agents${path}`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
    return body === undefined ? call : call.send(body);
  };

  const get = (path: string, caller: Credentials) =>
    request(app.getHttpServer())
      .get(`/api/v1/staff/agents${path}`)
      .set("cookie", caller.cookie);

  /** Whether a staff session still works. */
  const meStatus = async (caller: Credentials) =>
    (
      await request(app.getHttpServer())
        .get("/api/v1/auth/staff/me")
        .set("cookie", caller.cookie)
    ).status;

  const agentHistory = (agentId: string) =>
    asOwner<{
      action: string;
      ticket_id: string | null;
      actor_agent_id: string;
      before: unknown;
      after: unknown;
    }>(
      database,
      `SELECT action, ticket_id, actor_agent_id, before, after FROM audit_events
        WHERE entity_type = 'agent' AND entity_id = $1 ORDER BY created_at, id`,
      [agentId],
    );

  describe("listing", () => {
    it("shows each colleague's status and what the viewer may do to them", async () => {
      const response = await get("?limit=100", supervisor);
      expect(response.status).toBe(200);
      const items = (response.body as { items: Agent[] }).items;
      const byEmail = new Map(items.map((item) => [item.email, item]));
      expect(byEmail.get(DEMO.invitedAgent)).toMatchObject({
        status: "invited",
        allowedActions: { resendInvite: true, deactivate: true },
        grantableRoles: ["agent", "supervisor"],
      });
      expect(byEmail.get(DEMO.formerAgent)).toMatchObject({
        status: "deactivated",
        allowedActions: { reactivate: true, deactivate: false },
      });
      expect(byEmail.get(DEMO.admin)).toMatchObject({
        status: "active",
        grantableRoles: [],
        allowedActions: {
          edit: false,
          changeRole: false,
          deactivate: false,
          reactivate: false,
          resendInvite: false,
        },
      });
      expect(byEmail.get(DEMO.supervisor)?.allowedActions.edit).toBe(false);
    });

    it("filters by status and pages without gaps or repeats", async () => {
      const deactivated = await get("?status=deactivated", supervisor);
      expect(
        (deactivated.body as { items: Agent[] }).items.every(
          (item) => item.status === "deactivated",
        ),
      ).toBe(true);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string =
          cursor === null ? "?limit=2" : `?limit=2&cursor=${cursor}`;
        const page = await get(query, supervisor);
        const body = page.body as { items: Agent[]; nextCursor: string | null };
        seen.push(...body.items.map((item) => item.id));
        cursor = body.nextCursor;
      } while (cursor !== null);
      const all = (await get("?limit=100", supervisor)).body as {
        items: Agent[];
      };
      expect(seen).toEqual(all.items.map((item) => item.id));
    });

    it("hides colleagues who share no brand with the viewer", async () => {
      const outsider = await newAgent(database, {
        brandIds: [await otherBrandId(database)],
      });
      expect((await get(`/${outsider.id}`, admin)).status).toBe(404);
      expect(
        (await send("post", `/${outsider.id}/deactivate`, admin)).status,
      ).toBe(404);
    });
  });

  describe("inviting", () => {
    it("creates an invited account in the inviter's brands and asks for the email", async () => {
      const response = await send("post", "", supervisor, {
        email: "New.Hire@DSD.example",
        displayName: "New Hire",
        role: "agent",
      });
      expect(response.status).toBe(201);
      const created = response.body as Agent;
      expect(created).toMatchObject({
        email: "New.Hire@DSD.example",
        role: "agent",
        status: "invited",
        brands: [{ id: await demoBrandId(database) }],
      });
      expect(await agentHistory(created.id)).toEqual([
        {
          action: "agent.invited",
          ticket_id: null,
          actor_agent_id: supervisorId,
          before: null,
          after: { role: "agent" },
        },
      ]);
      const events = await asOwner<{ payload: unknown }>(
        database,
        `SELECT payload FROM outbox_events WHERE event_type = 'agent.invited' AND aggregate_id = $1`,
        [created.id],
      );
      expect(events).toEqual([{ payload: { agentId: created.id } }]);

      const again = await send("post", "", supervisor, {
        email: "new.hire@dsd.example",
        displayName: "Someone Else",
        role: "agent",
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ type: PROBLEM_TYPES.alreadyExists });
    });

    it("lets a supervisor invite up to their own rank, never an admin", async () => {
      const asSupervisor = await send("post", "", supervisor, {
        email: "second.supervisor@dsd.example",
        displayName: "Second Supervisor",
        role: "supervisor",
      });
      expect(asSupervisor.status).toBe(201);
      const asAdmin = await send("post", "", supervisor, {
        email: "would.be.admin@dsd.example",
        displayName: "Would Be",
        role: "admin",
      });
      expect(asAdmin.status).toBe(403);
    });

    it("sends the invite again only while it is still pending", async () => {
      const invited = await newAgent(database, { hasPassword: false });
      const resent = await send("post", `/${invited.id}/invite`, supervisor);
      expect(resent.status).toBe(202);
      const events = await asOwner(
        database,
        `SELECT 1 FROM outbox_events WHERE event_type = 'agent.invited' AND aggregate_id = $1`,
        [invited.id],
      );
      expect(events).toHaveLength(1);

      const active = await newAgent(database);
      expect(
        (await send("post", `/${active.id}/invite`, supervisor)).status,
      ).toBe(409);
    });
  });

  describe("privilege escalation attempts", () => {
    it("refuses an agent any management, and a customer any staff route", async () => {
      const target = await newAgent(database);
      expect((await get("", agent)).status).toBe(403);
      expect(
        (await send("patch", `/${target.id}/role`, agent, { role: "admin" }))
          .status,
      ).toBe(403);
      const customer = await sessionFor(app, { kind: "customer", customerId });
      expect((await get("", customer)).status).toBe(401);
    });

    it("refuses a supervisor promoting themselves", async () => {
      const response = await send(
        "patch",
        `/${supervisorId}/role`,
        supervisor,
        {
          role: "admin",
        },
      );
      expect(response.status).toBe(403);
    });

    it("refuses a supervisor making an admin, or touching another supervisor or an admin", async () => {
      const target = await newAgent(database);
      expect(
        (
          await send("patch", `/${target.id}/role`, supervisor, {
            role: "admin",
          })
        ).status,
      ).toBe(403);
      const peer = await newAgent(database, { role: "supervisor" });
      expect(
        (await send("post", `/${peer.id}/deactivate`, supervisor)).status,
      ).toBe(403);
      expect(
        (await send("patch", `/${adminId}/role`, supervisor, { role: "agent" }))
          .status,
      ).toBe(403);
      expect(
        (await send("patch", `/${peer.id}`, supervisor, { displayName: "X" }))
          .status,
      ).toBe(403);
    });

    it("refuses an admin changing or deactivating their own account", async () => {
      expect(
        (await send("patch", `/${adminId}/role`, admin, { role: "agent" }))
          .status,
      ).toBe(403);
      expect((await send("post", `/${adminId}/deactivate`, admin)).status).toBe(
        403,
      );
    });

    it("never leaves zero admins when two admins demote each other at once", async () => {
      const first = await newAgent(database, { role: "admin" });
      const second = await newAgent(database, { role: "admin" });
      const firstSession = await sessionFor(app, {
        kind: "staff",
        agentId: first.id,
      });
      const secondSession = await sessionFor(app, {
        kind: "staff",
        agentId: second.id,
      });
      const statuses = (
        await Promise.all([
          send("patch", `/${second.id}/role`, firstSession, { role: "agent" }),
          send("patch", `/${first.id}/role`, secondSession, { role: "agent" }),
        ])
      ).map((response) => response.status);
      // The loser is refused by the rank rules (403), or, if its request
      // arrived after the winner committed, by its revoked session (401).
      const [winner, loser] = statuses.sort();
      expect(winner).toBe(200);
      expect([401, 403]).toContain(loser);
      const [row] = await asOwner<{ admins: number }>(
        database,
        `SELECT count(*)::int AS admins FROM agents
          WHERE id IN ($1, $2) AND role = 'admin' AND deactivated_at IS NULL`,
        [first.id, second.id],
      );
      expect(row?.admins).toBe(1);
    });
  });

  describe("changing a role", () => {
    it("applies at once: the colleague's sessions are revoked and the change is recorded", async () => {
      const target = await newAgent(database);
      const session = await sessionFor(app, {
        kind: "staff",
        agentId: target.id,
      });
      expect(await meStatus(session)).toBe(200);

      const response = await send("patch", `/${target.id}/role`, supervisor, {
        role: "supervisor",
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        role: "supervisor",
        allowedActions: { changeRole: false },
      });
      expect(await meStatus(session)).toBe(401);
      expect(await agentHistory(target.id)).toEqual([
        {
          action: "agent.role_changed",
          ticket_id: null,
          actor_agent_id: supervisorId,
          before: { role: "agent" },
          after: { role: "supervisor" },
        },
      ]);
    });

    it("writes nothing for the role they already have", async () => {
      const target = await newAgent(database);
      const session = await sessionFor(app, {
        kind: "staff",
        agentId: target.id,
      });
      const response = await send("patch", `/${target.id}/role`, supervisor, {
        role: "agent",
      });
      expect(response.status).toBe(200);
      expect(await agentHistory(target.id)).toEqual([]);
      expect(await meStatus(session)).toBe(200);
    });

    it("lets an admin demote another admin", async () => {
      const target = await newAgent(database, { role: "admin" });
      const response = await send("patch", `/${target.id}/role`, admin, {
        role: "supervisor",
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ role: "supervisor" });
    });
  });

  describe("deactivating and reactivating", () => {
    it("signs the colleague out and returns their open work to the queue", async () => {
      const target = await newAgent(database);
      const session = await sessionFor(app, {
        kind: "staff",
        agentId: target.id,
      });
      const open = await newTicket(database, {
        customerId,
        assigneeId: target.id,
      });
      const pending = await newTicket(database, {
        customerId,
        status: "pending_customer",
        assigneeId: target.id,
      });
      const resolved = await newTicket(database, {
        customerId,
        status: "resolved",
        assigneeId: target.id,
      });
      const elsewhere = await newTicket(database, {
        customerId,
        brandId: await otherBrandId(database),
        assigneeId: target.id,
      });

      const response = await send(
        "post",
        `/${target.id}/deactivate`,
        supervisor,
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "deactivated",
        allowedActions: { reactivate: true },
      });
      expect(await meStatus(session)).toBe(401);

      const assignees = await asOwner<{ id: string; assignee: string | null }>(
        database,
        "SELECT id, assignee_agent_id AS assignee FROM tickets WHERE id = ANY($1)",
        [[open, pending, resolved, elsewhere]],
      );
      expect(
        Object.fromEntries(assignees.map((row) => [row.id, row.assignee])),
      ).toEqual({
        [open]: null,
        [pending]: null,
        // Finished work keeps who did it, for the per-agent report.
        [resolved]: target.id,
        // Brand scope limits what a manager sees, not what a deactivation clears.
        [elsewhere]: null,
      });
      for (const ticketId of [open, pending, elsewhere]) {
        const history = await asOwner<{
          actor_agent_id: string;
          after: unknown;
        }>(
          database,
          `SELECT actor_agent_id, after FROM audit_events
            WHERE ticket_id = $1 AND action = 'ticket.assigned'`,
          [ticketId],
        );
        expect(history).toEqual([
          { actor_agent_id: supervisorId, after: { assigneeAgentId: null } },
        ]);
        const events = await asOwner<{ payload: unknown }>(
          database,
          `SELECT payload FROM outbox_events
            WHERE event_type = 'ticket.assigned' AND aggregate_id = $1`,
          [ticketId],
        );
        expect(events).toEqual([
          {
            payload: { ticketId, fromAgentId: target.id, toAgentId: null },
          },
        ]);
      }
      expect(
        (await agentHistory(target.id)).map((event) => event.action),
      ).toEqual(["agent.deactivated"]);

      // A deactivated agent can't be given work.
      const later = await newTicket(database, { customerId });
      const assign = await request(app.getHttpServer())
        .post(`/api/v1/staff/tickets/${later}/assignment`)
        .set("origin", ORIGIN)
        .set("cookie", supervisor.cookie)
        .set("x-csrf-token", supervisor.csrfToken)
        .send({ action: "assign", agentId: target.id });
      expect(assign.status).toBe(422);
    });

    it("is a no-op the second time, and reactivation keeps the old sessions revoked", async () => {
      const target = await newAgent(database);
      const session = await sessionFor(app, {
        kind: "staff",
        agentId: target.id,
      });
      expect(
        (await send("post", `/${target.id}/deactivate`, supervisor)).status,
      ).toBe(200);
      expect(
        (await send("post", `/${target.id}/deactivate`, supervisor)).status,
      ).toBe(200);

      const reactivated = await send(
        "post",
        `/${target.id}/reactivate`,
        supervisor,
      );
      expect(reactivated.status).toBe(200);
      expect(reactivated.body).toMatchObject({ status: "active" });
      expect(await meStatus(session)).toBe(401);
      expect(
        (await agentHistory(target.id)).map((event) => event.action),
      ).toEqual(["agent.deactivated", "agent.reactivated"]);
    });

    it("unassigns a ticket whose assignment was in flight when the deactivation started", async () => {
      const target = await newAgent(database);
      const ticketId = await newTicket(database, { customerId });
      // An assignment that has locked the ticket and the agent's row but not
      // committed yet, as the assignment endpoint does.
      const client = await database.pool("dsd_migrator").connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT id FROM tickets WHERE id = $1 FOR UPDATE", [
          ticketId,
        ]);
        await client.query("SELECT id FROM agents WHERE id = $1 FOR SHARE", [
          target.id,
        ]);
        await client.query(
          "UPDATE tickets SET assignee_agent_id = $2 WHERE id = $1",
          [ticketId, target.id],
        );
        const deactivation = send(
          "post",
          `/${target.id}/deactivate`,
          supervisor,
        ).then((response) => response.status);
        await new Promise((resolve) => setTimeout(resolve, 300));
        await client.query("COMMIT");
        expect(await deactivation).toBe(200);
      } finally {
        client.release();
      }
      const [row] = await asOwner<{ assignee: string | null }>(
        database,
        "SELECT assignee_agent_id AS assignee FROM tickets WHERE id = $1",
        [ticketId],
      );
      expect(row?.assignee).toBeNull();
    });
  });

  it("renames a colleague", async () => {
    const target = await newAgent(database);
    const response = await send("patch", `/${target.id}`, supervisor, {
      displayName: "  Renamed Agent ",
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ displayName: "Renamed Agent" });
  });
});

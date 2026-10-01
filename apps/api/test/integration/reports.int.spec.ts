import type { TestDatabase } from "@dsd/db/testing";
import type {
  AgentsReport,
  ResponseTimesReport,
  VolumeReport,
} from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";

/**
 * Reporting (FR-13; ADR-0007, section 9) against a fixed dataset in a
 * brand of its own, with every expected figure worked out by hand below.
 *
 * The reporting time zone is America/New_York, which is UTC-4 in
 * September, so 1 to 7 September 2026 runs from 2026-09-01T04:00Z up to
 * 2026-09-08T04:00Z. Tickets sit on both sides of both edges.
 */
describe("reports", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let viewer: Credentials;
  const ids: Record<string, string> = {};

  const RANGE = "from=2026-09-01&to=2026-09-07";

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_reports");
    app = await startAppOn(database, {
      REPORTING_TIMEZONE: "America/New_York",
    });
    const [brand] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO brands (slug, name, ticket_prefix, support_email)
       VALUES ('reports', 'Reports Brand', 'RPT', 'support@reports.example') RETURNING id`,
    );
    const brandId = brand?.id ?? "";
    const agent = async (name: string, role: string, active: boolean) => {
      const [row] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO agents (email, email_normalized, display_name, role, password_hash, deactivated_at)
         VALUES ($1, $1, $2, $3::agent_role, 'not-a-real-hash', CASE WHEN $4 THEN NULL ELSE now() END)
         RETURNING id`,
        [
          `${name.toLowerCase().replace(" ", ".")}@reports.example`,
          name,
          role,
          active,
        ],
      );
      await asOwner(
        database,
        "INSERT INTO agent_brand_memberships (agent_id, brand_id) VALUES ($1, $2)",
        [row?.id, brandId],
      );
      return row?.id ?? "";
    };
    ids.supervisor = await agent("Rpt Supervisor", "supervisor", true);
    ids.alpha = await agent("Rpt Alpha", "agent", true);
    ids.beta = await agent("Rpt Beta", "agent", false);
    ids.gamma = await agent("Rpt Gamma", "agent", false);
    viewer = await sessionFor(app, { kind: "staff", agentId: ids.supervisor });

    const customerId = await idOf(database, "customers", DEMO.customer);
    const ticket = (
      status: string,
      createdAt: string,
      times: { firstResponse?: string; resolved?: string; closed?: string },
      assignee?: string,
    ) =>
      asOwner(
        database,
        `INSERT INTO tickets (brand_id, customer_id, channel, subject, description, status,
                              assignee_agent_id, created_at, first_response_at, resolved_at, closed_at)
         VALUES ($1, $2, 'web', 'Reporting fixture', 'Fixture.', $3::ticket_status,
                 $4, $5, $6, $7, $8)`,
        [
          brandId,
          customerId,
          status,
          assignee ?? null,
          createdAt,
          times.firstResponse ?? null,
          times.resolved ?? null,
          times.closed ?? null,
        ],
      );

    // T1: 31 August, 23:30 local. Before the range.
    await ticket("open", "2026-09-01T03:30:00Z", {});
    // T2: 1 September, 00:30 local. Replied in 1 h (3,600 s), resolved in 1 day (86,400 s).
    await ticket(
      "resolved",
      "2026-09-01T04:30:00Z",
      {
        firstResponse: "2026-09-01T05:30:00Z",
        resolved: "2026-09-02T04:30:00Z",
      },
      ids.alpha,
    );
    // T3: 1 September. Replied in 3 h (10,800 s), resolved in 2 days (172,800 s), then closed.
    await ticket(
      "closed",
      "2026-09-01T20:00:00Z",
      {
        firstResponse: "2026-09-01T23:00:00Z",
        resolved: "2026-09-03T20:00:00Z",
        closed: "2026-09-04T20:00:00Z",
      },
      ids.alpha,
    );
    // T9: 2 September. Replied in 30 min (1,800 s); resolved after the range.
    await ticket(
      "resolved",
      "2026-09-02T10:00:00Z",
      {
        firstResponse: "2026-09-02T10:30:00Z",
        resolved: "2026-09-10T10:00:00Z",
      },
      ids.alpha,
    );
    // T4: 3 September. Replied in 2 h (7,200 s); waiting on the customer, held by
    // Beta, who has since been deactivated.
    await ticket(
      "pending_customer",
      "2026-09-03T12:00:00Z",
      { firstResponse: "2026-09-03T14:00:00Z" },
      ids.beta,
    );
    // T5: 7 September, 19:00 local. No reply yet: awaiting.
    await ticket("open", "2026-09-07T23:00:00Z", {});
    // T6: 7 September, 23:59 local. Closed as spam without a reply: not awaiting.
    await ticket("closed", "2026-09-08T03:59:00Z", {
      closed: "2026-09-08T04:30:00Z",
    });
    // T7: 8 September, 00:00 local. After the range.
    await ticket("open", "2026-09-08T04:00:00Z", {});
    // T8: created in August, resolved on 5 September after 16 days (1,382,400 s).
    await ticket(
      "resolved",
      "2026-08-20T10:00:00Z",
      {
        firstResponse: "2026-08-20T11:00:00Z",
        resolved: "2026-09-05T10:00:00Z",
      },
      ids.alpha,
    );
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const report = (path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/staff/reports/${path}`)
      .set("cookie", viewer.cookie);

  it("counts tickets per local day, empty days included", async () => {
    const response = await report(`volume?${RANGE}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      timeZone: "America/New_York",
      from: "2026-09-01",
      to: "2026-09-07",
      interval: "day",
      // T2, T3, T9, T4, T5 and T6.
      total: 6,
      buckets: [
        { start: "2026-09-01", count: 2 },
        { start: "2026-09-02", count: 1 },
        { start: "2026-09-03", count: 1 },
        { start: "2026-09-04", count: 0 },
        { start: "2026-09-05", count: 0 },
        { start: "2026-09-06", count: 0 },
        { start: "2026-09-07", count: 2 },
      ],
    } satisfies VolumeReport);
  });

  it("counts tickets per week, weeks starting on Monday", async () => {
    const response = await report(`volume?${RANGE}&interval=week`);
    expect((response.body as VolumeReport).buckets).toEqual([
      // 1 September 2026 is a Tuesday; its week starts on 31 August.
      { start: "2026-08-31", count: 4 },
      { start: "2026-09-07", count: 2 },
    ]);
  });

  it("averages first responses and resolutions, with medians and the backlog", async () => {
    const response = await report(`response-times?${RANGE}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      timeZone: "America/New_York",
      from: "2026-09-01",
      to: "2026-09-07",
      firstResponse: {
        // T2, T3, T9 and T4: 3,600 + 10,800 + 1,800 + 7,200 = 23,400 s.
        ticketCount: 4,
        meanSeconds: 5_850,
        // The middle of 1,800, 3,600, 7,200 and 10,800.
        medianSeconds: 5_400,
        // T5; T6 was closed without a reply.
        awaitingFirstResponse: 1,
      },
      resolution: {
        // T2, T3 and T8: 86,400 + 172,800 + 1,382,400 = 1,641,600 s.
        ticketCount: 3,
        meanSeconds: 547_200,
        medianSeconds: 172_800,
      },
    } satisfies ResponseTimesReport);
  });

  it("counts each agent's open work and resolutions in the range", async () => {
    const response = await report(`agents?${RANGE}`);
    expect(response.status).toBe(200);
    expect((response.body as AgentsReport).agents).toEqual([
      {
        agent: {
          id: ids.alpha,
          displayName: "Rpt Alpha",
          role: "agent",
          active: true,
        },
        openAssigned: 0,
        // T2, T3 and T8; T9 was resolved after the range.
        resolvedInRange: 3,
      },
      {
        // Deactivated, but still shown while they hold open work (T4).
        agent: {
          id: ids.beta,
          displayName: "Rpt Beta",
          role: "agent",
          active: false,
        },
        openAssigned: 1,
        resolvedInRange: 0,
      },
      // Gamma is deactivated with nothing to show, so is left out.
      {
        agent: {
          id: ids.supervisor,
          displayName: "Rpt Supervisor",
          role: "supervisor",
          active: true,
        },
        openAssigned: 0,
        resolvedInRange: 0,
      },
    ]);
  });

  it("reports nothing from brands the viewer isn't in", async () => {
    const supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.supervisor),
    });
    const response = await request(app.getHttpServer())
      .get(`/api/v1/staff/reports/volume?${RANGE}`)
      .set("cookie", supervisor.cookie);
    // The demo brand's seeded tickets are dated around its own anchor.
    expect((response.body as VolumeReport).buckets).toHaveLength(7);
    const agents = await request(app.getHttpServer())
      .get(`/api/v1/staff/reports/agents?${RANGE}`)
      .set("cookie", supervisor.cookie);
    expect(
      (agents.body as AgentsReport).agents.map((row) => row.agent.id),
    ).not.toContain(ids.alpha);
  });

  it("defaults to the last 30 days, today included", async () => {
    const response = await report("volume");
    const body = response.body as VolumeReport;
    expect(body.buckets).toHaveLength(30);
    expect(body.buckets.at(-1)?.start).toBe(body.to);
  });

  it("refuses a backwards or overlong range", async () => {
    expect((await report("volume?from=2026-09-07&to=2026-09-01")).status).toBe(
      400,
    );
    expect((await report("volume?from=2025-01-01&to=2026-09-01")).status).toBe(
      400,
    );
    expect((await report("volume?from=2026-02-30")).status).toBe(400);
  });
});

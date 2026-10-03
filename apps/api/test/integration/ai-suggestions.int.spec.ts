import { createServer } from "node:net";

import type { TestDatabase } from "@dsd/db/testing";
import { type AiSuggestion, PROBLEM_TYPES } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Credentials,
  DEMO,
  ORIGIN,
  resetRateLimits,
  sessionFor,
} from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { newSuggestion } from "../support/suggestions.js";
import { newTicket } from "../support/tickets.js";

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  return port;
}

interface Page {
  items: AiSuggestion[];
  nextCursor: string | null;
}

/**
 * The staff side of AI suggestions (FR-21, FR-22; ADR-0006, section 11):
 * what agents read, how they ask for a fresh draft, and how they rate one.
 * Who may call each route is in the RBAC matrix.
 */
describe("AI suggestions for staff", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let agentId: string;
  let agent: Credentials;
  let supervisor: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_ai_suggestions");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    agentId = await idOf(database, "agents", DEMO.agent);
    agent = await sessionFor(app, { kind: "staff", agentId });
    supervisor = await sessionFor(app, {
      kind: "staff",
      agentId: await idOf(database, "agents", DEMO.supervisor),
    });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const list = (ticketId: string, caller: Credentials, query = "") =>
    request(app.getHttpServer())
      .get(`/api/v1/staff/tickets/${ticketId}/ai-suggestions${query}`)
      .set("cookie", caller.cookie);

  const ask = (
    ticketId: string,
    caller: Credentials,
    on: NestFastifyApplication = app,
  ) =>
    request(on.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/ai-suggestions`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);

  const rate = (
    suggestionId: string,
    caller: Credentials,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .put(`/api/v1/staff/ai-suggestions/${suggestionId}/feedback`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken)
      .send(body);

  const requestEvents = async (ticketId: string) =>
    asOwner<{ payload: Record<string, unknown> }>(
      database,
      `SELECT payload FROM outbox_events
        WHERE event_type = 'ai.suggestion_requested' AND aggregate_id = $1`,
      [ticketId],
    );

  it("lists a ticket's suggestions newest first, with a draft and its cited articles only when ready", async () => {
    const ticketId = await newTicket(database, { customerId });
    const ready = await newSuggestion(database, ticketId, { secondsAgo: 30 });
    await newSuggestion(database, ticketId, {
      status: "rejected",
      rejectionReason: "no_citations",
      draft: "A draft that failed the checks",
      secondsAgo: 20,
    });
    await newSuggestion(database, ticketId, {
      status: "pending",
      secondsAgo: 10,
    });

    const response = await list(ticketId, agent).expect(200);
    const { items, nextCursor } = response.body as Page;
    expect(nextCursor).toBeNull();
    expect(items.map((item) => item.status)).toEqual([
      "pending",
      "rejected",
      "ready",
    ]);
    const [pending, rejected, shown] = items;
    expect(pending).toMatchObject({ draft: null, citations: [] });
    expect(rejected).toMatchObject({
      draft: null,
      citations: [],
      rejectionReason: "no_citations",
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "A draft that failed the checks",
    );
    expect(shown).toMatchObject({
      id: ready.id,
      ticketId,
      draft:
        "Refunds reach your card in 3 to 5 working days after we issue them.",
      rejectionReason: null,
      requestedBy: null,
      provider: "mock",
      model: "mock-grounded-v1",
      promptVersion: "reply-draft/v1",
      retrievalMode: "hybrid",
      myFeedback: null,
    });
    // Only the cited chunk, not the one that was retrieved and not used.
    expect(shown?.citations).toEqual([
      {
        articleId: ready.articleId,
        slug: expect.any(String) as string,
        title: "How long refunds take",
        headingPath: "How long refunds take > Timing",
        excerpt: "Refunds reach your card in 3 to 5 working days.",
        articleVersion: 1,
        current: true,
      },
    ]);
  });

  it("pages with a cursor, and refuses one from elsewhere", async () => {
    const ticketId = await newTicket(database, { customerId });
    for (const secondsAgo of [30, 20, 10]) {
      await newSuggestion(database, ticketId, { secondsAgo });
    }
    const first = (await list(ticketId, agent, "?limit=2").expect(200))
      .body as Page;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await list(
        ticketId,
        agent,
        `?limit=2&cursor=${first.nextCursor ?? ""}`,
      ).expect(200)
    ).body as Page;
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(3);

    await list(ticketId, agent, "?cursor=not-a-cursor").expect(400);
    await list(ticketId, agent, "?limit=21").expect(400);
  });

  it("keeps the excerpt a draft used after its article changes, and says it is no longer current", async () => {
    const ticketId = await newTicket(database, { customerId });
    const ready = await newSuggestion(database, ticketId);
    await asOwner(
      database,
      "UPDATE kb_articles SET status = 'draft' WHERE id = $1",
      [ready.articleId],
    );
    const { items } = (await list(ticketId, agent).expect(200)).body as Page;
    expect(items[0]?.citations[0]).toMatchObject({
      excerpt: "Refunds reach your card in 3 to 5 working days.",
      current: false,
    });
  });

  it("names the agent who asked for a suggestion", async () => {
    const ticketId = await newTicket(database, { customerId });
    await newSuggestion(database, ticketId, { requestedByAgentId: agentId });
    const { items } = (await list(ticketId, agent).expect(200)).body as Page;
    expect(items[0]?.requestedBy).toEqual({
      id: agentId,
      displayName: expect.any(String) as string,
    });
  });

  it("answers 404 for a ticket that doesn't exist", async () => {
    await list("00000000-0000-4000-8000-000000000000", agent).expect(404);
    await ask("00000000-0000-4000-8000-000000000000", agent).expect(404);
  });

  it("queues a request through the outbox and answers 202 at once, with the database's time", async () => {
    await resetRateLimits(app);
    const ticketId = await newTicket(database, { customerId });
    const before = Date.now();
    const response = await ask(ticketId, agent).expect(202);
    const { requestedAt } = response.body as { requestedAt: string };
    expect(Math.abs(Date.parse(requestedAt) - before)).toBeLessThan(60_000);
    expect(await requestEvents(ticketId)).toEqual([
      { payload: { ticketId, agentId } },
    ]);
  });

  it("refuses a request on a closed ticket, and queues nothing", async () => {
    await resetRateLimits(app);
    const ticketId = await newTicket(database, {
      customerId,
      status: "closed",
    });
    const response = await ask(ticketId, agent).expect(409);
    expect((response.body as { type: string }).type).toBe(
      PROBLEM_TYPES.ticketClosed,
    );
    expect(await requestEvents(ticketId)).toEqual([]);
  });

  it("limits requests to 5 per ticket in 10 minutes, and queues nothing over the limit", async () => {
    await resetRateLimits(app);
    const ticketId = await newTicket(database, { customerId });
    for (let i = 0; i < 5; i += 1) await ask(ticketId, agent).expect(202);
    const refused = await ask(ticketId, supervisor).expect(429);
    expect(refused.headers["retry-after"]).toBeDefined();
    expect(await requestEvents(ticketId)).toHaveLength(5);
    // Another ticket has its own allowance.
    await ask(await newTicket(database, { customerId }), agent).expect(202);
  });

  it("limits each agent to 30 requests an hour across tickets", async () => {
    await resetRateLimits(app);
    for (let t = 0; t < 6; t += 1) {
      const ticketId = await newTicket(database, { customerId });
      for (let i = 0; i < 5; i += 1) await ask(ticketId, agent).expect(202);
    }
    const another = await newTicket(database, { customerId });
    await ask(another, agent).expect(429);
    await ask(another, supervisor).expect(202);
  });

  it("rates a ready suggestion, replaces an earlier rating, and shows each agent only their own", async () => {
    const ticketId = await newTicket(database, { customerId });
    const { id } = await newSuggestion(database, ticketId);

    const first = await rate(id, agent, {
      rating: "up",
      comment: "Accurate and short",
    }).expect(200);
    expect(first.body).toMatchObject({
      rating: "up",
      comment: "Accurate and short",
    });
    const second = await rate(id, agent, { rating: "down" }).expect(200);
    expect(second.body).toMatchObject({ rating: "down", comment: null });

    const mine = (await list(ticketId, agent).expect(200)).body as Page;
    expect(mine.items[0]?.myFeedback).toMatchObject({
      rating: "down",
      comment: null,
    });
    const theirs = (await list(ticketId, supervisor).expect(200)).body as Page;
    expect(theirs.items[0]?.myFeedback).toBeNull();

    const rows = await asOwner<{ rating: string }>(
      database,
      "SELECT rating FROM ai_suggestion_feedback WHERE suggestion_id = $1",
      [id],
    );
    expect(rows).toEqual([{ rating: "down" }]);
  });

  it("refuses to rate a suggestion that isn't ready, one that doesn't exist, or with a rating it doesn't know", async () => {
    const ticketId = await newTicket(database, { customerId });
    const rejected = await newSuggestion(database, ticketId, {
      status: "rejected",
    });
    await rate(rejected.id, agent, { rating: "up" }).expect(409);
    await rate("00000000-0000-4000-8000-000000000000", agent, {
      rating: "up",
    }).expect(404);
    const ready = await newSuggestion(database, ticketId);
    await rate(ready.id, agent, { rating: "meh" }).expect(400);
    await rate(ready.id, agent, { rating: "up", extra: true }).expect(400);
    await rate(ready.id, agent, {
      rating: "up",
      comment: "x".repeat(1_001),
    }).expect(400);
  });

  describe("when Redis is down", () => {
    let down: NestFastifyApplication;
    let caller: Credentials;

    beforeAll(async () => {
      down = await startAppOn(database, {
        REDIS_URL: `redis://127.0.0.1:${String(await closedPort())}`,
      });
      caller = await sessionFor(down, { kind: "staff", agentId });
    });

    afterAll(async () => {
      await down.close();
    });

    it("refuses a request with 503 rather than allow unlimited spending, and queues nothing", async () => {
      const ticketId = await newTicket(database, { customerId });
      const response = await ask(ticketId, caller, down).expect(503);
      expect(response.headers["retry-after"]).toBeDefined();
      expect(await requestEvents(ticketId)).toEqual([]);
    });
  });
});

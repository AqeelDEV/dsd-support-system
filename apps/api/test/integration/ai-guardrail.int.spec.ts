import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { AiSuggestionStatus, StaffTicket } from "@dsd/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Credentials, DEMO, ORIGIN, sessionFor } from "../support/auth.js";
import {
  asOwner,
  createSeededDatabase,
  idOf,
  startAppOn,
} from "../support/database.js";
import { FILES } from "../support/files.js";
import { newSuggestion } from "../support/suggestions.js";
import { newTicket } from "../support/tickets.js";

/**
 * The AI guardrail at the API (FR-21, FR-22; ADR-0006, section 8). Each
 * test tries to get AI text to a customer without an agent sending it, or
 * to see a suggestion without a staff session, and checks it can't.
 */
describe("AI guardrail", () => {
  let database: TestDatabase;
  let app: NestFastifyApplication;
  let customerId: string;
  let agentId: string;
  let customer: Credentials;
  let agent: Credentials;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_api_ai_guardrail");
    app = await startAppOn(database);
    customerId = await idOf(database, "customers", DEMO.customer);
    agentId = await idOf(database, "agents", DEMO.agent);
    customer = await sessionFor(app, { kind: "customer", customerId });
    agent = await sessionFor(app, { kind: "staff", agentId });
  });

  afterAll(async () => {
    await app.close();
    await database.drop();
  });

  const reply = (
    ticketId: string,
    fields: Record<string, string>,
    caller: Credentials = agent,
  ) => {
    const call = request(app.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/replies`)
      .set("origin", ORIGIN)
      .set("cookie", caller.cookie)
      .set("x-csrf-token", caller.csrfToken);
    for (const [name, value] of Object.entries(fields)) {
      void call.field(name, value);
    }
    return call;
  };

  const messagesOn = (ticketId: string) =>
    asOwner<{
      body: string;
      author_agent_id: string | null;
      ai_suggestion_id: string | null;
      approved_by_agent_id: string | null;
    }>(
      database,
      `SELECT body, author_agent_id, ai_suggestion_id, approved_by_agent_id
         FROM messages WHERE ticket_id = $1 ORDER BY created_at`,
      [ticketId],
    );

  it("stores a reply based on a suggestion as the agent's own, with them as its approver, and audits it", async () => {
    const ticketId = await newTicket(database, { customerId });
    const suggestion = await newSuggestion(database, ticketId);
    const edited =
      "Hi, refunds take 3 to 5 working days to reach your card. Yours came on Monday, so it should be there by Friday.";

    const response = await reply(ticketId, {
      body: edited,
      aiSuggestionId: suggestion.id,
    }).expect(201);

    expect(await messagesOn(ticketId)).toEqual([
      {
        body: edited,
        author_agent_id: agentId,
        ai_suggestion_id: suggestion.id,
        approved_by_agent_id: agentId,
      },
    ]);
    const thread = (response.body as StaffTicket).messages;
    expect(thread.at(-1)).toMatchObject({
      body: edited,
      aiSuggestionId: suggestion.id,
    });
    const audit = await asOwner<{
      action: string;
      actor_agent_id: string;
      after: unknown;
    }>(
      database,
      `SELECT action, actor_agent_id, after FROM audit_events
        WHERE ticket_id = $1 AND action = 'ai_suggestion.used'`,
      [ticketId],
    );
    expect(audit).toEqual([
      {
        action: "ai_suggestion.used",
        actor_agent_id: agentId,
        after: { aiSuggestionId: suggestion.id },
      },
    ]);
  });

  it("refuses a suggestion from another ticket with 422, and sends nothing", async () => {
    const ticketId = await newTicket(database, { customerId });
    const elsewhere = await newSuggestion(
      database,
      await newTicket(database, { customerId }),
    );
    await reply(ticketId, {
      body: "Borrowed draft",
      aiSuggestionId: elsewhere.id,
    }).expect(422);
    expect(await messagesOn(ticketId)).toEqual([]);
  });

  it.each(["pending", "rejected", "no_grounded_answer", "failed"] as const)(
    "refuses a %s suggestion with 422, and sends nothing",
    async (status: AiSuggestionStatus) => {
      const ticketId = await newTicket(database, { customerId });
      const suggestion = await newSuggestion(database, ticketId, { status });
      await reply(ticketId, {
        body: "Based on a draft that never passed",
        aiSuggestionId: suggestion.id,
      }).expect(422);
      expect(await messagesOn(ticketId)).toEqual([]);
    },
  );

  it("refuses a suggestion that doesn't exist with 422, and a malformed ID with 400", async () => {
    const ticketId = await newTicket(database, { customerId });
    await reply(ticketId, {
      body: "Hello",
      aiSuggestionId: randomUUID(),
    }).expect(422);
    await reply(ticketId, { body: "Hello", aiSuggestionId: "S1" }).expect(400);
    expect(await messagesOn(ticketId)).toEqual([]);
  });

  it("stores no file when it refuses the suggestion", async () => {
    const ticketId = await newTicket(database, { customerId });
    const response = await reply(ticketId, {
      body: "With a file",
      aiSuggestionId: randomUUID(),
    })
      .attach("attachments", FILES.png, "photo.png")
      .expect(422);
    expect(response.status).toBe(422);
    const [files] = await asOwner<{ n: number }>(
      database,
      "SELECT count(*)::int AS n FROM attachments WHERE ticket_id = $1",
      [ticketId],
    );
    expect(files?.n).toBe(0);
  });

  it("takes no suggestion on an internal note or a customer's reply", async () => {
    const ticketId = await newTicket(database, { customerId });
    const suggestion = await newSuggestion(database, ticketId);
    await request(app.getHttpServer())
      .post(`/api/v1/staff/tickets/${ticketId}/notes`)
      .set("origin", ORIGIN)
      .set("cookie", agent.cookie)
      .set("x-csrf-token", agent.csrfToken)
      .field("body", "A note")
      .field("aiSuggestionId", suggestion.id)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/customer/tickets/${ticketId}/messages`)
      .set("origin", ORIGIN)
      .set("cookie", customer.cookie)
      .set("x-csrf-token", customer.csrfToken)
      .field("body", "A reply")
      .field("aiSuggestionId", suggestion.id)
      .expect(400);
    expect(await messagesOn(ticketId)).toEqual([]);
  });

  describe("for customers", () => {
    let ticketId: string;
    let guest: Credentials;
    const draft = `DRAFT-CANARY-${randomUUID()}`;

    beforeAll(async () => {
      ticketId = await newTicket(database, { customerId });
      const suggestion = await newSuggestion(database, ticketId, { draft });
      await reply(ticketId, {
        body: "Refunds take 3 to 5 working days.",
        aiSuggestionId: suggestion.id,
      }).expect(201);
      await newSuggestion(database, ticketId, { draft });
      guest = await sessionFor(app, {
        kind: "guest",
        customerId,
        ticketId,
      });
    });

    it.each([
      ["GET", "/api/v1/staff/tickets/:ticketId/ai-suggestions"],
      ["POST", "/api/v1/staff/tickets/:ticketId/ai-suggestions"],
      ["PUT", "/api/v1/staff/ai-suggestions/:ticketId/feedback"],
    ] as const)(
      "refuses customer and guest sessions on %s %s with 401",
      async (method, path) => {
        for (const caller of [customer, guest]) {
          const url = path.replace(":ticketId", ticketId);
          const http = request(app.getHttpServer());
          const call =
            method === "GET"
              ? http.get(url)
              : method === "POST"
                ? http.post(url)
                : http.put(url).send({ rating: "up" });
          await call
            .set("origin", ORIGIN)
            .set("cookie", caller.cookie)
            .set("x-csrf-token", caller.csrfToken)
            .expect(401);
        }
      },
    );

    it.each(["", "?include=aiSuggestions", "?expand=suggestions&fields=all"])(
      "never shows a suggestion or that a reply used one, in a customer's ticket view %s",
      async (query) => {
        for (const caller of [customer, guest]) {
          const response = await request(app.getHttpServer())
            .get(`/api/v1/customer/tickets/${ticketId}${query}`)
            .set("cookie", caller.cookie);
          const text = JSON.stringify(response.body);
          expect(text).not.toContain(draft);
          expect(text).not.toMatch(/aiSuggestion|suggestion|citation/i);
        }
      },
    );

    it("never shows them in the customer's ticket list", async () => {
      const response = await request(app.getHttpServer())
        .get("/api/v1/customer/tickets?limit=50")
        .set("cookie", customer.cookie)
        .expect(200);
      expect(JSON.stringify(response.body)).not.toMatch(
        /aiSuggestion|suggestion/i,
      );
    });
  });
});

import { randomUUID } from "node:crypto";

import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MockChatModel } from "../../src/ai/providers/mock-chat.js";
import type { Env } from "../../src/config/env.js";
import type { Worker } from "../../src/lifecycle.js";
import {
  eventually,
  fixtures,
  knowledgeBaseIndexed,
  SpyChat,
  startTestWorker,
  testEnv,
} from "../support/worker.js";

interface SuggestionRow {
  id: string;
  status: string;
  trigger_event_id: string;
  error: string | null;
}

const REFUND_TICKET = {
  subject: "My refund hasn't reached my card",
  description:
    "I got an email saying my refund was issued four days ago, but the money isn't back on my card yet.",
};

/** How long a customer's message waits for more; wide enough that a test's burst fits inside it. */
const DEBOUNCE_MS = 1_500;

/**
 * Suggestion jobs go through the outbox and the queue as in production
 * (ADR-0005, section 6, amended): a burst of customer messages is drafted
 * once, from all of them; what agents write never takes a customer's turn;
 * and a message that arrives while a draft is being written gets a draft
 * of its own once that one has finished, never at the same time.
 */
describe("debounced suggestion jobs", () => {
  let database: TestDatabase;
  let env: Env;
  let worker: Worker;
  /** Holds every draft until released, when a test needs one to stay in progress. */
  let hold: Promise<void> | undefined;
  const chat = new SpyChat(
    new MockChatModel("mock-grounded-v1"),
    () => hold ?? Promise.resolve(),
  );

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_ai_debounce");
    env = testEnv(database, { AI_DEBOUNCE_MS: String(DEBOUNCE_MS) });
    ({ worker } = await startTestWorker(env, { ai: { chat } }));
    await knowledgeBaseIndexed(database);
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  /** A ticket whose description carries a marker, so its prompts can be told apart. */
  const newTicket = async () => {
    const customer = await fixtures.customer(database);
    const marker = `TICKET-${randomUUID()}`;
    const ticket = await fixtures.ticket(database, customer.id, {
      ...REFUND_TICKET,
      description: `${REFUND_TICKET.description} ${marker}`,
    });
    return { ...ticket, customerId: customer.id, marker };
  };

  /** A message and its event, as the API writes them in one transaction. */
  const messageWithEvent = async (
    ticketId: string,
    body: string,
    author: { customerId: string } | { agentId: string },
    visibility: "public" | "internal" = "public",
  ) => {
    const messageId = await fixtures.message(database, {
      ticketId,
      body,
      author,
      visibility,
    });
    return fixtures.event(
      database,
      "message.created",
      { type: "ticket", id: ticketId },
      {
        ticketId,
        messageId,
        authorType: "customerId" in author ? "customer" : "agent",
        visibility,
      },
    );
  };

  const suggestionsFor = (ticketId: string) =>
    asOwner<SuggestionRow>(
      database,
      `SELECT id, status, trigger_event_id, error FROM ai_suggestions
        WHERE ticket_id = $1 ORDER BY created_at`,
      [ticketId],
    );

  /** The ticket's suggestions once `count` of them have finished and no job is left for it. */
  const settled = async (ticketId: string, count: number) => {
    await eventually(async () => {
      const found = await suggestionsFor(ticketId);
      const done = found.filter((row) => row.status !== "pending");
      return done.length >= count ? true : undefined;
    }, 20_000);
    // Long enough for a job that shouldn't exist to have been delayed and run.
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 500));
    return suggestionsFor(ticketId);
  };

  const promptsAbout = (canary: string) =>
    chat.requests.filter((request) => request.user.includes(canary));

  it("drafts once for a burst of customer messages, reading all of them", async () => {
    const ticket = await newTicket();
    const canaries = [1, 2, 3].map((n) => `BURST-${String(n)}-${randomUUID()}`);
    const events: string[] = [];
    for (const canary of canaries) {
      events.push(
        await messageWithEvent(
          ticket.id,
          `Following up on my refund: ${canary}`,
          { customerId: ticket.customerId },
        ),
      );
    }

    const suggestions = await settled(ticket.id, 1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      status: "ready",
      trigger_event_id: events.at(-1),
    });
    const prompts = promptsAbout(canaries[0] ?? "");
    expect(prompts).toHaveLength(1);
    for (const canary of canaries) {
      expect(prompts[0]?.user).toContain(canary);
    }
  });

  it("never lets an agent's note or reply replace a customer's waiting draft", async () => {
    const ticket = await newTicket();
    const agent = await fixtures.agent(database);
    const canary = `WAITING-${randomUUID()}`;
    const customerEvent = await messageWithEvent(
      ticket.id,
      `Still no refund: ${canary}`,
      { customerId: ticket.customerId },
    );
    await messageWithEvent(
      ticket.id,
      "Checked the payment provider; refund left us on the 2nd.",
      { agentId: agent.id },
      "internal",
    );
    await messageWithEvent(ticket.id, "We're looking into it now.", {
      agentId: agent.id,
    });

    const suggestions = await settled(ticket.id, 1);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      status: "ready",
      trigger_event_id: customerEvent,
    });
    expect(promptsAbout(canary)).toHaveLength(1);
  });

  it("drafts a message that arrives during a draft after that draft, not beside it", async () => {
    const ticket = await newTicket();
    let release: () => void = () => undefined;
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const created = await fixtures.event(
        database,
        "ticket.created",
        { type: "ticket", id: ticket.id },
        { ticketId: ticket.id, customerId: ticket.customerId },
      );
      // The first draft is now waiting on the model.
      await eventually(() =>
        Promise.resolve(
          promptsAbout(ticket.marker).length > 0 ? true : undefined,
        ),
      );
      const canary = `DURING-${randomUUID()}`;
      const later = await messageWithEvent(
        ticket.id,
        `One more detail: ${canary}`,
        { customerId: ticket.customerId },
      );
      // Past the debounce, the second job still mustn't have started.
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 500));
      expect(promptsAbout(canary)).toHaveLength(0);

      release();
      hold = undefined;
      const suggestions = await settled(ticket.id, 2);
      expect(suggestions.map((row) => row.trigger_event_id)).toEqual([
        created,
        later,
      ]);
      expect(suggestions.map((row) => row.status)).toEqual(["ready", "ready"]);
      expect(promptsAbout(canary)).toHaveLength(1);
    } finally {
      release();
      hold = undefined;
    }
  });
});

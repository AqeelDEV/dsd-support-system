import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MockChatModel } from "../../src/ai/providers/mock-chat.js";
import type {
  ChatModel,
  GenerateRequest,
  GenerateResult,
} from "../../src/ai/providers/types.js";
import type { MockLlmMode } from "../../src/ai/settings.js";
import type { Env } from "../../src/config/env.js";
import type { Container } from "../../src/container.js";
import type { Worker } from "../../src/lifecycle.js";
import {
  type DeadLetter,
  replayDeadLetters,
} from "../../src/queues/dead-letter.js";
import {
  emailsTo,
  eventually,
  fixtures,
  knowledgeBaseIndexed,
  startTestWorker,
  testEnv,
} from "../support/worker.js";

/** The offline mock in whichever mode a test puts the provider in. */
class ProviderStub implements ChatModel {
  readonly provider = "mock";
  readonly model = "mock-grounded-v1";
  mode: MockLlmMode = "grounded";

  generate(request: GenerateRequest): Promise<GenerateResult> {
    return new MockChatModel(this.model, this.mode).generate(request);
  }
}

/**
 * Graceful degradation of AI suggestions (NFR-10; ADR-0005, section 4):
 * when the provider fails or stops answering, the suggestion job is retried
 * with backoff, dead-lettered after its last attempt and its suggestion is
 * marked failed, while the rest of the ticket's work (here, the
 * acknowledgement email) goes on as normal. Replaying the dead letter once
 * the provider is back drafts the suggestion.
 */
describe("when the AI provider is down", () => {
  let database: TestDatabase;
  let env: Env;
  let worker: Worker;
  let container: Container;
  const provider = new ProviderStub();

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_ai_degradation");
    // The shortest timeout allowed, so a hanging provider fails fast.
    env = testEnv(database, { LLM_TIMEOUT_MS: "1000" });
    ({ worker, container } = await startTestWorker(env, {
      firstRetryDelayMs: 20,
      ai: { chat: provider },
    }));
    await knowledgeBaseIndexed(database);
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  const newTicketEvent = async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id, {
      subject: "My refund hasn't reached my card",
      description:
        "The refund email came four days ago but the money isn't on my card yet. How long do refunds take?",
    });
    const eventId = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    return { ticketId: ticket.id, email: customer.email, eventId };
  };

  const deadLetterOf = async (eventId: string) => {
    const queue = new Queue<DeadLetter>("dead-letter", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      const letter = await eventually(
        async () =>
          (await queue.getJob(`${eventId}.ai-suggestions`)) ?? undefined,
        20_000,
      );
      return letter.data;
    } finally {
      await queue.close();
    }
  };

  const suggestionOf = async (ticketId: string) =>
    (
      await asOwner<{
        status: string;
        error: string | null;
        draft_body: string | null;
      }>(
        database,
        "SELECT status, error, draft_body FROM ai_suggestions WHERE ticket_id = $1",
        [ticketId],
      )
    )[0];

  it("retries a failing provider, dead-letters the job and marks the suggestion failed; the email still goes", async () => {
    provider.mode = "throw";
    const { ticketId, email, eventId } = await newTicketEvent();

    const letter = await deadLetterOf(eventId);
    expect(letter).toMatchObject({
      queue: "ai-suggestions",
      jobId: `${eventId}.ai-suggestions`,
      name: "ticket.created",
      attemptsMade: 3,
      data: { eventId, type: "ticket.created" },
    });
    expect(letter.error).toMatch(/unavailable/);
    expect(await suggestionOf(ticketId)).toMatchObject({
      status: "failed",
      draft_body: null,
    });
    expect((await suggestionOf(ticketId))?.error).toMatch(/unavailable/);

    const emails = await eventually(async () => {
      const found = await emailsTo(email);
      return found.length > 0 ? found : undefined;
    });
    expect(emails).toHaveLength(1);
  });

  it("gives up on a provider that stops answering after the timeout, on every attempt", async () => {
    provider.mode = "hang";
    const { ticketId, eventId } = await newTicketEvent();

    const letter = await deadLetterOf(eventId);
    expect(letter.attemptsMade).toBe(3);
    expect(letter.error).toMatch(/didn't answer within 1000 ms/);
    expect((await suggestionOf(ticketId))?.status).toBe("failed");
  });

  it("drafts the suggestion when the dead letter is replayed once the provider is back", async () => {
    provider.mode = "throw";
    const { ticketId, eventId } = await newTicketEvent();
    await deadLetterOf(eventId);
    expect((await suggestionOf(ticketId))?.status).toBe("failed");

    provider.mode = "grounded";
    const queue = new Queue<DeadLetter>("dead-letter", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      expect(
        await replayDeadLetters(queue, container.producer, env.QUEUE_PREFIX, {
          jobId: `${eventId}.ai-suggestions`,
        }),
      ).toEqual([`${eventId}.ai-suggestions`]);
    } finally {
      await queue.close();
    }

    const suggestion = await eventually(async () => {
      const row = await suggestionOf(ticketId);
      return row?.status === "ready" ? row : undefined;
    });
    expect(suggestion.error).toBeNull();
    expect(suggestion.draft_body).toContain("3 to 5 working days");
  });
});

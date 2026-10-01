import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Env } from "../../src/config/env.js";
import type { Container } from "../../src/container.js";
import type { Worker } from "../../src/lifecycle.js";
import {
  type DeadLetter,
  deadLetters as deadLettersIn,
  replayDeadLetters,
} from "../../src/queues/dead-letter.js";
import {
  closedPort,
  emailsTo,
  eventually,
  fixtures,
  startTestWorker,
  testEnv,
} from "../support/worker.js";

/**
 * Graceful degradation (NFR-10; ADR-0005, section 4): with the mail server
 * unreachable, a notification is retried with backoff, then lands in the
 * dead-letter queue and its delivery is marked failed. Nothing that raised
 * the event waited for any of it.
 */
describe("when the mail server is down", () => {
  let database: TestDatabase;
  let env: Env;
  let worker: Worker;
  let container: Container;

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_degradation");
    env = testEnv(database, { SMTP_PORT: String(await closedPort()) });
    // Retries 20 ms apart instead of 10 s, so all five attempts fit in a test.
    ({ worker, container } = await startTestWorker(env, {
      firstRetryDelayMs: 20,
    }));
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  it("retries, dead-letters the job and marks the delivery failed", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const eventId = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );

    const deadLetters = new Queue<DeadLetter>("dead-letter", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      const letter = await eventually(
        async () =>
          (await deadLetters.getJob(`${eventId}.notifications`)) ?? undefined,
        20_000,
      );
      expect(letter.data).toMatchObject({
        queue: "notifications",
        jobId: `${eventId}.notifications`,
        name: "ticket.created",
        attemptsMade: 5,
        data: { eventId, type: "ticket.created" },
      });
      expect(letter.data.error).toMatch(/ECONNREFUSED|connect/i);
    } finally {
      await deadLetters.close();
    }

    const [delivery] = await asOwner<{
      status: string;
      attempts: number;
      last_error: string | null;
      sent_at: Date | null;
    }>(
      database,
      "SELECT status, attempts, last_error, sent_at FROM notification_deliveries WHERE event_id = $1",
      [eventId],
    );
    expect(delivery).toMatchObject({
      status: "failed",
      attempts: 5,
      sent_at: null,
    });
    expect(delivery?.last_error).toMatch(/ECONNREFUSED|connect/i);

    const notifications = new Queue("notifications", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      const job = await notifications.getJob(`${eventId}.notifications`);
      expect(await job?.getState()).toBe("failed");
    } finally {
      await notifications.close();
    }
  });

  it("creates a guest link token per attempt, and no email ever carries them", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const eventId = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    await eventually(async () => {
      const [row] = await asOwner<{ status: string }>(
        database,
        "SELECT status FROM notification_deliveries WHERE event_id = $1",
        [eventId],
      );
      return row?.status === "failed" ? true : undefined;
    }, 20_000);
    // The tokens exist only as hashes; their emails were never sent, so no
    // one holds them, and they expire like any other.
    const [tokens] = await asOwner<{ n: number }>(
      database,
      "SELECT count(*)::int AS n FROM auth_tokens WHERE ticket_id = $1",
      [ticket.id],
    );
    expect(tokens?.n).toBe(5);
  });

  it("delivers a dead-lettered email once the mail server is back and the job is replayed", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const eventId = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    const queue = new Queue<DeadLetter>("dead-letter", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      await eventually(
        async () =>
          (await queue.getJob(`${eventId}.notifications`)) ?? undefined,
        20_000,
      );
      // The mail server comes back: a worker that can reach it takes over.
      await worker.stop();
      ({ worker, container } = await startTestWorker({
        ...env,
        SMTP_PORT: Number(process.env.TEST_SMTP_PORT ?? "1025"),
      }));
      const replayQueue = new Queue<DeadLetter>("dead-letter", {
        connection: container.producer,
        prefix: env.QUEUE_PREFIX,
      });
      try {
        expect(
          await replayDeadLetters(
            replayQueue,
            container.producer,
            env.QUEUE_PREFIX,
            {
              jobId: `${eventId}.notifications`,
            },
          ),
        ).toEqual([`${eventId}.notifications`]);
        expect(
          (await deadLettersIn(replayQueue)).map((letter) => letter.jobId),
        ).not.toContain(`${eventId}.notifications`);
      } finally {
        await replayQueue.close();
      }
    } finally {
      await queue.close().catch(() => undefined);
    }

    const emails = await eventually(async () => {
      const found = await emailsTo(customer.email);
      return found.length > 0 ? found : undefined;
    });
    expect(emails).toHaveLength(1);
    const [delivery] = await asOwner<{ status: string }>(
      database,
      "SELECT status FROM notification_deliveries WHERE event_id = $1",
      [eventId],
    );
    expect(delivery?.status).toBe("sent");
  });
});

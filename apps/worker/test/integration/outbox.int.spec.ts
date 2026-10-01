import { randomUUID } from "node:crypto";

import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDb, createPool, type Pool } from "@dsd/db";

import {
  type OutboxJob,
  OutboxDispatcher,
} from "../../src/outbox/dispatcher.js";
import {
  capturedLogger,
  closedPort,
  fixtures,
  testEnv,
} from "../support/worker.js";

/**
 * The outbox dispatcher (ADR-0005, section 3) against real PostgreSQL and
 * Redis: rows reach the right queue with job IDs made from the event,
 * every row is marked dispatched, concurrent dispatchers never take the
 * same row, and a Redis outage leaves the rows to be dispatched later.
 */
describe("outbox dispatcher", () => {
  let database: TestDatabase;
  let pool: Pool;
  let redis: Redis;
  let queues: {
    notifications: Queue<OutboxJob>;
    maintenance: Queue<OutboxJob>;
  };
  const { logger } = capturedLogger();

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_outbox");
    const env = testEnv(database);
    pool = createPool({
      connectionString: env.DATABASE_URL,
      applicationName: "test",
      onError: () => undefined,
    });
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const prefix = env.QUEUE_PREFIX;
    queues = {
      notifications: new Queue("notifications", { connection: redis, prefix }),
      maintenance: new Queue("maintenance", { connection: redis, prefix }),
    };
  });

  afterEach(async () => {
    // Each test starts from an empty outbox and empty queues.
    await asOwner(database, "DELETE FROM outbox_events");
    await queues.notifications.obliterate({ force: true });
  });

  afterAll(async () => {
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
    redis.disconnect();
    await pool.end();
    await database.drop();
  });

  const dispatcher = (
    overrides: { queues?: typeof queues; batchSize?: number } = {},
  ) =>
    new OutboxDispatcher(pool, overrides.queues ?? queues, logger, {
      intervalMs: 50,
      batchSize: overrides.batchSize,
    });

  const pending = async () => {
    const [row] = await asOwner<{ n: number }>(
      database,
      "SELECT count(*)::int AS n FROM outbox_events WHERE dispatched_at IS NULL",
    );
    return row?.n ?? -1;
  };

  it("puts events on their queue with an ID made from the event, and marks every row dispatched", async () => {
    const customer = await fixtures.customer(database);
    const ticket = await fixtures.ticket(database, customer.id);
    const created = await fixtures.event(
      database,
      "ticket.created",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, customerId: customer.id },
    );
    const assigned = await fixtures.event(
      database,
      "ticket.assigned",
      { type: "ticket", id: ticket.id },
      { ticketId: ticket.id, fromAgentId: null, toAgentId: null },
    );

    expect(await dispatcher().dispatchOnce()).toBe(2);

    const job = await queues.notifications.getJob(`${created}.notifications`);
    expect(job?.name).toBe("ticket.created");
    expect(job?.data).toEqual({
      eventId: created,
      type: "ticket.created",
      payload: { ticketId: ticket.id, customerId: customer.id },
    });
    // No consumer for assignments yet: dispatched, but no job anywhere.
    expect(
      await queues.notifications.getJob(`${assigned}.notifications`),
    ).toBeUndefined();
    expect(await queues.notifications.getJobCounts("waiting")).toEqual({
      waiting: 1,
    });
    expect(await pending()).toBe(0);
  });

  it("adds nothing twice when a row is dispatched again", async () => {
    const customer = await fixtures.customer(database);
    const id = await fixtures.event(
      database,
      "customer.signup_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    await dispatcher().dispatchOnce();
    // As if the process had died after adding the job but before committing.
    await asOwner(
      database,
      "UPDATE outbox_events SET dispatched_at = NULL WHERE id = $1",
      [id],
    );
    await dispatcher().dispatchOnce();
    expect(await queues.notifications.getJobCounts("waiting")).toEqual({
      waiting: 1,
    });
  });

  it("never lets two dispatchers take the same row", async () => {
    const customer = await fixtures.customer(database);
    const total = 300;
    await asOwner(
      database,
      `INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload)
       SELECT 'customer.signup_requested', 'customer', $1::uuid, jsonb_build_object('customerId', $1::text)
         FROM generate_series(1, $2)`,
      [customer.id, total],
    );
    const counts = { first: 0, second: 0 };
    const drain = async (key: keyof typeof counts) => {
      const own = dispatcher({ batchSize: 25 });
      for (;;) {
        const handled = await own.dispatchOnce();
        if (handled === 0) return;
        counts[key] += handled;
      }
    };
    await Promise.all([drain("first"), drain("second")]);
    expect(counts.first + counts.second).toBe(total);
    expect(counts.first).toBeGreaterThan(0);
    expect(counts.second).toBeGreaterThan(0);
    expect(await queues.notifications.getJobCounts("waiting")).toEqual({
      waiting: total,
    });
    expect(await pending()).toBe(0);
  });

  it("leaves rows pending while Redis is down, and dispatches them once it is back", async () => {
    const customer = await fixtures.customer(database);
    await fixtures.event(
      database,
      "customer.signup_requested",
      { type: "customer", id: customer.id },
      { customerId: customer.id },
    );
    const dead = new Redis(`redis://127.0.0.1:${await closedPort()}`, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    dead.on("error", () => undefined);
    const prefix = `outage-${randomUUID()}`;
    const unreachable = {
      notifications: new Queue<OutboxJob>("notifications", {
        connection: dead,
        prefix,
      }),
      maintenance: new Queue<OutboxJob>("maintenance", {
        connection: dead,
        prefix,
      }),
    };
    try {
      await expect(
        dispatcher({ queues: unreachable }).dispatchOnce(),
      ).rejects.toThrow();
      expect(await pending()).toBe(1);
    } finally {
      dead.disconnect();
    }

    expect(await dispatcher().dispatchOnce()).toBe(1);
    expect(await pending()).toBe(0);
  });

  it("keeps polling on its own, and stops cleanly", async () => {
    const running = dispatcher();
    running.start();
    try {
      const customer = await fixtures.customer(database);
      await fixtures.event(
        database,
        "customer.signup_requested",
        { type: "customer", id: customer.id },
        { customerId: customer.id },
      );
      const deadline = Date.now() + 5_000;
      while ((await pending()) > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(await pending()).toBe(0);
    } finally {
      await running.stop();
    }
  });

  it("reads the worker's own role through the same pool", async () => {
    const { rows } = await createDb(pool).execute<{ role: string }>(
      "SELECT current_user AS role",
    );
    expect(rows[0]?.role).toBe("dsd_worker");
  });
});

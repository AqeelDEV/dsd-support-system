import type { Pool } from "@dsd/db";
import { type DomainEvent, domainEventSchema } from "@dsd/shared";
import type { Queue } from "bullmq";

import type { Logger } from "../logger.js";
import type { WorkQueue } from "../queues/queues.js";
import { jobOptionsFor, queuesFor } from "./routes.js";

/** What a queued job carries: the outbox row, IDs and small facts only. */
export interface OutboxJob {
  eventId: string;
  type: DomainEvent;
  payload: Record<string, unknown>;
}

interface OutboxRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
}

export interface DispatcherOptions {
  intervalMs: number;
  /** Rows per transaction (ADR-0005, section 3). */
  batchSize?: number;
  /** How long a customer's message waits before its suggestion is drafted; 0 if unset. */
  aiDebounceMs?: number;
}

/**
 * Moves outbox rows onto their queues (ADR-0005, section 3). Each tick, in
 * one transaction: lock up to a batch of undispatched rows with
 * `FOR UPDATE SKIP LOCKED`, add one job per row and consuming queue, mark
 * the rows dispatched, commit. `SKIP LOCKED` lets several workers dispatch
 * at once without taking the same rows.
 *
 * If Redis is unreachable, adding the jobs fails, the transaction rolls
 * back and the rows wait for the next tick: an outage delays work and
 * never loses it. If the process dies after adding jobs but before
 * committing, the rows are dispatched again; the job IDs are derived from
 * the event, so BullMQ ignores the repeats, and handlers are idempotent
 * for anything that slips through. Delivery is at least once.
 */
export class OutboxDispatcher {
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private readonly batchSize: number;

  constructor(
    private readonly pool: Pool,
    private readonly queues: Readonly<Record<WorkQueue, Queue<OutboxJob>>>,
    private readonly logger: Logger,
    private readonly options: DispatcherOptions,
  ) {
    this.batchSize = options.batchSize ?? 100;
  }

  /** Dispatches one batch; returns how many outbox rows it handled. */
  async dispatchOnce(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, event_type, payload FROM outbox_events
          WHERE dispatched_at IS NULL
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );
      const jobs = new Map<WorkQueue, OutboxJob[]>();
      for (const row of rows) {
        const type = domainEventSchema.safeParse(row.event_type);
        if (!type.success) {
          // Nothing consumes an unknown event; keeping it would block nothing
          // but would sit in the outbox for ever.
          this.logger.warn(
            { eventId: row.id, eventType: row.event_type },
            "outbox event of an unknown type, marked dispatched",
          );
          continue;
        }
        for (const queue of queuesFor(type.data, row.payload)) {
          const list = jobs.get(queue) ?? [];
          list.push({ eventId: row.id, type: type.data, payload: row.payload });
          jobs.set(queue, list);
        }
      }
      for (const [queue, list] of jobs) {
        await this.queues[queue].addBulk(
          list.map((job) => ({
            name: job.type,
            data: job,
            opts: jobOptionsFor(queue, job, this.options.aiDebounceMs ?? 0),
          })),
        );
      }
      if (rows.length > 0) {
        await client.query(
          "UPDATE outbox_events SET dispatched_at = now() WHERE id = ANY($1::uuid[])",
          [rows.map((row) => row.id)],
        );
      }
      await client.query("COMMIT");
      if (rows.length > 0) {
        this.logger.debug({ events: rows.length }, "outbox events dispatched");
      }
      return rows.length;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Polls until `stop`. A full batch is followed at once by the next. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }

  private isRunning(): boolean {
    return this.running;
  }

  private async run(): Promise<void> {
    while (this.running) {
      let handled = 0;
      try {
        handled = await this.dispatchOnce();
      } catch (error) {
        this.logger.warn(
          { reason: error instanceof Error ? error.message : String(error) },
          "outbox dispatch failed; the events wait for the next tick",
        );
      }
      // stop() may have run while the batch was in flight.
      if (handled < this.batchSize && this.isRunning()) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, this.options.intervalMs);
          this.wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    }
  }
}

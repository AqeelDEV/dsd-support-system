import { Injectable } from "@nestjs/common";
import { outboxEvents } from "@dsd/db/schema";
import type { DomainEvent } from "@dsd/shared";

import type { Executor } from "../../infrastructure/database.js";

export interface OutboxEvent {
  type: DomainEvent;
  aggregateType: "customer" | "ticket" | "agent" | "kb_article";
  aggregateId: string;
  /** IDs and small facts only: never message bodies or email addresses. */
  payload: Record<string, string | number | boolean | null>;
}

/**
 * Writes domain events to the outbox (ADR-0005). It always runs inside the
 * caller's transaction, so the event commits with the change it describes
 * or not at all. The API can only insert here; the worker dispatches.
 */
@Injectable()
export class OutboxRepository {
  async add(executor: Executor, event: OutboxEvent): Promise<void> {
    await executor.insert(outboxEvents).values({
      eventType: event.type,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
    });
  }
}

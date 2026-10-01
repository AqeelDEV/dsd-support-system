import { Injectable } from "@nestjs/common";
import { auditEvents } from "@dsd/db/schema";
import {
  type AuditAction,
  type TicketStatus,
  ticketStatusSchema,
} from "@dsd/shared";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

/** Who made a change. */
export type Actor =
  { type: "customer"; customerId: string } | { type: "agent"; agentId: string };

/** Who made a change and in which request, for every audit event it writes. */
export interface ChangeContext {
  actor: Actor;
  /** The request's ID, which links the event to the API's logs. */
  requestId: string;
}

/** One change, with only the fields that changed (ADR-0008, section 3). */
export interface AuditEntry {
  ticketId: string;
  entityType: "ticket" | "message" | "attachment";
  entityId: string;
  action: AuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/**
 * The immutable history (FR-18). Events are always written inside the
 * caller's transaction, so a change and its record commit together or not
 * at all; the table itself refuses updates and deletes. Message bodies are
 * never copied here: the message row is its own record.
 */
@Injectable()
export class AuditRepository {
  async record(
    executor: Executor,
    context: ChangeContext,
    entries: readonly AuditEntry[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const { actor } = context;
    await executor.insert(auditEvents).values(
      entries.map((entry) => ({
        ticketId: entry.ticketId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actorType: actor.type,
        actorCustomerId: actor.type === "customer" ? actor.customerId : null,
        actorAgentId: actor.type === "agent" ? actor.agentId : null,
        before: entry.before,
        after: entry.after,
        requestId: context.requestId,
      })),
    );
  }

  /**
   * Each status change on a ticket, oldest first, for the customer's
   * timeline (ADR-0007, section 7). Only the new status and the time: who
   * made the change stays with the staff history.
   */
  async statusChanges(
    executor: Executor,
    ticketId: string,
  ): Promise<{ status: TicketStatus; at: Date }[]> {
    const rows = await executor
      .select({
        status: sql<string>`${auditEvents.after} ->> 'status'`,
        at: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.ticketId, ticketId),
          eq(auditEvents.action, "ticket.status_changed"),
        ),
      )
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
    return rows.map((row) => ({
      status: ticketStatusSchema.parse(row.status),
      at: row.at,
    }));
  }
}

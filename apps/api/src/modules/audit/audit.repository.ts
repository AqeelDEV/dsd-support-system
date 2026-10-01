import { Injectable } from "@nestjs/common";
import { agents, auditEvents, customers } from "@dsd/db/schema";
import {
  type ActorType,
  type AuditAction,
  type TicketStatus,
  ticketStatusSchema,
} from "@dsd/shared";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

/** One audit event as staff read it, with who made it. */
export interface HistoryEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorType: ActorType;
  actorId: string | null;
  actorName: string | null;
  before: unknown;
  after: unknown;
  requestId: string;
  createdAt: Date;
  /** `created_at` to the microsecond, for cursors. */
  cursorAt: string;
}

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

  /**
   * One page of a ticket's history, oldest first (FR-18), with one extra
   * row to show whether another page follows.
   */
  async ticketHistory(
    executor: Executor,
    ticketId: string,
    page: { limit: number; after: { at: string; id: string } | undefined },
  ): Promise<HistoryEntry[]> {
    const after: SQL | undefined =
      page.after === undefined
        ? undefined
        : sql`(${auditEvents.createdAt}, ${auditEvents.id}) > (${page.after.at}::timestamptz, ${page.after.id}::uuid)`;
    const rows = await executor
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        actorType: auditEvents.actorType,
        actorAgentId: auditEvents.actorAgentId,
        actorCustomerId: auditEvents.actorCustomerId,
        agentName: agents.displayName,
        customerName: customers.displayName,
        before: auditEvents.before,
        after: auditEvents.after,
        requestId: auditEvents.requestId,
        createdAt: auditEvents.createdAt,
        cursorAt: sql<string>`to_char(${auditEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(auditEvents)
      .leftJoin(agents, eq(agents.id, auditEvents.actorAgentId))
      .leftJoin(customers, eq(customers.id, auditEvents.actorCustomerId))
      .where(and(eq(auditEvents.ticketId, ticketId), after))
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
      .limit(page.limit + 1);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      actorType: row.actorType,
      actorId: row.actorAgentId ?? row.actorCustomerId,
      actorName: row.actorType === "agent" ? row.agentName : row.customerName,
      before: row.before,
      after: row.after,
      requestId: row.requestId,
      createdAt: row.createdAt,
      cursorAt: row.cursorAt,
    }));
  }
}

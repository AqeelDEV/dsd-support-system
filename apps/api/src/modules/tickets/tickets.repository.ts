import { Injectable } from "@nestjs/common";
import {
  agentBrandMemberships,
  agents,
  brands,
  customers,
  tickets,
} from "@dsd/db/schema";
import type {
  AgentRole,
  QueueSort,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from "@dsd/shared";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Executor } from "../../infrastructure/database.js";
import type { Position } from "../../common/cursor.js";
import type { TimestampChange } from "./domain/ticket-status.js";

/** The tickets a customer session may see: the customer's own, or a guest's one. */
export interface CustomerScope {
  customerId: string;
  guestTicketId: string | null;
}

/**
 * `created_at` exactly as stored, to the microsecond, for cursors: a
 * JavaScript Date keeps only milliseconds, which would skip or repeat rows
 * created within the same millisecond.
 */
export const exactCreatedAt = sql<string>`to_char(${tickets.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Brand scope for staff (ADR-0004, section 6): only tickets in a brand the
 * agent belongs to. v1 has one brand, so this always passes in normal use;
 * tests prove it with a second one.
 */
function inBrandsOf(agentId: string): SQL {
  return inArray(
    tickets.brandId,
    sql`(SELECT ${agentBrandMemberships.brandId} FROM ${agentBrandMemberships} WHERE ${agentBrandMemberships.agentId} = ${agentId})`,
  );
}

const assignee = alias(agents, "assignee");
const escalatedBy = alias(agents, "escalated_by");

/** What a queue row shows: enough to triage without opening the ticket. */
const summaryColumns = {
  id: tickets.id,
  reference: tickets.reference,
  subject: tickets.subject,
  status: tickets.status,
  priority: tickets.priority,
  channel: tickets.channel,
  customer: {
    id: customers.id,
    email: customers.email,
    displayName: customers.displayName,
  },
  assignee: { id: assignee.id, displayName: assignee.displayName },
  contactVerifiedAt: tickets.contactVerifiedAt,
  escalatedAt: tickets.escalatedAt,
  firstResponseAt: tickets.firstResponseAt,
  createdAt: tickets.createdAt,
  updatedAt: tickets.updatedAt,
  cursorAt: exactCreatedAt,
};

/** Where one queue page starts: after the last row of the previous one. */
export type QueuePosition =
  | { sort: "priority"; keys: [TicketPriority, string]; id: string }
  | { sort: "oldest" | "newest"; keys: [string]; id: string };

export interface QueueFilters {
  statuses: readonly TicketStatus[];
  priorities: readonly TicketPriority[] | undefined;
  /** An agent ID, or null for unassigned tickets. */
  assigneeId: string | null | undefined;
  escalated: boolean | undefined;
}

function queueOrder(sort: QueueSort) {
  switch (sort) {
    case "priority":
      return [desc(tickets.priority), asc(tickets.createdAt), asc(tickets.id)];
    case "oldest":
      return [asc(tickets.createdAt), asc(tickets.id)];
    case "newest":
      return [desc(tickets.createdAt), desc(tickets.id)];
  }
}

/** Rows after `position` in the order `queueOrder` gives. */
function afterPosition(position: QueuePosition): SQL {
  const row = sql`(${tickets.createdAt}, ${tickets.id})`;
  const at = position.keys[position.sort === "priority" ? 1 : 0];
  const key = sql`(${at}::timestamptz, ${position.id}::uuid)`;
  switch (position.sort) {
    case "priority": {
      const priority = sql`${position.keys[0]}::ticket_priority`;
      return sql`(${tickets.priority} < ${priority} OR (${tickets.priority} = ${priority} AND ${row} > ${key}))`;
    }
    case "oldest":
      return sql`${row} > ${key}`;
    case "newest":
      return sql`${row} < ${key}`;
  }
}

function ownedBy(scope: CustomerScope): SQL | undefined {
  return and(
    eq(tickets.customerId, scope.customerId),
    scope.guestTicketId === null
      ? undefined
      : eq(tickets.id, scope.guestTicketId),
  );
}

/** A ticket row locked for the rest of the transaction, with what the rules need. */
export interface LockedTicket {
  id: string;
  brandId: string;
  customerId: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeAgentId: string | null;
  escalatedAt: Date | null;
}

const lockedColumns = {
  id: tickets.id,
  brandId: tickets.brandId,
  customerId: tickets.customerId,
  status: tickets.status,
  priority: tickets.priority,
  assigneeAgentId: tickets.assigneeAgentId,
  escalatedAt: tickets.escalatedAt,
};

const timestamp = (change: TimestampChange) =>
  change === "set" ? sql`now()` : change === "clear" ? null : undefined;

export interface NewTicket {
  brandId: string;
  customerId: string;
  channel: TicketChannel;
  subject: string;
  description: string;
  /** The submitter has already proven they own the email (a signed-in customer). */
  contactVerified: boolean;
}

/**
 * Ticket rows. Customer-realm reads take the session's customer (and guest
 * ticket) and filter on them in SQL; staff reads take the agent and filter
 * by their brands. Neither can return a row its caller may not see.
 */
@Injectable()
export class TicketsRepository {
  /** The brand named in configuration; a missing one is a deployment error. */
  async brandIdBySlug(executor: Executor, slug: string): Promise<string> {
    const [row] = await executor
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.slug, slug));
    if (row === undefined) {
      throw new Error(`TICKET_BRAND_SLUG names no brand: ${slug}`);
    }
    return row.id;
  }

  /**
   * One page of a customer's tickets, newest first, with one extra row to
   * show whether another page follows.
   */
  async customerPage(
    executor: Executor,
    scope: CustomerScope,
    page: { limit: number; after: Position<[string]> | undefined },
  ) {
    const after = page.after;
    return executor
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        status: tickets.status,
        createdAt: tickets.createdAt,
        cursorAt: exactCreatedAt,
      })
      .from(tickets)
      .where(
        and(
          ownedBy(scope),
          after === undefined
            ? undefined
            : sql`(${tickets.createdAt}, ${tickets.id}) < (${after.keys[0]}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(page.limit + 1);
  }

  /** The ticket if this customer session may see it; undefined otherwise, whether or not it exists. */
  async customerTicket(
    executor: Executor,
    scope: CustomerScope,
    ticketId: string,
  ) {
    const [row] = await executor
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        description: tickets.description,
        status: tickets.status,
        createdAt: tickets.createdAt,
      })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), ownedBy(scope)));
    return row;
  }

  /**
   * Locks one of the customer's tickets (`SELECT ... FOR UPDATE`) until the
   * transaction ends, so two changes to it run one after the other and the
   * second sees the first (ADR-0007, section 2).
   */
  async lockForCustomer(
    executor: Executor,
    scope: CustomerScope,
    ticketId: string,
  ): Promise<LockedTicket | undefined> {
    const [row] = await executor
      .select(lockedColumns)
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), ownedBy(scope)))
      .for("update");
    return row;
  }

  /**
   * One page of the staff queue (FR-7), in the agent's brands, with one
   * extra row to show whether another page follows. The filters and sort
   * orders match the queue indexes in DATA_MODEL.md.
   */
  async queuePage(
    executor: Executor,
    agentId: string,
    filters: QueueFilters,
    sort: QueueSort,
    page: { limit: number; after: QueuePosition | undefined },
  ) {
    return executor
      .select(summaryColumns)
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeAgentId))
      .where(
        and(
          inBrandsOf(agentId),
          inArray(tickets.status, [...filters.statuses]),
          filters.priorities === undefined
            ? undefined
            : inArray(tickets.priority, [...filters.priorities]),
          filters.assigneeId === undefined
            ? undefined
            : filters.assigneeId === null
              ? isNull(tickets.assigneeAgentId)
              : eq(tickets.assigneeAgentId, filters.assigneeId),
          filters.escalated === undefined
            ? undefined
            : filters.escalated
              ? isNotNull(tickets.escalatedAt)
              : isNull(tickets.escalatedAt),
          page.after === undefined ? undefined : afterPosition(page.after),
        ),
      )
      .orderBy(...queueOrder(sort))
      .limit(page.limit + 1);
  }

  /** A customer's tickets in the agent's brands, newest first (FR-8). */
  async customerTicketsForStaff(
    executor: Executor,
    agentId: string,
    customerId: string,
    page: { limit: number; after: Position<[string]> | undefined },
  ) {
    const after = page.after;
    return executor
      .select(summaryColumns)
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeAgentId))
      .where(
        and(
          inBrandsOf(agentId),
          eq(tickets.customerId, customerId),
          after === undefined
            ? undefined
            : sql`(${tickets.createdAt}, ${tickets.id}) < (${after.keys[0]}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(page.limit + 1);
  }

  /**
   * The customer, if they have a ticket in one of the agent's brands.
   * Customers aren't brand-owned, so that is what makes one visible.
   */
  async customerForStaff(
    executor: Executor,
    agentId: string,
    customerId: string,
  ) {
    const [row] = await executor
      .select({
        id: customers.id,
        email: customers.email,
        displayName: customers.displayName,
        hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
        createdAt: customers.createdAt,
      })
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          exists(
            executor
              .select({ id: tickets.id })
              .from(tickets)
              .where(
                and(eq(tickets.customerId, customers.id), inBrandsOf(agentId)),
              ),
          ),
        ),
      );
    return row;
  }

  /** The whole ticket for staff, if it is in one of the agent's brands. */
  async staffTicket(executor: Executor, agentId: string, ticketId: string) {
    const [row] = await executor
      .select({
        ...summaryColumns,
        description: tickets.description,
        hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
        assigneeAgentId: tickets.assigneeAgentId,
        escalatedBy: {
          id: escalatedBy.id,
          displayName: escalatedBy.displayName,
        },
        resolvedAt: tickets.resolvedAt,
        closedAt: tickets.closedAt,
      })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeAgentId))
      .leftJoin(escalatedBy, eq(escalatedBy.id, tickets.escalatedByAgentId))
      .where(and(eq(tickets.id, ticketId), inBrandsOf(agentId)));
    return row;
  }

  /** Locks a ticket in the agent's brands for the rest of the transaction. */
  async lockForStaff(
    executor: Executor,
    agentId: string,
    ticketId: string,
  ): Promise<LockedTicket | undefined> {
    const [row] = await executor
      .select(lockedColumns)
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), inBrandsOf(agentId)))
      .for("update");
    return row;
  }

  /**
   * Locks the `open` and `pending_customer` tickets assigned to `agentId`,
   * in every brand, for unassigning them when the agent is deactivated
   * (ADR-0007, section 5). Tickets are locked in ID order, the same order
   * whichever request takes them, so two such requests can't deadlock.
   */
  async lockOpenAssignedTo(
    executor: Executor,
    agentId: string,
  ): Promise<{ id: string; assigneeAgentId: string | null }[]> {
    return executor
      .select({ id: tickets.id, assigneeAgentId: tickets.assigneeAgentId })
      .from(tickets)
      .where(
        and(
          eq(tickets.assigneeAgentId, agentId),
          inArray(tickets.status, ["open", "pending_customer"]),
        ),
      )
      .orderBy(asc(tickets.id))
      .for("update");
  }

  /** Whether the ticket is in one of the agent's brands, without locking it. */
  async visibleToStaff(
    executor: Executor,
    agentId: string,
    ticketId: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), inBrandsOf(agentId)));
    return row !== undefined;
  }

  /** Records the first public agent reply; later ones leave it as it was (ADR-0007, section 3). */
  async markFirstResponse(executor: Executor, ticketId: string): Promise<void> {
    await executor
      .update(tickets)
      .set({
        firstResponseAt: sql`coalesce(${tickets.firstResponseAt}, now())`,
      })
      .where(eq(tickets.id, ticketId));
  }

  async setPriority(
    executor: Executor,
    ticketId: string,
    priority: TicketPriority,
  ): Promise<void> {
    await executor
      .update(tickets)
      .set({ priority })
      .where(eq(tickets.id, ticketId));
  }

  async setAssignee(
    executor: Executor,
    ticketId: string,
    assigneeAgentId: string | null,
  ): Promise<void> {
    await executor
      .update(tickets)
      .set({ assigneeAgentId })
      .where(eq(tickets.id, ticketId));
  }

  /**
   * The agent, if they can be given tickets in `brandId`: active, and a
   * member of the brand (ADR-0007, section 5).
   */
  async assignableAgent(
    executor: Executor,
    agentId: string,
    brandId: string,
  ): Promise<{ id: string; role: AgentRole } | undefined> {
    const [row] = await executor
      .select({ id: agents.id, role: agents.role })
      .from(agents)
      .innerJoin(
        agentBrandMemberships,
        and(
          eq(agentBrandMemberships.agentId, agents.id),
          eq(agentBrandMemberships.brandId, brandId),
        ),
      )
      .where(and(eq(agents.id, agentId), isNull(agents.deactivatedAt)))
      // Holds the agent's row until the assignment commits, so a
      // deactivation or role change running at the same moment waits for
      // it, and then finds and unassigns this ticket too.
      .for("share", { of: agents });
    return row;
  }

  /** Records who escalated the ticket and when; a later escalation replaces both. */
  async markEscalated(
    executor: Executor,
    ticketId: string,
    agentId: string,
  ): Promise<void> {
    await executor
      .update(tickets)
      .set({ escalatedAt: sql`now()`, escalatedByAgentId: agentId })
      .where(eq(tickets.id, ticketId));
  }

  /** The new status, with the lifecycle timestamps it moves. */
  async setStatus(
    executor: Executor,
    ticketId: string,
    status: TicketStatus,
    changes: { resolvedAt: TimestampChange; closedAt: TimestampChange },
  ): Promise<void> {
    await executor
      .update(tickets)
      .set({
        status,
        resolvedAt: timestamp(changes.resolvedAt),
        closedAt: timestamp(changes.closedAt),
      })
      .where(eq(tickets.id, ticketId));
  }

  /** A new open ticket. The database builds its reference from the brand's prefix. */
  async insert(executor: Executor, ticket: NewTicket) {
    const [row] = await executor
      .insert(tickets)
      .values({
        brandId: ticket.brandId,
        customerId: ticket.customerId,
        channel: ticket.channel,
        subject: ticket.subject,
        description: ticket.description,
        contactVerifiedAt: ticket.contactVerified ? sql`now()` : null,
      })
      .returning({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        status: tickets.status,
        priority: tickets.priority,
        channel: tickets.channel,
        createdAt: tickets.createdAt,
      });
    if (row === undefined) throw new Error("ticket insert returned nothing");
    return row;
  }
}

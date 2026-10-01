import { Injectable } from "@nestjs/common";
import { brands, tickets } from "@dsd/db/schema";
import type { TicketChannel } from "@dsd/shared";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";
import type { Position } from "./domain/cursor.js";

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

function ownedBy(scope: CustomerScope): SQL | undefined {
  return and(
    eq(tickets.customerId, scope.customerId),
    scope.guestTicketId === null
      ? undefined
      : eq(tickets.id, scope.guestTicketId),
  );
}

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

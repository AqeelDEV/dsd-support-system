import { Injectable } from "@nestjs/common";
import { brands, tickets } from "@dsd/db/schema";
import type { TicketChannel } from "@dsd/shared";
import { eq, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

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

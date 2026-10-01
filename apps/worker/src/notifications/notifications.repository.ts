import type { Database } from "@dsd/db";
import {
  agentBrandMemberships,
  agents,
  brands,
  customers,
  outboxEvents,
  publicReplyBodies,
  tickets,
} from "@dsd/db/schema";
import { ticketStatusSchema, type TicketStatus } from "@dsd/shared";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Sender } from "./channel.js";

export interface TicketForEmail {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  brand: { name: string; supportEmail: string };
  customer: { id: string; email: string; hasAccount: boolean };
}

const senderOf = (brand: { name: string; supportEmail: string }): Sender => ({
  name: `${brand.name} Support`,
  address: brand.supportEmail,
});

/**
 * What notifications read. The worker's role can read tickets, customers,
 * agents and brands, and message text only through `public_reply_bodies`:
 * this class has no way to reach an internal note (ADR-0006, ADR-0008).
 * Handlers always read current rows, never copies from the event.
 */
export class NotificationsRepository {
  constructor(private readonly db: Database) {}

  async ticket(ticketId: string): Promise<TicketForEmail | undefined> {
    const [row] = await this.db
      .select({
        id: tickets.id,
        reference: tickets.reference,
        subject: tickets.subject,
        status: tickets.status,
        brand: { name: brands.name, supportEmail: brands.supportEmail },
        customer: {
          id: customers.id,
          email: customers.email,
          hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
        },
      })
      .from(tickets)
      .innerJoin(brands, eq(brands.id, tickets.brandId))
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .where(eq(tickets.id, ticketId));
    return row;
  }

  /** A public agent reply and its author's name; undefined for anything else. */
  async publicReply(
    messageId: string,
  ): Promise<{ body: string; agentName: string } | undefined> {
    const [row] = await this.db
      .select({ body: publicReplyBodies.body, agentName: agents.displayName })
      .from(publicReplyBodies)
      .innerJoin(agents, eq(agents.id, publicReplyBodies.authorAgentId))
      .where(eq(publicReplyBodies.id, messageId));
    return row;
  }

  /**
   * The status a reply moved its ticket to, if it did: the change was
   * written in the same transaction as the reply, with the reply's ID, so
   * one email can mention both (ADR-0005, section 7).
   */
  async statusSetBy(messageId: string): Promise<TicketStatus | null> {
    const [row] = await this.db
      .select({ toStatus: sql<string>`${outboxEvents.payload} ->> 'toStatus'` })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, "ticket.status_changed"),
          sql`${outboxEvents.payload} ->> 'messageId' = ${messageId}`,
        ),
      );
    return row === undefined ? null : ticketStatusSchema.parse(row.toStatus);
  }

  async customer(
    customerId: string,
  ): Promise<{ id: string; email: string; hasAccount: boolean } | undefined> {
    const [row] = await this.db
      .select({
        id: customers.id,
        email: customers.email,
        hasAccount: sql<boolean>`${customers.passwordHash} IS NOT NULL`,
      })
      .from(customers)
      .where(eq(customers.id, customerId));
    return row;
  }

  async agent(agentId: string) {
    const [row] = await this.db
      .select({
        id: agents.id,
        email: agents.email,
        displayName: agents.displayName,
        active: sql<boolean>`${agents.deactivatedAt} IS NULL`,
        hasPassword: sql<boolean>`${agents.passwordHash} IS NOT NULL`,
      })
      .from(agents)
      .where(eq(agents.id, agentId));
    return row;
  }

  /** The brand by slug: the sender of emails that aren't about a ticket. */
  async brandSender(slug: string): Promise<{ sender: Sender; name: string }> {
    const [row] = await this.db
      .select({ name: brands.name, supportEmail: brands.supportEmail })
      .from(brands)
      .where(eq(brands.slug, slug));
    if (row === undefined) {
      throw new Error(`TICKET_BRAND_SLUG names no brand: ${slug}`);
    }
    return { sender: senderOf(row), name: row.name };
  }

  /** The first brand an agent works in, which sends their invite. */
  async agentBrand(
    agentId: string,
  ): Promise<{ sender: Sender; name: string } | undefined> {
    const [row] = await this.db
      .select({ name: brands.name, supportEmail: brands.supportEmail })
      .from(agentBrandMemberships)
      .innerJoin(brands, eq(brands.id, agentBrandMemberships.brandId))
      .where(eq(agentBrandMemberships.agentId, agentId))
      .orderBy(asc(brands.name))
      .limit(1);
    return row === undefined
      ? undefined
      : { sender: senderOf(row), name: row.name };
  }
}

export { senderOf };

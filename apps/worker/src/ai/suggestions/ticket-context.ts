import type { Database } from "@dsd/db";
import {
  customers,
  publicCustomerMessages,
  publicReplyBodies,
  tickets,
} from "@dsd/db/schema";
import type { TicketStatus } from "@dsd/shared";
import { asc, eq } from "drizzle-orm";

export interface TicketContext {
  ticketId: string;
  brandId: string;
  status: TicketStatus;
  subject: string;
  description: string;
  customerName: string | null;
  /** The public conversation after the description, oldest first. */
  conversation: { from: "customer" | "agent"; body: string; at: Date }[];
}

/**
 * What a suggestion is drafted from: the ticket and its public
 * conversation. The worker can't read `messages`, so the conversation
 * comes from the two views of public text: what customers wrote and what
 * agents sent them (ADR-0006, amended). An internal note can't reach a
 * prompt by any query in this class, or any other.
 */
export class TicketContextRepository {
  constructor(private readonly db: Database) {}

  async load(ticketId: string): Promise<TicketContext | undefined> {
    const [ticket] = await this.db
      .select({
        ticketId: tickets.id,
        brandId: tickets.brandId,
        status: tickets.status,
        subject: tickets.subject,
        description: tickets.description,
        customerName: customers.displayName,
      })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .where(eq(tickets.id, ticketId));
    if (ticket === undefined) return undefined;

    const [fromCustomer, fromAgents] = await Promise.all([
      this.db
        .select({
          id: publicCustomerMessages.id,
          body: publicCustomerMessages.body,
          at: publicCustomerMessages.createdAt,
        })
        .from(publicCustomerMessages)
        .where(eq(publicCustomerMessages.ticketId, ticketId))
        .orderBy(asc(publicCustomerMessages.createdAt)),
      this.db
        .select({
          id: publicReplyBodies.id,
          body: publicReplyBodies.body,
          at: publicReplyBodies.createdAt,
        })
        .from(publicReplyBodies)
        .where(eq(publicReplyBodies.ticketId, ticketId))
        .orderBy(asc(publicReplyBodies.createdAt)),
    ]);
    const conversation = [
      ...fromCustomer.map((message) => ({
        ...message,
        from: "customer" as const,
      })),
      ...fromAgents.map((message) => ({ ...message, from: "agent" as const })),
    ]
      .sort(
        (a, b) =>
          a.at.getTime() - b.at.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map(({ from, body, at }) => ({ from, body, at }));

    return { ...ticket, conversation };
  }
}

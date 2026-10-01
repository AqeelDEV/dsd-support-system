import { Inject, Injectable } from "@nestjs/common";
import type { CustomerReplyFields, CustomerTicket } from "@dsd/shared";

import type { CustomerPrincipal } from "../../auth/principal.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { AttachmentIntake } from "../attachments/attachment-intake.js";
import type { Submission } from "../attachments/multipart.js";
import type { ChangeContext } from "../audit/audit.repository.js";
import { statusAfterCustomerReply } from "./domain/ticket-status.js";
import { TicketChanges } from "./ticket-changes.js";
import {
  scopeOf,
  TicketQueriesService,
  ticketNotFound,
} from "./ticket-queries.service.js";
import { TicketsRepository } from "./tickets.repository.js";

/**
 * Replies and internal notes (FR-3, FR-8, FR-10). Each request checks the
 * caller can see the ticket before reading any uploaded file, then stores
 * the files, then writes the message under a lock on the ticket row, where
 * the state checks happen against the ticket as it really is.
 */
@Injectable()
export class TicketMessagesService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly tickets: TicketsRepository,
    private readonly changes: TicketChanges,
    private readonly intake: AttachmentIntake,
    private readonly queries: TicketQueriesService,
  ) {}

  /**
   * A customer's reply, guests included on their own ticket. It reopens a
   * ticket that was waiting on the customer or resolved, so a reply is never
   * lost in a resolved ticket; a closed ticket refuses it (ADR-0007).
   */
  async customerReply(
    principal: CustomerPrincipal,
    ticketId: string,
    { fields, files }: Submission<CustomerReplyFields>,
    requestId: string,
  ): Promise<CustomerTicket> {
    const scope = scopeOf(principal);
    if (
      (await this.tickets.customerTicket(this.db, scope, ticketId)) ===
      undefined
    ) {
      throw ticketNotFound();
    }
    const context: ChangeContext = {
      actor: { type: "customer", customerId: principal.customer.id },
      requestId,
    };
    await this.intake.storeThen(files, (stored) =>
      this.db.transaction(async (tx) => {
        const ticket = await this.tickets.lockForCustomer(tx, scope, ticketId);
        if (ticket === undefined) throw ticketNotFound();
        const next = statusAfterCustomerReply(ticket.status);
        const messageId = await this.changes.addMessage(
          tx,
          context,
          ticket.id,
          {
            visibility: "public",
            body: fields.body,
            files: stored,
          },
        );
        await this.changes.moveStatus(tx, context, ticket, next, messageId);
      }),
    );
    return this.queries.customerTicket(principal, ticketId);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import {
  type CustomerReplyFields,
  type CustomerTicket,
  type InternalNoteFields,
  PROBLEM_TYPES,
  type StaffReplyFields,
  type StaffTicket,
} from "@dsd/shared";

import type {
  CustomerPrincipal,
  StaffPrincipal,
} from "../../auth/principal.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { AttachmentIntake } from "../attachments/attachment-intake.js";
import type { Submission } from "../attachments/multipart.js";
import type { ChangeContext } from "../audit/audit.repository.js";
import {
  assertAgentTransition,
  assertNotClosed,
  statusAfterCustomerReply,
} from "./domain/ticket-status.js";
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

  /**
   * An agent's public reply (FR-8), optionally moving the ticket in the
   * same transaction: "send and wait for the customer", "send and resolve".
   * The first one records `first_response_at`. A closed ticket refuses
   * replies; a status change follows the state machine and needs
   * `ticket:status:update` as well.
   */
  async staffReply(
    principal: StaffPrincipal,
    ticketId: string,
    { fields, files }: Submission<StaffReplyFields>,
    requestId: string,
  ): Promise<StaffTicket> {
    await this.assertVisibleToStaff(principal, ticketId);
    if (
      fields.status !== undefined &&
      !principal.permissions.has("ticket:status:update")
    ) {
      throw new ProblemException(
        403,
        PROBLEM_TYPES.blank,
        "Changing the status needs the ticket:status:update permission.",
      );
    }
    const context = staffContext(principal, requestId);
    await this.intake.storeThen(files, (stored) =>
      this.db.transaction(async (tx) => {
        const ticket = await this.tickets.lockForStaff(
          tx,
          principal.agent.id,
          ticketId,
        );
        if (ticket === undefined) throw ticketNotFound();
        assertNotClosed(ticket.status);
        const next = fields.status ?? ticket.status;
        if (next !== ticket.status) assertAgentTransition(ticket.status, next);
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
        await this.tickets.markFirstResponse(tx, ticket.id);
        await this.changes.moveStatus(tx, context, ticket, next, messageId);
      }),
    );
    return this.queries.staffTicket(principal, ticketId);
  }

  /**
   * An internal note (FR-10): for staff only, in any status, closed
   * included, because notes never reach the customer.
   */
  async addNote(
    principal: StaffPrincipal,
    ticketId: string,
    { fields, files }: Submission<InternalNoteFields>,
    requestId: string,
  ): Promise<StaffTicket> {
    await this.assertVisibleToStaff(principal, ticketId);
    const context = staffContext(principal, requestId);
    await this.intake.storeThen(files, (stored) =>
      this.db.transaction(async (tx) => {
        const ticket = await this.tickets.lockForStaff(
          tx,
          principal.agent.id,
          ticketId,
        );
        if (ticket === undefined) throw ticketNotFound();
        await this.changes.addMessage(tx, context, ticket.id, {
          visibility: "internal",
          body: fields.body,
          files: stored,
        });
      }),
    );
    return this.queries.staffTicket(principal, ticketId);
  }

  /** Before any file is read: a ticket outside the agent's brands is a 404. */
  private async assertVisibleToStaff(
    principal: StaffPrincipal,
    ticketId: string,
  ): Promise<void> {
    const visible = await this.tickets.visibleToStaff(
      this.db,
      principal.agent.id,
      ticketId,
    );
    if (!visible) throw ticketNotFound();
  }
}

export const staffContext = (
  principal: StaffPrincipal,
  requestId: string,
): ChangeContext => ({
  actor: { type: "agent", agentId: principal.agent.id },
  requestId,
});

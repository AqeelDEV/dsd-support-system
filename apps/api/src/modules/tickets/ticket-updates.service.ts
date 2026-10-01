import { Inject, Injectable } from "@nestjs/common";
import type {
  PriorityChangeRequest,
  StaffTicket,
  StatusChangeRequest,
} from "@dsd/shared";

import type { StaffPrincipal } from "../../auth/principal.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import {
  assertAgentTransition,
  assertNotClosed,
} from "./domain/ticket-status.js";
import { staffContext, TicketChanges } from "./ticket-changes.js";
import {
  TicketQueriesService,
  ticketNotFound,
} from "./ticket-queries.service.js";
import { type LockedTicket, TicketsRepository } from "./tickets.repository.js";

/**
 * Staff changes to a ticket's state (FR-9, FR-11, UC-6). Each runs in one
 * transaction that locks the ticket row first, so concurrent changes queue
 * up and each is checked against the ticket as the previous one left it
 * (ADR-0007, section 2). A change to what the ticket already is writes
 * nothing and answers 200.
 */
@Injectable()
export class TicketUpdatesService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly tickets: TicketsRepository,
    private readonly changes: TicketChanges,
    private readonly queries: TicketQueriesService,
  ) {}

  /** Moves the ticket through the state machine; anything else is a 409 listing where it can go. */
  async changeStatus(
    principal: StaffPrincipal,
    ticketId: string,
    { status }: StatusChangeRequest,
    requestId: string,
  ): Promise<StaffTicket> {
    return this.underLock(principal, ticketId, async (tx, ticket) => {
      if (status === ticket.status) return;
      assertAgentTransition(ticket.status, status);
      await this.changes.moveStatus(
        tx,
        staffContext(principal, requestId),
        ticket,
        status,
        null,
      );
    });
  }

  async changePriority(
    principal: StaffPrincipal,
    ticketId: string,
    { priority }: PriorityChangeRequest,
    requestId: string,
  ): Promise<StaffTicket> {
    return this.underLock(principal, ticketId, async (tx, ticket) => {
      assertNotClosed(ticket.status);
      await this.changes.setPriority(
        tx,
        staffContext(principal, requestId),
        ticket,
        priority,
      );
    });
  }

  /**
   * Runs `change` on the locked ticket, in the agent's brands, and answers
   * with the ticket as it then stands.
   */
  private async underLock(
    principal: StaffPrincipal,
    ticketId: string,
    change: (tx: Executor, ticket: LockedTicket) => Promise<void>,
  ): Promise<StaffTicket> {
    await this.db.transaction(async (tx) => {
      const ticket = await this.tickets.lockForStaff(
        tx,
        principal.agent.id,
        ticketId,
      );
      if (ticket === undefined) throw ticketNotFound();
      await change(tx, ticket);
    });
    return this.queries.staffTicket(principal, ticketId);
  }
}

import { Inject, Injectable } from "@nestjs/common";
import {
  type AssignmentRequest,
  type EscalationRequest,
  permissionsFor,
  type PriorityChangeRequest,
  PROBLEM_TYPES,
  type StaffTicket,
  type StatusChangeRequest,
  TICKET_PRIORITIES,
  type TicketPriority,
} from "@dsd/shared";

import type { StaffPrincipal } from "../../auth/principal.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { AuditRepository } from "../audit/audit.repository.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { decideAssignment } from "./domain/ticket-actions.js";
import {
  assertAgentTransition,
  assertNotClosed,
} from "./domain/ticket-status.js";
import { staffContext, TicketChanges } from "./ticket-changes.js";
import {
  staffViewOf,
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
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
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
   * Claims, assigns or unassigns (ADR-0007, section 5). The rules about who
   * may move whose ticket live in `decideAssignment`; the new assignee must
   * be an active agent in the ticket's brand. Two simultaneous claims queue
   * on the row lock, so the second finds the ticket taken and gets 409.
   */
  async assign(
    principal: StaffPrincipal,
    ticketId: string,
    request: AssignmentRequest,
    requestId: string,
  ): Promise<StaffTicket> {
    return this.underLock(principal, ticketId, async (tx, ticket) => {
      const decision = decideAssignment(
        staffViewOf(principal),
        ticket,
        request,
      );
      if (decision === "unchanged") return;
      const to = decision.assigneeAgentId;
      if (
        to !== null &&
        (await this.tickets.assignableAgent(tx, to, ticket.brandId)) ===
          undefined
      ) {
        throw unusableAgent("That agent can't take tickets in this brand.");
      }
      await this.changes.assign(
        tx,
        staffContext(principal, requestId),
        ticket,
        to,
      );
    });
  }

  /**
   * Escalates a ticket (UC-6; ADR-0007, section 6): the reason becomes an
   * internal note, the priority rises to at least `high`, the ticket goes
   * to the chosen supervisor if there is one, and `escalated_at` records
   * it. Escalation is a flag, not a status, so the ticket keeps its place
   * in the lifecycle. Escalating again records the latest escalation; the
   * history keeps every one.
   */
  async escalate(
    principal: StaffPrincipal,
    ticketId: string,
    request: EscalationRequest,
    requestId: string,
  ): Promise<StaffTicket> {
    return this.underLock(principal, ticketId, async (tx, ticket) => {
      assertNotClosed(ticket.status);
      const supervisorId = request.supervisorId;
      if (supervisorId !== undefined) {
        const target = await this.tickets.assignableAgent(
          tx,
          supervisorId,
          ticket.brandId,
        );
        // A supervisor is whoever may reassign any ticket: permissions, not role names.
        if (
          target === undefined ||
          !permissionsFor(target.role).includes("ticket:reassign:any")
        ) {
          throw unusableAgent(
            "Escalate to an active supervisor or admin in this ticket's brand.",
          );
        }
      }
      const context = staffContext(principal, requestId);
      await this.changes.addMessage(tx, context, ticket.id, {
        visibility: "internal",
        body: `Escalated: ${request.reason}`,
        files: [],
      });
      const assignee = supervisorId ?? ticket.assigneeAgentId;
      await this.tickets.markEscalated(tx, ticket.id, principal.agent.id);
      await this.audit.record(tx, context, [
        {
          ticketId: ticket.id,
          entityType: "ticket",
          entityId: ticket.id,
          action: "ticket.escalated",
          before: { escalated: ticket.escalatedAt !== null },
          after: { escalated: true, assigneeAgentId: assignee },
        },
      ]);
      await this.outbox.add(tx, {
        type: "ticket.escalated",
        aggregateType: "ticket",
        aggregateId: ticket.id,
        payload: {
          ticketId: ticket.id,
          escalatedByAgentId: principal.agent.id,
          assigneeAgentId: assignee,
        },
      });
      await this.changes.setPriority(
        tx,
        context,
        ticket,
        atLeastHigh(ticket.priority),
      );
      await this.changes.assign(tx, context, ticket, assignee);
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

/** Well-formed, but names an agent who can't be used here (ARCHITECTURE, status codes). */
export const unusableAgent = (detail: string) =>
  new ProblemException(422, PROBLEM_TYPES.blank, detail);

/** `low` and `normal` rise to `high`; `high` and `urgent` stay as they are. */
export function atLeastHigh(priority: TicketPriority): TicketPriority {
  return TICKET_PRIORITIES.indexOf(priority) < TICKET_PRIORITIES.indexOf("high")
    ? "high"
    : priority;
}

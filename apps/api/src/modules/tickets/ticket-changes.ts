import { Injectable } from "@nestjs/common";
import type {
  MessageVisibility,
  TicketPriority,
  TicketStatus,
} from "@dsd/shared";

import type { StaffPrincipal } from "../../auth/principal.js";
import type { Executor } from "../../infrastructure/database.js";
import type { StoredFile } from "../attachments/attachment-intake.js";
import {
  type AttachmentRow,
  AttachmentsRepository,
} from "../attachments/attachments.repository.js";
import {
  AuditRepository,
  type ChangeContext,
} from "../audit/audit.repository.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { timestampChanges } from "./domain/ticket-status.js";
import { MessagesRepository } from "./messages.repository.js";
import { TicketsRepository } from "./tickets.repository.js";

/** The change context for a staff member's request: they are the actor. */
export const staffContext = (
  principal: StaffPrincipal,
  requestId: string,
): ChangeContext => ({
  actor: { type: "agent", agentId: principal.agent.id },
  requestId,
});

/**
 * The writes every ticket change is made of, each with its audit event and
 * its outbox event, always in the caller's transaction (ADR-0005, section
 * 1; ADR-0008, section 3). Services decide whether a change is allowed;
 * this class makes sure an allowed change is never written without its
 * history.
 */
@Injectable()
export class TicketChanges {
  constructor(
    private readonly tickets: TicketsRepository,
    private readonly messages: MessagesRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  /** Rows for stored files, on the ticket itself or on one of its messages. */
  async addFiles(
    tx: Executor,
    context: ChangeContext,
    target: { ticketId: string; messageId: string | null },
    files: readonly StoredFile[],
  ): Promise<AttachmentRow[]> {
    const rows = await this.attachments.insert(
      tx,
      target,
      context.actor,
      files,
    );
    await this.audit.record(
      tx,
      context,
      rows.map((row) => ({
        ticketId: target.ticketId,
        entityType: "attachment",
        entityId: row.id,
        action: "attachment.created",
        before: null,
        after: {
          messageId: target.messageId,
          contentType: row.contentType,
          sizeBytes: row.sizeBytes,
        },
      })),
    );
    return rows;
  }

  /** A reply or an internal note, by the context's actor, with its files. */
  async addMessage(
    tx: Executor,
    context: ChangeContext,
    ticketId: string,
    message: {
      visibility: MessageVisibility;
      body: string;
      files: readonly StoredFile[];
    },
  ): Promise<string> {
    const { visibility } = message;
    const messageId = await this.messages.insert(tx, {
      ticketId,
      author: context.actor,
      visibility,
      body: message.body,
    });
    await this.audit.record(tx, context, [
      {
        ticketId,
        entityType: "message",
        entityId: messageId,
        action: "message.created",
        before: null,
        after: { visibility },
      },
    ]);
    await this.addFiles(tx, context, { ticketId, messageId }, message.files);
    await this.outbox.add(tx, {
      type: "message.created",
      aggregateType: "ticket",
      aggregateId: ticketId,
      payload: {
        ticketId,
        messageId,
        authorType: context.actor.type,
        visibility,
      },
    });
    return messageId;
  }

  /**
   * Moves the ticket to `to`, which the caller has already checked against
   * the state machine. `messageId` names the reply that carried the change,
   * if any. Moving to the current status writes nothing.
   */
  async moveStatus(
    tx: Executor,
    context: ChangeContext,
    ticket: { id: string; status: TicketStatus },
    to: TicketStatus,
    messageId: string | null,
  ): Promise<void> {
    if (to === ticket.status) return;
    await this.tickets.setStatus(
      tx,
      ticket.id,
      to,
      timestampChanges(ticket.status, to),
    );
    await this.audit.record(tx, context, [
      {
        ticketId: ticket.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket.status_changed",
        before: { status: ticket.status },
        after: { status: to },
      },
    ]);
    await this.outbox.add(tx, {
      type: "ticket.status_changed",
      aggregateType: "ticket",
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        fromStatus: ticket.status,
        toStatus: to,
        messageId,
      },
    });
  }

  /** A new priority; the current one writes nothing. */
  async setPriority(
    tx: Executor,
    context: ChangeContext,
    ticket: { id: string; priority: TicketPriority },
    to: TicketPriority,
  ): Promise<void> {
    if (to === ticket.priority) return;
    await this.tickets.setPriority(tx, ticket.id, to);
    await this.audit.record(tx, context, [
      {
        ticketId: ticket.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket.priority_changed",
        before: { priority: ticket.priority },
        after: { priority: to },
      },
    ]);
    await this.outbox.add(tx, {
      type: "ticket.priority_changed",
      aggregateType: "ticket",
      aggregateId: ticket.id,
      payload: {
        ticketId: ticket.id,
        fromPriority: ticket.priority,
        toPriority: to,
      },
    });
  }
}

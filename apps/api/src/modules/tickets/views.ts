import type {
  Attachment,
  CustomerMessage,
  CustomerTicket,
  TicketStatus,
} from "@dsd/shared";

import type { AttachmentRow } from "../attachments/attachments.repository.js";
import type { ThreadMessage } from "./messages.repository.js";

/*
 * Rows to response shapes. Customer and staff shapes are built separately,
 * from separate schemas: a customer view only ever receives public rows,
 * and its schema has no field for anything else (ADR-0004, section 2).
 */

export const iso = (date: Date): string => date.toISOString();
export const isoOrNull = (date: Date | null): string | null =>
  date === null ? null : date.toISOString();

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    filename: row.filename,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    createdAt: iso(row.createdAt),
  };
}

/** Attachments grouped by the message they came with; `null` is the ticket itself. */
export function byMessage(
  rows: readonly AttachmentRow[],
): (messageId: string | null) => Attachment[] {
  const groups = new Map<string | null, Attachment[]>();
  for (const row of rows) {
    const group = groups.get(row.messageId) ?? [];
    group.push(toAttachment(row));
    groups.set(row.messageId, group);
  }
  return (messageId) => groups.get(messageId) ?? [];
}

export function toCustomerMessage(
  message: ThreadMessage,
  attachments: Attachment[],
): CustomerMessage {
  return {
    id: message.id,
    author: { type: message.authorType, name: message.authorName },
    body: message.body,
    attachments,
    createdAt: iso(message.createdAt),
  };
}

export function toCustomerTicket(
  ticket: {
    id: string;
    reference: string;
    subject: string;
    description: string;
    status: TicketStatus;
    createdAt: Date;
  },
  thread: readonly ThreadMessage[],
  attachments: readonly AttachmentRow[],
  statusChanges: readonly { status: TicketStatus; at: Date }[],
): CustomerTicket {
  const filesOf = byMessage(attachments);
  return {
    id: ticket.id,
    reference: ticket.reference,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    createdAt: iso(ticket.createdAt),
    attachments: filesOf(null),
    messages: thread.map((message) =>
      toCustomerMessage(message, filesOf(message.id)),
    ),
    timeline: [
      { status: "open", at: iso(ticket.createdAt) },
      ...statusChanges.map((change) => ({
        status: change.status,
        at: iso(change.at),
      })),
    ],
  };
}

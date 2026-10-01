import { z } from "zod";

import {
  actorTypeSchema,
  messageVisibilitySchema,
  participantTypeSchema,
  ticketChannelSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
} from "../domain/enums.js";
import { attachmentSchema } from "./attachments.js";

/*
 * Ticket responses. Customers and staff get different schemas (ADR-0004,
 * section 2): the customer ones have no field that could carry an internal
 * note, a priority, an assignee, an escalation or anything that changes
 * when staff work on a ticket behind the scenes. Serialisation drops
 * whatever a schema doesn't name, so a query that returned too much still
 * can't leak it.
 */

const timestamp = z.iso.datetime();

/** One page of a list, with an opaque cursor for the next (keyset pagination). */
export const pageOf = <Item extends z.ZodType>(item: Item) =>
  z.object({
    items: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .describe("Pass as `cursor` for the next page; null on the last page"),
  });

/** What a guest gets back: the reference to quote. The thread opens from the emailed link. */
export const guestTicketReceiptSchema = z.object({
  reference: z.string().describe("For example DSD-000123"),
});

export const customerMessageSchema = z.object({
  id: z.uuid(),
  author: z.object({
    type: participantTypeSchema,
    name: z
      .string()
      .nullable()
      .describe("The agent's display name, or the customer's if they set one"),
  }),
  body: z.string(),
  attachments: z.array(attachmentSchema),
  createdAt: timestamp,
});

export const customerTicketSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  subject: z.string(),
  status: ticketStatusSchema,
  createdAt: timestamp,
});

export const customerTicketSchema = customerTicketSummarySchema.extend({
  description: z.string(),
  attachments: z
    .array(attachmentSchema)
    .describe("Files sent with the ticket itself"),
  messages: z
    .array(customerMessageSchema)
    .describe("Every reply after the description, oldest first"),
  timeline: z
    .array(z.object({ status: ticketStatusSchema, at: timestamp }))
    .describe("Each status the ticket has had, starting with `open`"),
});

const agentRefSchema = z.object({ id: z.uuid(), displayName: z.string() });

export const staffMessageSchema = z.object({
  id: z.uuid(),
  visibility: messageVisibilitySchema.describe(
    "`internal` is a note the customer never sees",
  ),
  author: z.object({
    type: participantTypeSchema,
    id: z.uuid(),
    name: z.string().nullable(),
  }),
  body: z.string(),
  attachments: z.array(attachmentSchema),
  createdAt: timestamp,
});

/** What the agent app may offer on this ticket (ADR-0004, section 5). The API enforces the same rules regardless. */
export const allowedActionsSchema = z.object({
  reply: z.boolean(),
  addNote: z.boolean(),
  changeStatus: z.boolean(),
  changePriority: z.boolean(),
  claim: z.boolean(),
  assign: z
    .boolean()
    .describe("Hand the ticket to another agent, or take it from its holder"),
  unassign: z.boolean(),
  escalate: z.boolean(),
  viewAuditTrail: z.boolean(),
});

export const staffTicketSummarySchema = z.object({
  id: z.uuid(),
  reference: z.string(),
  subject: z.string(),
  status: ticketStatusSchema,
  priority: ticketPrioritySchema,
  channel: ticketChannelSchema,
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
  assignee: agentRefSchema.nullable(),
  contactVerified: z
    .boolean()
    .describe(
      "False until the customer opens a link we emailed; don't discuss account details before",
    ),
  escalatedAt: timestamp.nullable(),
  firstResponseAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const staffTicketSchema = staffTicketSummarySchema.extend({
  description: z.string(),
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    hasAccount: z.boolean(),
  }),
  escalatedBy: agentRefSchema.nullable(),
  resolvedAt: timestamp.nullable(),
  closedAt: timestamp.nullable(),
  attachments: z
    .array(attachmentSchema)
    .describe("Files sent with the ticket itself"),
  messages: z
    .array(staffMessageSchema)
    .describe("Replies and internal notes after the description, oldest first"),
  allowedTransitions: z
    .array(ticketStatusSchema)
    .describe("Statuses this agent can move the ticket to now"),
  allowedActions: allowedActionsSchema,
});

export const auditEventSchema = z.object({
  id: z.uuid(),
  action: z.string().describe("For example `ticket.status_changed`"),
  entityType: z.string(),
  entityId: z.uuid(),
  actor: z.object({
    type: actorTypeSchema,
    id: z.uuid().nullable(),
    name: z.string().nullable(),
  }),
  before: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe("The changed fields before, or null for a creation"),
  after: z.record(z.string(), z.unknown()).nullable(),
  requestId: z.string().describe("Matches the API's request logs"),
  createdAt: timestamp,
});

export const staffCustomerSchema = z.object({
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
    hasAccount: z.boolean(),
    createdAt: timestamp,
  }),
  tickets: pageOf(staffTicketSummarySchema).describe(
    "Their tickets in your brands, newest first",
  ),
});

export type GuestTicketReceipt = z.infer<typeof guestTicketReceiptSchema>;
export type CustomerMessage = z.infer<typeof customerMessageSchema>;
export type CustomerTicketSummary = z.infer<typeof customerTicketSummarySchema>;
export type CustomerTicket = z.infer<typeof customerTicketSchema>;
export type StaffMessage = z.infer<typeof staffMessageSchema>;
export type AllowedActions = z.infer<typeof allowedActionsSchema>;
export type StaffTicketSummary = z.infer<typeof staffTicketSummarySchema>;
export type StaffTicket = z.infer<typeof staffTicketSchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type StaffCustomer = z.infer<typeof staffCustomerSchema>;

import { z } from "zod";

import {
  messageVisibilitySchema,
  participantTypeSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
} from "./enums.js";

/**
 * Domain events written to the outbox in the same transaction as the
 * change they describe (ADR-0005, section 2). Payloads carry IDs only.
 */
export const DOMAIN_EVENTS = [
  "ticket.created",
  "message.created",
  "ticket.status_changed",
  "ticket.priority_changed",
  "ticket.assigned",
  "ticket.escalated",
  "kb.article_published",
  "kb.article_unpublished",
  "ai.suggestion_requested",
  "customer.signup_requested",
  "guest_access.requested",
  "agent.invited",
] as const;
export const domainEventSchema = z.enum(DOMAIN_EVENTS);
export type DomainEvent = z.infer<typeof domainEventSchema>;

/**
 * Someone asked to register this customer. The worker emails a
 * verification link, or a sign-in reminder if the account already has a
 * password; it reads which from the customer row.
 */
export const customerSignupRequestedSchema = z.object({
  customerId: z.uuid(),
});
export type CustomerSignupRequested = z.infer<
  typeof customerSignupRequestedSchema
>;

/** A guest asked for a fresh access link to one of their tickets. */
export const guestAccessRequestedSchema = z.object({
  ticketId: z.uuid(),
  customerId: z.uuid(),
});
export type GuestAccessRequested = z.infer<typeof guestAccessRequestedSchema>;

/** A ticket was submitted, by a guest or a signed-in customer. */
export const ticketCreatedSchema = z.object({
  ticketId: z.uuid(),
  customerId: z.uuid(),
});
export type TicketCreated = z.infer<typeof ticketCreatedSchema>;

/**
 * A public reply or an internal note was added. Notifications act on public
 * agent replies only, and AI suggestions on customer messages only.
 */
export const messageCreatedSchema = z.object({
  ticketId: z.uuid(),
  messageId: z.uuid(),
  authorType: participantTypeSchema,
  visibility: messageVisibilitySchema,
});
export type MessageCreated = z.infer<typeof messageCreatedSchema>;

/**
 * The status changed. `messageId` names the reply that carried the change,
 * if one did, so the customer gets one email about both (ADR-0005).
 */
export const ticketStatusChangedSchema = z.object({
  ticketId: z.uuid(),
  fromStatus: ticketStatusSchema,
  toStatus: ticketStatusSchema,
  messageId: z.uuid().nullable(),
});
export type TicketStatusChanged = z.infer<typeof ticketStatusChangedSchema>;

export const ticketPriorityChangedSchema = z.object({
  ticketId: z.uuid(),
  fromPriority: ticketPrioritySchema,
  toPriority: ticketPrioritySchema,
});
export type TicketPriorityChanged = z.infer<typeof ticketPriorityChangedSchema>;

export const ticketAssignedSchema = z.object({
  ticketId: z.uuid(),
  fromAgentId: z.uuid().nullable(),
  toAgentId: z.uuid().nullable(),
});
export type TicketAssigned = z.infer<typeof ticketAssignedSchema>;

export const ticketEscalatedSchema = z.object({
  ticketId: z.uuid(),
  escalatedByAgentId: z.uuid(),
  assigneeAgentId: z.uuid().nullable(),
});
export type TicketEscalated = z.infer<typeof ticketEscalatedSchema>;

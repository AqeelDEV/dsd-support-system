import { z } from "zod";

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

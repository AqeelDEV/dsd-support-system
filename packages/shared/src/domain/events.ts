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

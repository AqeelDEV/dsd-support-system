import type { DomainEvent } from "@dsd/shared";

import type { WorkQueue } from "../queues/queues.js";

/**
 * Which queues each event goes to (ADR-0005, section 2, amended). Only
 * queues that have a consumer are listed. An event with none, such as
 * `ticket.assigned` today, is still marked dispatched, so the outbox
 * doesn't keep it; the AI and knowledge-base queues are added here with
 * their workers in Phase 9, together with a backfill of what was
 * published before.
 */
export const ROUTES: Readonly<Record<DomainEvent, readonly WorkQueue[]>> = {
  "ticket.created": ["notifications"],
  "message.created": ["notifications"],
  "ticket.status_changed": ["notifications"],
  "ticket.priority_changed": [],
  "ticket.assigned": [],
  "ticket.escalated": [],
  "kb.article_published": [],
  "kb.article_unpublished": [],
  "ai.suggestion_requested": [],
  "customer.signup_requested": ["notifications"],
  "guest_access.requested": ["notifications"],
  "agent.invited": ["notifications"],
  "customer.password_reset_requested": ["notifications"],
};

/**
 * One job per event and queue. BullMQ refuses `:` in a custom job ID, so
 * the two halves are joined with a dot. Adding the same ID twice is a
 * no-op, which is what makes a repeated dispatch harmless.
 */
export const jobIdFor = (eventId: string, queue: WorkQueue): string =>
  `${eventId}.${queue}`;

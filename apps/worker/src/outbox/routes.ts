import type { DomainEvent } from "@dsd/shared";
import type { JobsOptions } from "bullmq";

import type { WorkQueue } from "../queues/queues.js";
import type { OutboxJob } from "./dispatcher.js";

/**
 * Which queues each event goes to (ADR-0005, section 2, amended). Only
 * queues that have a consumer are listed. An event with none, such as
 * `ticket.assigned` today, is still marked dispatched, so the outbox
 * doesn't keep it. Articles published before the indexing queue existed
 * are picked up by the worker's reconcile at startup, not by an event.
 */
export const ROUTES: Readonly<Record<DomainEvent, readonly WorkQueue[]>> = {
  "ticket.created": ["notifications", "ai-suggestions"],
  "message.created": ["notifications", "ai-suggestions"],
  "ticket.status_changed": ["notifications"],
  "ticket.priority_changed": [],
  "ticket.assigned": [],
  "ticket.escalated": [],
  "kb.article_published": ["kb-indexing"],
  "kb.article_unpublished": ["kb-indexing"],
  "ai.suggestion_requested": ["ai-suggestions"],
  "customer.signup_requested": ["notifications"],
  "guest_access.requested": ["notifications"],
  "agent.invited": ["notifications"],
  "customer.password_reset_requested": ["notifications"],
};

/**
 * Events that reach a queue only when their payload says so. A message
 * needs a drafted answer only when a customer wrote it: without this, an
 * agent's reply or note queued behind a customer's message would replace
 * that message's debounced job (below), and the customer would get no
 * draft at all.
 */
const ONLY_WHEN: Partial<
  Record<
    WorkQueue,
    Partial<Record<DomainEvent, (payload: Record<string, unknown>) => boolean>>
  >
> = {
  "ai-suggestions": {
    "message.created": (payload) => payload.authorType === "customer",
  },
};

/** The queues one event goes to. */
export function queuesFor(
  type: DomainEvent,
  payload: Record<string, unknown>,
): WorkQueue[] {
  return ROUTES[type].filter(
    (queue) => ONLY_WHEN[queue]?.[type]?.(payload) ?? true,
  );
}

/**
 * One job per event and queue. BullMQ refuses `:` in a custom job ID, so
 * the two halves are joined with a dot. Adding the same ID twice is a
 * no-op, which is what makes a repeated dispatch harmless.
 */
export const jobIdFor = (eventId: string, queue: WorkQueue): string =>
  `${eventId}.${queue}`;

/**
 * How a job is added. Suggestion jobs are debounced per ticket (ADR-0005,
 * section 6): a customer's message waits `debounceMs`, and a newer job for
 * the same ticket replaces it while it waits, so a burst of messages gets
 * one draft. A job added while another for the ticket is running is kept
 * and runs after it, so the latest message is never missed and two drafts
 * for one ticket never run at once. New tickets and agents' requests don't
 * wait.
 */
export function jobOptionsFor(
  queue: WorkQueue,
  job: OutboxJob,
  debounceMs: number,
): JobsOptions {
  const options: JobsOptions = { jobId: jobIdFor(job.eventId, queue) };
  const ticketId = job.payload.ticketId;
  // A payload without a ticket goes through as it is; its handler
  // dead-letters it.
  if (queue !== "ai-suggestions" || typeof ticketId !== "string") {
    return options;
  }
  return {
    ...options,
    delay: job.type === "message.created" ? debounceMs : 0,
    deduplication: {
      id: `ticket.${ticketId}`,
      replace: true,
      keepLastIfActive: true,
    },
  };
}

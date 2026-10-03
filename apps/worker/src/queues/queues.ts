import type { BackoffOptions } from "bullmq";

/*
 * The queues and their retry policies (ADR-0005, section 4). Only queues
 * with a consumer exist.
 */

export const QUEUES = {
  notifications: "notifications",
  aiSuggestions: "ai-suggestions",
  kbIndexing: "kb-indexing",
  maintenance: "maintenance",
  deadLetter: "dead-letter",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** A queue whose jobs run, retry and, when they run out of attempts, are dead-lettered. */
export type WorkQueue = Exclude<QueueName, "dead-letter">;

export interface RetryPolicy {
  attempts: number;
  backoff: BackoffOptions & { type: "exponential"; delay: number };
}

/**
 * Exponential backoff from `delay`, with half of each wait randomised, so
 * a recovering SMTP server or AI provider isn't hit by every failed job at
 * the same instant. Notifications and indexing: 10 s, 20 s, 40 s, 80 s
 * between five attempts. Suggestions: 5 s, then 10 s, between three, because
 * a draft is only useful while the agent is still on the ticket.
 */
export const RETRY_POLICIES: Readonly<Record<WorkQueue, RetryPolicy>> = {
  notifications: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000, jitter: 0.5 },
  },
  "ai-suggestions": {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000, jitter: 0.5 },
  },
  "kb-indexing": {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000, jitter: 0.5 },
  },
  maintenance: {
    attempts: 3,
    backoff: { type: "exponential", delay: 60_000, jitter: 0.5 },
  },
};

/**
 * The policy for `queue`, with the first delay replaced when tests need
 * retries in milliseconds rather than seconds.
 */
export function retryPolicy(
  queue: WorkQueue,
  firstDelayMs?: number,
): RetryPolicy {
  const policy = RETRY_POLICIES[queue];
  return firstDelayMs === undefined
    ? policy
    : { ...policy, backoff: { ...policy.backoff, delay: firstDelayMs } };
}

/**
 * Finished jobs are kept for a while for inspection, then trimmed, so
 * Redis doesn't grow without bound. Failed jobs that ran out of attempts
 * are also copied to the dead-letter queue, which keeps them until they
 * are replayed.
 */
export const KEEP_JOBS = {
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
} as const;

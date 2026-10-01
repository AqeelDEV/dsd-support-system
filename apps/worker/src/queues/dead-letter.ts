import { type Job, Queue } from "bullmq";
import type { Redis } from "ioredis";

import { retryPolicy, type WorkQueue } from "./queues.js";

/** What a dead-lettered job keeps: enough to understand it and to replay it. */
export interface DeadLetter {
  queue: WorkQueue;
  jobId: string;
  name: string;
  data: unknown;
  error: string;
  attemptsMade: number;
  failedAt: string;
}

/**
 * Whether this run is the job's last: it has used every attempt, or it
 * failed in a way no retry can fix.
 */
export function isFinalAttempt(job: Job, unrecoverable: boolean): boolean {
  return unrecoverable || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * Copies a job that ran out of attempts into the dead-letter queue
 * (ADR-0005, section 4). BullMQ has none of its own. The copy keeps the
 * job's own ID, so recording the same failure twice adds nothing. Dead
 * letters stay until someone replays them (`pnpm --filter @dsd/worker
 * dead-letter`).
 */
export async function deadLetter(
  deadLetters: Queue<DeadLetter>,
  queue: WorkQueue,
  job: Job,
  error: unknown,
): Promise<void> {
  const jobId = job.id ?? `${queue}.${job.name}.${String(job.timestamp)}`;
  await deadLetters.add(
    job.name,
    {
      queue,
      jobId,
      name: job.name,
      data: job.data as unknown,
      error: error instanceof Error ? error.message : String(error),
      attemptsMade: job.attemptsMade + 1,
      failedAt: new Date().toISOString(),
    },
    { jobId, removeOnComplete: false, removeOnFail: false },
  );
}

/** Dead letters waiting for someone to look at them, oldest first. */
export async function deadLetters(
  queue: Queue<DeadLetter>,
): Promise<DeadLetter[]> {
  const jobs = await queue.getJobs(["waiting", "delayed"], 0, -1, true);
  return jobs.map((job) => job.data);
}

/**
 * Puts dead-lettered jobs back on their own queues under new IDs, with
 * their attempts reset, and removes them from the dead-letter queue.
 * `which` names one job, or all of them. Returns the IDs replayed.
 */
export async function replayDeadLetters(
  deadLetterQueue: Queue<DeadLetter>,
  connection: Redis,
  prefix: string,
  which: { jobId: string } | { all: true },
): Promise<string[]> {
  const jobs =
    "all" in which
      ? await deadLetterQueue.getJobs(["waiting", "delayed"], 0, -1, true)
      : [await deadLetterQueue.getJob(which.jobId)].filter(
          (job) => job !== undefined,
        );
  const targets = new Map<WorkQueue, Queue>();
  const replayed: string[] = [];
  try {
    for (const job of jobs) {
      const letter = job.data;
      let target = targets.get(letter.queue);
      if (target === undefined) {
        target = new Queue(letter.queue, {
          connection,
          prefix,
          defaultJobOptions: retryPolicy(letter.queue),
        });
        targets.set(letter.queue, target);
      }
      await target.add(letter.name, letter.data, {
        jobId: `${letter.jobId}.replay-${String(Date.now())}`,
      });
      await job.remove();
      replayed.push(letter.jobId);
    }
  } finally {
    await Promise.all([...targets.values()].map((queue) => queue.close()));
  }
  return replayed;
}

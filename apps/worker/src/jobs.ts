import { type Job, Queue, UnrecoverableError, Worker } from "bullmq";

import { KnowledgeIndexer } from "./ai/kb/indexer.js";
import { articleIdOf, reconcileKnowledgeBase } from "./ai/kb/indexing-jobs.js";
import { KnowledgeIndexRepository } from "./ai/kb/knowledge-index.repository.js";
import { aiSettings } from "./ai/settings.js";
import { createSuggestionHandler } from "./ai/suggestions/index.js";
import type { Env } from "./config/env.js";
import type { Container } from "./container.js";
import type { Logger } from "./logger.js";
import { runCleanup } from "./maintenance/cleanup.js";
import { NotificationHandlers } from "./notifications/handlers.js";
import { PgDeliveryStore } from "./notifications/deliveries.repository.js";
import { Links } from "./notifications/links.js";
import { NotificationService } from "./notifications/notification-service.js";
import { NotificationsRepository } from "./notifications/notifications.repository.js";
import { type OutboxJob, OutboxDispatcher } from "./outbox/dispatcher.js";
import {
  type DeadLetter,
  deadLetter,
  isFinalAttempt,
} from "./queues/dead-letter.js";
import { InvalidEventError } from "./queues/errors.js";
import {
  KEEP_JOBS,
  QUEUES,
  retryPolicy,
  type WorkQueue,
} from "./queues/queues.js";

/** Settings tests change; production uses the defaults. */
export interface JobOptions {
  /** The first retry delay, normally 10 s for notifications (ADR-0005, section 4). */
  firstRetryDelayMs?: number;
  /** Whether to register the nightly clean-up. */
  schedule?: boolean;
  /** Whether to bring the knowledge-base index up to date at startup. */
  reconcile?: boolean;
}

/** Notifications sent at once by one worker process. SMTP is the slow part. */
const NOTIFICATION_CONCURRENCY = 5;

/**
 * Articles indexed at once: one, so a backfill embeds articles one after
 * another and stays inside a provider's free-tier rate limit.
 */
const INDEXING_CONCURRENCY = 1;

/**
 * Suggestions drafted at once. The time goes on waiting for the model, so
 * a few run side by side; two for the same ticket never do (see
 * `jobOptionsFor`).
 */
const SUGGESTION_CONCURRENCY = 4;

/** The nightly clean-up, at 03:00 UTC (DATA_MODEL.md, "Data lifecycle"). */
export const CLEANUP_SCHEDULE = {
  id: "nightly-cleanup",
  pattern: "0 3 * * *",
  jobName: "cleanup",
} as const;

export interface Jobs {
  readonly queues: Readonly<Record<WorkQueue, Queue>>;
  readonly deadLetters: Queue<DeadLetter>;
  readonly dispatcher: OutboxDispatcher;
  stop(): Promise<void>;
}

/**
 * Everything the worker runs once its dependencies are up: the outbox
 * dispatcher, a consumer per queue, the dead-letter queue and the nightly
 * clean-up (ADR-0005). Queues are created on the container's fail-fast
 * producer connection, so a Redis outage makes a dispatch fail at once and
 * roll back rather than hang with outbox rows locked.
 */
export async function startJobs(
  env: Env,
  container: Container,
  logger: Logger,
  options: JobOptions = {},
): Promise<Jobs> {
  const prefix = env.QUEUE_PREFIX;
  const queueFor = (queue: WorkQueue) =>
    new Queue(queue, {
      connection: container.producer,
      prefix,
      defaultJobOptions: {
        ...retryPolicy(queue, options.firstRetryDelayMs),
        ...KEEP_JOBS,
      },
    });
  const queues = {
    notifications: queueFor("notifications"),
    "ai-suggestions": queueFor("ai-suggestions"),
    "kb-indexing": queueFor("kb-indexing"),
    maintenance: queueFor("maintenance"),
  };
  const deadLetters = new Queue<DeadLetter>(QUEUES.deadLetter, {
    connection: container.producer,
    prefix,
  });

  const deliveries = new PgDeliveryStore(container.db);
  const handlers = new NotificationHandlers(
    container.db,
    new NotificationsRepository(container.db),
    new NotificationService(container.channels, deliveries, logger),
    new Links(env),
    env.TICKET_BRAND_SLUG,
    logger,
  );
  const knowledge = new KnowledgeIndexRepository(container.db);
  const indexer = new KnowledgeIndexer(
    knowledge,
    container.ai.embeddings,
    logger,
  );
  const suggestions = createSuggestionHandler(
    container.db,
    container.ai,
    aiSettings(env),
    logger,
  );
  const reconcile = () =>
    reconcileKnowledgeBase(
      knowledge,
      queues["kb-indexing"],
      container.ai.embeddings?.model ?? null,
      logger,
    );

  /**
   * Runs `work`; when it fails for the last time, records the failure and
   * dead-letters the job before failing it, so nothing is lost if the
   * process stops right after.
   */
  const withDeadLetter =
    <Data>(
      queue: WorkQueue,
      work: (job: Job<Data>) => Promise<void>,
      onFinalFailure: (job: Job<Data>, reason: string) => Promise<void>,
    ) =>
    async (job: Job<Data>): Promise<void> => {
      try {
        await work(job);
      } catch (error) {
        const unrecoverable = error instanceof InvalidEventError;
        if (isFinalAttempt(job, unrecoverable)) {
          const reason = error instanceof Error ? error.message : String(error);
          await onFinalFailure(job, reason);
          await deadLetter(deadLetters, queue, job, error);
          logger.error(
            { queue, jobId: job.id, attempts: job.attemptsMade + 1, reason },
            "job dead-lettered",
          );
          if (unrecoverable) throw new UnrecoverableError(reason);
        }
        throw error;
      }
    };

  const workers = [
    new Worker<OutboxJob>(
      QUEUES.notifications,
      withDeadLetter<OutboxJob>(
        "notifications",
        (job) => handlers.handle(job.data),
        async (job, reason) => {
          await deliveries.failUnsent(job.data.eventId, reason);
        },
      ),
      {
        connection: container.redis,
        prefix,
        concurrency: NOTIFICATION_CONCURRENCY,
      },
    ),
    new Worker<OutboxJob>(
      QUEUES.aiSuggestions,
      withDeadLetter<OutboxJob>(
        "ai-suggestions",
        (job) => suggestions.handle(job.data),
        (job, reason) => suggestions.failed(job.data, reason),
      ),
      {
        connection: container.redis,
        prefix,
        concurrency: SUGGESTION_CONCURRENCY,
      },
    ),
    new Worker(
      QUEUES.kbIndexing,
      withDeadLetter(
        "kb-indexing",
        async (job) => {
          await indexer.index(articleIdOf(job.data));
        },
        () => Promise.resolve(),
      ),
      {
        connection: container.redis,
        prefix,
        concurrency: INDEXING_CONCURRENCY,
      },
    ),
    new Worker(
      QUEUES.maintenance,
      withDeadLetter(
        "maintenance",
        async () => {
          const report = await runCleanup(container.pool, container.store);
          logger.info(report, "clean-up finished");
          await reconcile();
        },
        () => Promise.resolve(),
      ),
      { connection: container.redis, prefix, concurrency: 1 },
    ),
  ];
  for (const worker of workers) {
    worker.on("error", (error) => {
      logger.warn({ queue: worker.name, reason: error.message }, "queue error");
    });
  }

  if (options.schedule ?? true) {
    await queues.maintenance.upsertJobScheduler(
      CLEANUP_SCHEDULE.id,
      { pattern: CLEANUP_SCHEDULE.pattern, tz: "UTC" },
      { name: CLEANUP_SCHEDULE.jobName },
    );
  }

  if (options.reconcile ?? true) {
    // A failure here only delays indexing until the nightly run; it must
    // not stop the worker from sending notifications.
    await reconcile().catch((error: unknown) => {
      logger.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        "knowledge base reconcile failed; it runs again tonight",
      );
    });
  }

  const dispatcher = new OutboxDispatcher(container.pool, queues, logger, {
    intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
    aiDebounceMs: env.AI_DEBOUNCE_MS,
  });
  dispatcher.start();
  logger.info("jobs started");

  return {
    queues,
    deadLetters,
    dispatcher,
    async stop() {
      await dispatcher.stop();
      // Waits for jobs in progress, then stops taking new ones.
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(
        [...Object.values(queues), deadLetters].map((queue) => queue.close()),
      );
    },
  };
}

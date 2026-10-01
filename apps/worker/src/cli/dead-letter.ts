import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { ConfigError, parseEnv } from "../config/env.js";
import {
  type DeadLetter,
  deadLetters,
  replayDeadLetters,
} from "../queues/dead-letter.js";
import { QUEUES } from "../queues/queues.js";

/*
 * Inspects and replays dead-lettered jobs (ADR-0005, section 4):
 *
 *   dead-letter list
 *   dead-letter replay <job ID>
 *   dead-letter replay --all
 *
 * A replayed job goes back on its own queue under a new ID, with its
 * attempts reset, and leaves the dead-letter queue. Notifications are
 * idempotent, so replaying one whose email did go out sends nothing.
 */

const USAGE =
  "Usage: dead-letter list | dead-letter replay <job ID> | dead-letter replay --all";

const line = (text: string) => {
  process.stdout.write(`${text}\n`);
};

async function main(args: readonly string[]): Promise<void> {
  const env = parseEnv(process.env);
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  const queue = new Queue<DeadLetter>(QUEUES.deadLetter, {
    connection,
    prefix: env.QUEUE_PREFIX,
  });
  try {
    const [command, argument] = args;
    if (command === "list") {
      const letters = await deadLetters(queue);
      if (letters.length === 0) line("No dead-lettered jobs.");
      for (const letter of letters) {
        line(
          [
            letter.jobId,
            letter.queue,
            letter.name,
            letter.failedAt,
            `attempts ${String(letter.attemptsMade)}`,
            letter.error,
          ].join("\t"),
        );
      }
    } else if (command === "replay" && argument !== undefined) {
      const replayed = await replayDeadLetters(
        queue,
        connection,
        env.QUEUE_PREFIX,
        argument === "--all" ? { all: true } : { jobId: argument },
      );
      if (replayed.length === 0) line("Nothing to replay.");
      for (const id of replayed) line(`Replayed ${id}.`);
    } else {
      process.stderr.write(`${USAGE}\n`);
      process.exitCode = 2;
    }
  } finally {
    await queue.close();
    await connection.quit();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof ConfigError || error instanceof Error
      ? error.message
      : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

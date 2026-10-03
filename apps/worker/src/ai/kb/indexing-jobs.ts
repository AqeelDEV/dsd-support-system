import {
  kbArticlePublishedSchema,
  kbArticleUnpublishedSchema,
} from "@dsd/shared";
import type { Queue } from "bullmq";
import { z } from "zod";

import type { Logger } from "../../logger.js";
import { InvalidEventError } from "../../queues/errors.js";
import type { KnowledgeIndexRepository } from "./knowledge-index.repository.js";

/** What a reconcile job carries: the article to bring up to date. */
export interface ReconcileJob {
  articleId: string;
}

const reconcileJobSchema = z.object({ articleId: z.uuid() });

/**
 * The article a `kb-indexing` job is about: from the payload of a
 * `kb.article_published` or `kb.article_unpublished` event, or from a
 * reconcile job. The indexer looks the article up itself, so the job needs
 * nothing else.
 */
export function articleIdOf(data: unknown): string {
  if (typeof data === "object" && data !== null && "payload" in data) {
    const event = z
      .union([kbArticlePublishedSchema, kbArticleUnpublishedSchema])
      .safeParse(data.payload);
    if (event.success) return event.data.articleId;
  } else {
    const job = reconcileJobSchema.safeParse(data);
    if (job.success) return job.data.articleId;
  }
  throw new InvalidEventError("A kb-indexing job without an article ID");
}

/** Keeps a model name usable in a job ID: BullMQ refuses `:` there. */
const jobIdPart = (text: string) => text.replace(/[^A-Za-z0-9._-]/g, "-");

/**
 * Finds every article whose chunks don't match it, and queues it for
 * indexing (ADR-0006, amended). This is the backfill of articles published
 * before indexing existed, the re-embedding after a change of embedding
 * model, and the safety net for an event whose job was lost. It runs when
 * the worker starts and every night.
 *
 * Each job's ID names the state it brings the article to (status, version,
 * embedding model), so workers starting together queue each article once;
 * a failed one is removed at once (its dead letter keeps the record), so
 * the next run can try again.
 */
export async function reconcileKnowledgeBase(
  repository: KnowledgeIndexRepository,
  queue: Queue,
  embeddingModel: string | null,
  logger: Logger,
): Promise<number> {
  const articles = await repository.outOfDate(embeddingModel);
  if (articles.length > 0) {
    await queue.addBulk(
      articles.map((article) => ({
        name: "kb.reconcile",
        data: { articleId: article.id } satisfies ReconcileJob,
        opts: {
          jobId: `reconcile.${article.id}.${article.status}.v${String(article.version)}.${jobIdPart(embeddingModel ?? "none")}`,
          removeOnFail: true,
        },
      })),
    );
  }
  logger.info({ articles: articles.length }, "knowledge base reconciled");
  return articles.length;
}

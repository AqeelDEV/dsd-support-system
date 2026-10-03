import type { Database } from "@dsd/db";
import { kbArticles, kbChunks } from "@dsd/db/schema";
import type { KbArticleStatus } from "@dsd/shared";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/executor.js";

export interface ArticleState {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: KbArticleStatus;
  version: number;
}

export interface StoredChunk {
  id: string;
  chunkIndex: number;
  headingPath: string;
  content: string;
  embeddingModel: string | null;
}

export interface NewChunk {
  index: number;
  headingPath: string;
  content: string;
  tokenCount: number;
  embedding: number[] | null;
  embeddingModel: string | null;
}

/**
 * What knowledge-base indexing reads and writes. The worker may read
 * articles and read, insert and update chunks; it can't delete them, so an
 * old version's chunks are only ever marked not current (ADR-0006,
 * section 3; ADR-0008).
 */
export class KnowledgeIndexRepository {
  constructor(private readonly db: Database) {}

  async article(
    articleId: string,
    executor: Executor = this.db,
  ): Promise<ArticleState | undefined> {
    const [row] = await executor
      .select({
        id: kbArticles.id,
        title: kbArticles.title,
        bodyMarkdown: kbArticles.bodyMarkdown,
        status: kbArticles.status,
        version: kbArticles.version,
      })
      .from(kbArticles)
      .where(eq(kbArticles.id, articleId));
    return row;
  }

  /** The chunks already written for one article version, in order. */
  async chunksOf(
    articleId: string,
    version: number,
    executor: Executor = this.db,
  ): Promise<StoredChunk[]> {
    return executor
      .select({
        id: kbChunks.id,
        chunkIndex: kbChunks.chunkIndex,
        headingPath: kbChunks.headingPath,
        content: kbChunks.content,
        embeddingModel: kbChunks.embeddingModel,
      })
      .from(kbChunks)
      .where(
        and(
          eq(kbChunks.articleId, articleId),
          eq(kbChunks.articleVersion, version),
        ),
      )
      .orderBy(asc(kbChunks.chunkIndex));
  }

  /**
   * Runs `write` in one transaction that holds this article's indexing
   * lock, so two jobs for the same article (a publish and a reconcile, or
   * two quick publishes) never interleave their writes. An advisory lock,
   * because the worker can't lock article rows it isn't allowed to update.
   */
  async locked<T>(
    articleId: string,
    write: (tx: Executor) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`kb-index:${articleId}`}, 0))`,
      );
      return write(tx);
    });
  }

  async insertChunks(
    executor: Executor,
    articleId: string,
    version: number,
    chunks: readonly NewChunk[],
  ): Promise<void> {
    if (chunks.length === 0) return;
    await executor.insert(kbChunks).values(
      chunks.map((chunk) => ({
        articleId,
        articleVersion: version,
        chunkIndex: chunk.index,
        headingPath: chunk.headingPath,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        embedding: chunk.embedding,
        embeddingModel: chunk.embeddingModel,
      })),
    );
  }

  /** New vectors for chunks whose text stays exactly as it was written. */
  async updateEmbeddings(
    executor: Executor,
    updates: readonly { id: string; embedding: number[]; model: string }[],
  ): Promise<void> {
    for (const update of updates) {
      await executor
        .update(kbChunks)
        .set({ embedding: update.embedding, embeddingModel: update.model })
        .where(eq(kbChunks.id, update.id));
    }
  }

  /** Makes one version's chunks the current ones, and every other version's not. */
  async makeCurrent(
    executor: Executor,
    articleId: string,
    version: number,
  ): Promise<void> {
    await executor
      .update(kbChunks)
      .set({ isCurrent: true })
      .where(
        and(
          eq(kbChunks.articleId, articleId),
          eq(kbChunks.articleVersion, version),
          eq(kbChunks.isCurrent, false),
        ),
      );
    await executor
      .update(kbChunks)
      .set({ isCurrent: false })
      .where(
        and(
          eq(kbChunks.articleId, articleId),
          ne(kbChunks.articleVersion, version),
          eq(kbChunks.isCurrent, true),
        ),
      );
  }

  /** Takes every chunk of an article out of retrieval. */
  async retire(executor: Executor, articleId: string): Promise<number> {
    const rows = await executor
      .update(kbChunks)
      .set({ isCurrent: false })
      .where(
        and(eq(kbChunks.articleId, articleId), eq(kbChunks.isCurrent, true)),
      )
      .returning({ id: kbChunks.id });
    return rows.length;
  }

  /**
   * Articles whose chunks don't match their state: published ones whose
   * version has no chunks, has chunks not marked current or embedded with
   * another model (when `model` is set), or that still have another
   * version's chunks current; and unpublished ones with current chunks.
   */
  async outOfDate(
    model: string | null,
  ): Promise<{ id: string; status: KbArticleStatus; version: number }[]> {
    const result = await this.db.execute<{
      id: string;
      status: KbArticleStatus;
      version: number;
    }>(sql`
      SELECT a.id, a.status, a.version
        FROM ${kbArticles} a
       WHERE (a.status = 'published' AND (
               NOT EXISTS (SELECT 1 FROM ${kbChunks} c
                            WHERE c.article_id = a.id AND c.article_version = a.version)
               OR EXISTS (SELECT 1 FROM ${kbChunks} c
                           WHERE c.article_id = a.id AND c.article_version = a.version
                             AND (NOT c.is_current
                                  OR (${model}::text IS NOT NULL
                                      AND c.embedding_model IS DISTINCT FROM ${model}::text)))
               OR EXISTS (SELECT 1 FROM ${kbChunks} c
                           WHERE c.article_id = a.id AND c.is_current
                             AND c.article_version <> a.version)))
          OR (a.status <> 'published' AND EXISTS (
               SELECT 1 FROM ${kbChunks} c WHERE c.article_id = a.id AND c.is_current))
       ORDER BY a.id`);
    return result.rows;
  }
}

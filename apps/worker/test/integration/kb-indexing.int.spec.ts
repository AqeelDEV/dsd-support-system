import { randomUUID } from "node:crypto";

import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { KnowledgeIndexer } from "../../src/ai/kb/indexer.js";
import { reconcileKnowledgeBase } from "../../src/ai/kb/indexing-jobs.js";
import { KnowledgeIndexRepository } from "../../src/ai/kb/knowledge-index.repository.js";
import { MockEmbeddingModel } from "../../src/ai/providers/mock-embeddings.js";
import type { Env } from "../../src/config/env.js";
import type { Container } from "../../src/container.js";
import type { Worker } from "../../src/lifecycle.js";
import {
  capturedLogger,
  eventually,
  fixtures,
  startTestWorker,
  testEnv,
} from "../support/worker.js";

interface ChunkRow {
  id: string;
  article_version: number;
  chunk_index: number;
  heading_path: string;
  content: string;
  is_current: boolean;
  embedding_model: string | null;
  embedded: boolean;
}

/**
 * Knowledge-base indexing (ADR-0006, section 3, amended): the worker keeps
 * each article's chunks in step with the article, whatever asked it to,
 * and brings the whole index up to date when it starts.
 */
describe("knowledge-base indexing", () => {
  let database: TestDatabase;
  let env: Env;
  let worker: Worker;
  let container: Container;
  const { logger } = capturedLogger();

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_kb_indexing");
    env = testEnv(database);
    ({ worker, container } = await startTestWorker(env));
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  const chunksOf = (articleId: string) =>
    asOwner<ChunkRow>(
      database,
      `SELECT id, article_version, chunk_index, heading_path, content, is_current,
              embedding_model, embedding IS NOT NULL AS embedded
         FROM kb_chunks WHERE article_id = $1
        ORDER BY article_version, chunk_index`,
      [articleId],
    );

  const articleId = async (slug: string) => {
    const [row] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM kb_articles WHERE slug = $1",
      [slug],
    );
    if (row === undefined) throw new Error(`no article ${slug}`);
    return row.id;
  };

  /** Every published article has current chunks for its version. */
  const indexed = async () => {
    const [row] = await asOwner<{ missing: number }>(
      database,
      `SELECT count(*)::int AS missing FROM kb_articles a
        WHERE a.status = 'published' AND NOT EXISTS (
          SELECT 1 FROM kb_chunks c
           WHERE c.article_id = a.id AND c.article_version = a.version AND c.is_current)`,
    );
    return row?.missing === 0 ? true : undefined;
  };

  it("indexes every published article when the worker starts, and no draft", async () => {
    await eventually(indexed, 30_000);
    const [summary] = await asOwner<{
      articles: number;
      chunks: number;
      unembedded: number;
      models: string[];
      drafts: number;
    }>(
      database,
      `SELECT count(DISTINCT c.article_id)::int AS articles,
              count(*)::int AS chunks,
              count(*) FILTER (WHERE c.embedding IS NULL)::int AS unembedded,
              array_agg(DISTINCT c.embedding_model) AS models,
              count(*) FILTER (WHERE a.status <> 'published')::int AS drafts
         FROM kb_chunks c JOIN kb_articles a ON a.id = c.article_id
        WHERE c.is_current`,
    );
    expect(summary).toMatchObject({
      articles: 33,
      unembedded: 0,
      models: ["mock-hash-v1"],
      drafts: 0,
    });
    expect(summary?.chunks).toBeGreaterThan(33);

    const refunds = await chunksOf(await articleId("refund-timescales"));
    expect(refunds.map((chunk) => chunk.heading_path)).toEqual([
      "How long refunds take > When we issue the refund",
      "How long refunds take > When you see the money",
      "How long refunds take > It has been longer than that",
    ]);
  });

  it("indexes a republished article's new version and retires the old one, keeping its text", async () => {
    await eventually(indexed, 30_000);
    const id = await articleId("track-your-delivery");
    const before = await chunksOf(id);

    await asOwner(
      database,
      `UPDATE kb_articles
          SET body_markdown = body_markdown || E'\n\n## Saturday deliveries\n\nExpress orders placed on Friday arrive on Saturday.',
              version = version + 1, published_at = now()
        WHERE id = $1`,
      [id],
    );
    await fixtures.event(
      database,
      "kb.article_published",
      { type: "kb_article", id },
      { articleId: id, version: 2 },
    );

    const after = await eventually(async () => {
      const rows = await chunksOf(id);
      return rows.some((row) => row.article_version === 2 && row.is_current)
        ? rows
        : undefined;
    });
    const old = after.filter((row) => row.article_version === 1);
    expect(old.map((row) => [row.id, row.content, row.is_current])).toEqual(
      before.map((row) => [row.id, row.content, false]),
    );
    const current = after.filter((row) => row.is_current);
    expect(current.every((row) => row.article_version === 2)).toBe(true);
    expect(current.at(-1)).toMatchObject({
      heading_path: "Track your delivery > Saturday deliveries",
      embedding_model: "mock-hash-v1",
      embedded: true,
    });
  });

  it("takes an archived article out of retrieval at once", async () => {
    await eventually(indexed, 30_000);
    const id = await articleId("where-we-deliver");
    await asOwner(
      database,
      "UPDATE kb_articles SET status = 'archived' WHERE id = $1",
      [id],
    );
    await fixtures.event(
      database,
      "kb.article_unpublished",
      { type: "kb_article", id },
      { articleId: id },
    );
    await eventually(async () => {
      const rows = await chunksOf(id);
      return rows.length > 0 && rows.every((row) => !row.is_current)
        ? true
        : undefined;
    });
  });

  it("re-embeds chunks for a new embedding model and leaves their text as written", async () => {
    await eventually(indexed, 30_000);
    const id = await articleId("card-declined");
    const before = await chunksOf(id);
    const indexer = new KnowledgeIndexer(
      new KnowledgeIndexRepository(container.db),
      new MockEmbeddingModel("mock-hash-v2"),
      logger,
    );

    expect(await indexer.index(id)).toBe("embedded");
    const after = await chunksOf(id);
    expect(after.map((row) => [row.id, row.content, row.is_current])).toEqual(
      before.map((row) => [row.id, row.content, true]),
    );
    expect(after.every((row) => row.embedding_model === "mock-hash-v2")).toBe(
      true,
    );
    expect(await indexer.index(id)).toBe("up-to-date");
  });

  it("indexes without vectors when no embedding model is configured", async () => {
    const [created] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO kb_articles (brand_id, slug, title, summary, body_markdown, status, version,
                                published_at, author_agent_id, updated_by_agent_id)
       SELECT b.id, $1, 'Lumen Desk Lamp colour temperature', 'Warm or cool light.',
              E'## Change it\n\nSlide along the touch strip.', 'published', 1, now(), a.id, a.id
         FROM brands b, agents a
        WHERE b.slug = 'dsd' AND a.email_normalized = 'supervisor@dsd.example'
       RETURNING id`,
      [`lumen-colour-${randomUUID()}`],
    );
    const id = created?.id ?? "";
    const indexer = new KnowledgeIndexer(
      new KnowledgeIndexRepository(container.db),
      null,
      logger,
    );
    expect(await indexer.index(id)).toBe("indexed");
    expect(await chunksOf(id)).toEqual([
      expect.objectContaining({
        heading_path: "Lumen Desk Lamp colour temperature > Change it",
        is_current: true,
        embedded: false,
        embedding_model: null,
      }),
    ]);
  });

  it("queues every out-of-date article once, under an ID that names its target state", async () => {
    await eventually(indexed, 30_000);
    const repository = new KnowledgeIndexRepository(container.db);
    // The tests above left articles embedded with other models; indexing
    // each out-of-date article once brings the whole index back in step.
    const indexer = new KnowledgeIndexer(
      repository,
      new MockEmbeddingModel("mock-hash-v1"),
      logger,
    );
    for (const article of await repository.outOfDate("mock-hash-v1")) {
      await indexer.index(article.id);
    }
    expect(await repository.outOfDate("mock-hash-v1")).toEqual([]);

    // A new embedding model makes every published article out of date.
    const queue = new Queue("kb-indexing-reconcile-test", {
      connection: container.producer,
      prefix: env.QUEUE_PREFIX,
    });
    try {
      const queued = await reconcileKnowledgeBase(
        repository,
        queue,
        "mock-hash-v3",
        logger,
      );
      expect(queued).toBeGreaterThanOrEqual(32);
      await reconcileKnowledgeBase(repository, queue, "mock-hash-v3", logger);
      expect(await queue.getJobCounts("waiting")).toEqual({ waiting: queued });
      const [job] = await queue.getJobs(["waiting"], 0, 0);
      expect(job?.id).toMatch(
        /^reconcile\.[0-9a-f-]{36}\.published\.v\d+\.mock-hash-v3$/,
      );
    } finally {
      await queue.obliterate({ force: true });
      await queue.close();
    }
  });
});

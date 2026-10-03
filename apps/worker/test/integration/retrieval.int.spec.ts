import { randomUUID } from "node:crypto";

import {
  asOwner,
  createSeededDatabase,
  type TestDatabase,
} from "@dsd/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hashEmbedding } from "../../src/ai/providers/mock-embeddings.js";
import { MockEmbeddingModel } from "../../src/ai/providers/mock-embeddings.js";
import {
  isGrounded,
  thresholdsFor,
} from "../../src/ai/retrieval/confidence.js";
import { Retriever, TOP_CHUNKS } from "../../src/ai/retrieval/retriever.js";
import type { Container } from "../../src/container.js";
import type { Worker } from "../../src/lifecycle.js";
import { eventually, startTestWorker, testEnv } from "../support/worker.js";

/**
 * Hybrid retrieval (ADR-0006, section 4) on the seeded knowledge base,
 * indexed by the worker with the mock embeddings: the right article comes
 * first, and nothing outside the ticket's brand, nothing unpublished and
 * no stale version is ever retrieved, even when its chunk is marked
 * current by mistake.
 */
describe("retrieval", () => {
  let database: TestDatabase;
  let worker: Worker;
  let container: Container;
  let brandId: string;
  const thresholds = thresholdsFor("mock-hash-v1");

  beforeAll(async () => {
    database = await createSeededDatabase("dsd_test_worker_retrieval");
    ({ worker, container } = await startTestWorker(testEnv(database)));
    const [brand] = await asOwner<{ id: string }>(
      database,
      "SELECT id FROM brands WHERE slug = 'dsd'",
    );
    brandId = brand?.id ?? "";
    await eventually(async () => {
      const [row] = await asOwner<{ missing: number }>(
        database,
        `SELECT count(*)::int AS missing FROM kb_articles a
          WHERE a.status = 'published' AND NOT EXISTS (
            SELECT 1 FROM kb_chunks c WHERE c.article_id = a.id
               AND c.article_version = a.version AND c.is_current)`,
      );
      return row?.missing === 0 ? true : undefined;
    }, 30_000);
  });

  afterAll(async () => {
    await worker.stop();
    await database.drop();
  });

  const hybrid = () =>
    new Retriever(container.db, new MockEmbeddingModel("mock-hash-v1"));

  it("finds the article that answers a ticket first, with both searches' scores", async () => {
    const result = await hybrid().retrieve(
      brandId,
      "Refund not on my card yet\nI returned the camera and got the refund email a week ago. When will the money reach my bank?",
    );
    expect(result.mode).toBe("hybrid");
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks.length).toBeLessThanOrEqual(TOP_CHUNKS);
    expect(result.chunks[0]).toMatchObject({
      articleTitle: "How long refunds take",
      rank: 1,
    });
    expect(result.chunks.map((chunk) => chunk.rank)).toEqual(
      result.chunks.map((_, index) => index + 1),
    );
    const scores = result.chunks.map((chunk) => chunk.fusedScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(result.topVectorScore).toBeGreaterThan(0);
    expect(result.topKeywordScore).toBeGreaterThan(0);
    expect(result.topMatchedTerms).toBeGreaterThanOrEqual(3);
    expect(isGrounded(result, thresholds)).toBe(true);
  });

  it("finds it on keywords alone when no embedding model is configured", async () => {
    const result = await new Retriever(container.db, null).retrieve(
      brandId,
      "How long does a refund take to reach my card?",
    );
    expect(result.mode).toBe("fts_only");
    expect(result.topVectorScore).toBeNull();
    expect(result.chunks.every((chunk) => chunk.vectorScore === null)).toBe(
      true,
    );
    expect(
      result.chunks.slice(0, 3).map((chunk) => chunk.articleTitle),
    ).toContain("How long refunds take");
  });

  it("doesn't clear the confidence gate for a ticket the knowledge base doesn't cover", async () => {
    const result = await hybrid().retrieve(
      brandId,
      "Job openings\nAre you hiring software engineers for the Lisbon office this year?",
    );
    expect(isGrounded(result, thresholds)).toBe(false);
  });

  it("never retrieves a draft, a stale version, another brand's article or another model's vectors", async () => {
    const canary = `zephyrium${randomUUID().slice(0, 8)}`;
    const text = `The ${canary} setting controls the ${canary} sensor.`;
    const vector = JSON.stringify(hashEmbedding(text));
    const [other] = await asOwner<{ id: string }>(
      database,
      `INSERT INTO brands (slug, name, ticket_prefix, support_email)
       VALUES ('retrieval-other', 'Other', 'RTO', 'support@other.example') RETURNING id`,
    );
    // Rogue rows written as the schema owner, each marked current, which
    // the indexer itself would never leave behind.
    const article = async (
      brand: string,
      status: string,
      version: number,
    ): Promise<string> => {
      const [row] = await asOwner<{ id: string }>(
        database,
        `INSERT INTO kb_articles (brand_id, slug, title, body_markdown, status, version,
                                  published_at, author_agent_id, updated_by_agent_id)
         SELECT $1, $2, 'Canary', 'x', $3::kb_article_status, $4,
                CASE WHEN $3 = 'published' THEN now() END, id, id
           FROM agents WHERE email_normalized = 'supervisor@dsd.example'
         RETURNING id`,
        [brand, `canary-${randomUUID()}`, status, version],
      );
      return row?.id ?? "";
    };
    const chunk = (articleId: string, version: number, model: string) =>
      asOwner(
        database,
        `INSERT INTO kb_chunks (article_id, article_version, chunk_index, heading_path, content,
                                token_count, embedding, embedding_model, is_current)
         VALUES ($1, $2, 0, 'Canary', $3, 10, $4::vector, $5, true)`,
        [articleId, version, text, vector, model],
      );
    await chunk(await article(brandId, "draft", 0), 0, "mock-hash-v1");
    await chunk(await article(brandId, "published", 2), 1, "mock-hash-v1");
    const otherBrandArticle = await article(other?.id ?? "", "published", 1);
    await chunk(otherBrandArticle, 1, "mock-hash-v1");
    const otherModelArticle = await article(brandId, "published", 1);
    await chunk(otherModelArticle, 1, "another-model");

    // Vector search always returns the nearest chunks, however far, so
    // the results also hold unrelated seeded chunks; none of the rogue
    // rows may be among them except the one written with another model's
    // vector, and that one only through its words.
    const inBrand = await hybrid().retrieve(brandId, canary);
    const found = inBrand.chunks.filter((chunk) =>
      chunk.content.includes(canary),
    );
    expect(found.map((chunk) => chunk.articleId)).toEqual([otherModelArticle]);
    expect(found[0]?.vectorScore).toBeNull();
    expect(found[0]?.keywordScore).toBeGreaterThan(0);

    const elsewhere = await hybrid().retrieve(other?.id ?? "", canary);
    expect(elsewhere.chunks.map((chunk) => chunk.articleId)).toEqual([
      otherBrandArticle,
    ]);
  });
});

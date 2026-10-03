import type { Database } from "@dsd/db";
import type { RetrievalMode } from "@dsd/shared";
import { sql } from "drizzle-orm";

import type { EmbeddingModel } from "../providers/types.js";
import type { RetrievalSignals } from "./confidence.js";
import { fuse } from "./fusion.js";

/** Candidates each search returns before fusion. */
export const CANDIDATES = 20;
/** Chunks that go forward to the prompt. */
export const TOP_CHUNKS = 6;

export interface RetrievedChunk {
  chunkId: string;
  articleId: string;
  articleTitle: string;
  articleVersion: number;
  headingPath: string;
  content: string;
  /** Cosine similarity, when vector search found it. */
  vectorScore: number | null;
  /** Normalised `ts_rank_cd`, when keyword search found it. */
  keywordScore: number | null;
  matchedTerms: number | null;
  fusedScore: number;
  /** 1-based, after fusion. */
  rank: number;
}

export interface Retrieval extends RetrievalSignals {
  mode: RetrievalMode;
  chunks: RetrievedChunk[];
}

/** One search result row; drizzle's `execute` wants rows with an index signature. */
interface Hit extends Record<string, unknown> {
  chunk_id: string;
  score: number;
  matched?: number;
}

/**
 * Hybrid retrieval (ADR-0006, section 4). Keyword search catches the exact
 * tokens support tickets are full of (order numbers, error codes, product
 * names); vector search catches paraphrases ("can't get in" for "sign-in
 * problems"). Both look only at current chunks of articles that are
 * published, at their current version, in the ticket's brand, and their
 * ranked lists are fused with RRF. Without an embedding model, the same
 * pipeline runs on keywords alone.
 */
export class Retriever {
  constructor(
    private readonly db: Database,
    private readonly embeddings: EmbeddingModel | null,
  ) {}

  async retrieve(brandId: string, query: string): Promise<Retrieval> {
    const [keyword, vector] = await Promise.all([
      this.keywordSearch(brandId, query),
      this.embeddings === null
        ? Promise.resolve(null)
        : this.vectorSearch(brandId, query, this.embeddings),
    ]);
    const lists = [keyword.map((hit) => hit.chunk_id)];
    if (vector !== null) lists.push(vector.map((hit) => hit.chunk_id));
    const fused = fuse(lists, TOP_CHUNKS);

    const details = await this.details(fused.map((item) => item.id));
    const byId = <T extends Hit>(hits: readonly T[] | null, id: string) =>
      hits?.find((hit) => hit.chunk_id === id);
    const chunks = fused.flatMap((item, index): RetrievedChunk[] => {
      const detail = details.get(item.id);
      if (detail === undefined) return [];
      const keywordHit = byId(keyword, item.id);
      return [
        {
          ...detail,
          vectorScore: byId(vector, item.id)?.score ?? null,
          keywordScore: keywordHit?.score ?? null,
          matchedTerms: keywordHit?.matched ?? null,
          fusedScore: item.score,
          rank: index + 1,
        },
      ];
    });

    return {
      mode: vector === null ? "fts_only" : "hybrid",
      chunks,
      topVectorScore: vector?.[0]?.score ?? null,
      topKeywordScore: keyword[0]?.score ?? null,
      topMatchedTerms: keyword[0]?.matched ?? null,
    };
  }

  /** Where a chunk may come from: current, published at its version, in the brand. */
  private eligible(brandId: string) {
    return sql`c.is_current AND a.status = 'published'
           AND a.version = c.article_version AND a.brand_id = ${brandId}`;
  }

  /**
   * The words of a ticket combined with OR: ticket text is long, so
   * requiring every word would match nothing. With OR, `ts_rank_cd` alone
   * favours a chunk that repeats one word over one that covers the ticket,
   * so chunks are ordered by how many distinct query words they contain
   * (`matched`, which the confidence gate also reads), then by rank.
   */
  private async keywordSearch(brandId: string, query: string): Promise<Hit[]> {
    const result = await this.db.execute<Hit>(sql`
      WITH q AS (
        SELECT replace(plainto_tsquery('english', ${query})::text, '&', '|')::tsquery AS query,
               tsvector_to_array(to_tsvector('english', ${query})) AS terms
      )
      SELECT c.id AS chunk_id,
             ts_rank_cd(c.search_vector, q.query, 32)::float8 AS score,
             cardinality(ARRAY(
               SELECT unnest(tsvector_to_array(c.search_vector))
               INTERSECT SELECT unnest(q.terms)))::int AS matched
        FROM kb_chunks c
        JOIN kb_articles a ON a.id = c.article_id
        CROSS JOIN q
       WHERE ${this.eligible(brandId)} AND c.search_vector @@ q.query
       ORDER BY matched DESC, score DESC, c.id
       LIMIT ${CANDIDATES}`);
    return result.rows;
  }

  /**
   * The nearest chunks by cosine distance, compared only with vectors from
   * the same embedding model. The HNSW index is scanned iteratively, so
   * filtering by brand and status still yields enough candidates; the
   * materialised CTE restores exact order after the relaxed scan.
   */
  private async vectorSearch(
    brandId: string,
    query: string,
    embeddings: EmbeddingModel,
  ): Promise<Hit[]> {
    const vector = JSON.stringify(await embeddings.embedQuery(query));
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = relaxed_order`);
      const result = await tx.execute<Hit>(sql`
        WITH nearest AS MATERIALIZED (
          SELECT c.id AS chunk_id, c.embedding <=> ${vector}::vector AS distance
            FROM kb_chunks c
            JOIN kb_articles a ON a.id = c.article_id
           WHERE ${this.eligible(brandId)}
             AND c.embedding IS NOT NULL AND c.embedding_model = ${embeddings.model}
           ORDER BY c.embedding <=> ${vector}::vector
           LIMIT ${CANDIDATES}
        )
        SELECT chunk_id, (1 - distance)::float8 AS score
          FROM nearest ORDER BY distance, chunk_id`);
      return result.rows;
    });
  }

  private async details(ids: readonly string[]) {
    const found = new Map<
      string,
      Pick<
        RetrievedChunk,
        | "chunkId"
        | "articleId"
        | "articleTitle"
        | "articleVersion"
        | "headingPath"
        | "content"
      >
    >();
    if (ids.length === 0) return found;
    const result = await this.db.execute<{
      chunk_id: string;
      article_id: string;
      article_title: string;
      article_version: number;
      heading_path: string;
      content: string;
    }>(sql`
      SELECT c.id AS chunk_id, a.id AS article_id, a.title AS article_title,
             c.article_version, c.heading_path, c.content
        FROM kb_chunks c JOIN kb_articles a ON a.id = c.article_id
       WHERE c.id IN ${[...ids]}`);
    for (const row of result.rows) {
      found.set(row.chunk_id, {
        chunkId: row.chunk_id,
        articleId: row.article_id,
        articleTitle: row.article_title,
        articleVersion: row.article_version,
        headingPath: row.heading_path,
        content: row.content,
      });
    }
    return found;
  }
}

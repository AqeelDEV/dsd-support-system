import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { brands } from "./brands.js";
import { createdAt, id, timestamptz, tsvector, updatedAt } from "./columns.js";
import { kbArticleStatus } from "./enums.js";
import { agents } from "./identity.js";

/** Embedding size of every stored vector (ADR-0006). */
export const EMBEDDING_DIMENSIONS = 1024;

export const kbCategories = pgTable(
  "kb_categories",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("kb_categories_brand_slug_key").on(table.brandId, table.slug),
  ],
);

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: id(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => kbCategories.id, {
      onDelete: "restrict",
    }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    bodyMarkdown: text("body_markdown").notNull(),
    /** Matched by filter, not folded into the search document. */
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: kbArticleStatus("status").notNull().default("draft"),
    /** Incremented on each publish; editing a published article doesn't change it. */
    version: integer("version").notNull().default(0),
    publishedAt: timestamptz("published_at"),
    /** Keyword search (FR-4): title weighted A, summary B, body C. */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', summary), 'B') || setweight(to_tsvector('english', body_markdown), 'C')`,
    ),
    authorAgentId: uuid("author_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    updatedByAgentId: uuid("updated_by_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    check(
      "kb_articles_published_ck",
      sql`${table.status} <> 'published' OR ${table.publishedAt} IS NOT NULL`,
    ),
    // Stable public URLs per brand.
    unique("kb_articles_brand_slug_key").on(table.brandId, table.slug),
    index("kb_articles_search_idx").using("gin", table.searchVector),
    index("kb_articles_browse_idx").on(
      table.brandId,
      table.status,
      table.publishedAt.desc().nullsFirst(),
    ),
    index("kb_articles_tags_idx").using("gin", table.tags),
  ],
);

/**
 * Retrieval units for AI suggestions. A new article version gets new
 * chunks and the old ones stay, marked not current, so a stored suggestion
 * can always show the exact text it used.
 */
export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: id(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => kbArticles.id, { onDelete: "restrict" }),
    articleVersion: integer("article_version").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    /** For example "Billing > Refunds", so a chunk makes sense on its own. */
    headingPath: text("heading_path").notNull().default(""),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', heading_path), 'A') || setweight(to_tsvector('english', content), 'B')`,
    ),
    /** Empty when no embedding provider is configured. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text("embedding_model"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [
    unique("kb_chunks_article_version_index_key").on(
      table.articleId,
      table.articleVersion,
      table.chunkIndex,
    ),
    index("kb_chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    index("kb_chunks_search_idx").using("gin", table.searchVector),
    index("kb_chunks_article_current_idx").on(table.articleId, table.isCurrent),
  ],
);

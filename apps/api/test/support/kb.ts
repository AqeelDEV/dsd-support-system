import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { KbArticleStatus } from "@dsd/shared";

import { DEMO } from "./auth.js";
import { asOwner, idOf } from "./database.js";
import { demoBrandId } from "./tickets.js";

export interface NewArticle {
  title?: string;
  summary?: string;
  body?: string;
  status?: KbArticleStatus;
  tags?: string[];
  categoryId?: string | null;
  brandId?: string;
}

/**
 * An article written straight to the database as the schema owner, with a
 * unique slug, for tests about reading or changing one. It has no history.
 */
export async function newArticle(
  database: TestDatabase,
  article: NewArticle = {},
): Promise<{ id: string; slug: string }> {
  const slug = `article-${randomUUID()}`;
  const status = article.status ?? "draft";
  const supervisorId = await idOf(database, "agents", DEMO.supervisor);
  const [row] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO kb_articles (brand_id, category_id, slug, title, summary, body_markdown,
                              tags, status, version, published_at, author_agent_id, updated_by_agent_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::kb_article_status,
             CASE WHEN $8::kb_article_status = 'draft' THEN 0 ELSE 1 END,
             CASE WHEN $8::kb_article_status = 'published' THEN now() END, $9, $9)
     RETURNING id`,
    [
      article.brandId ?? (await demoBrandId(database)),
      article.categoryId ?? null,
      slug,
      article.title ?? "An article written by a test",
      article.summary ?? "",
      article.body ?? "Written by a test.",
      article.tags ?? [],
      status,
      supervisorId,
    ],
  );
  if (row === undefined) throw new Error("article insert returned nothing");
  return { id: row.id, slug };
}

/** A category in the demo brand with a unique slug. */
export async function newCategory(
  database: TestDatabase,
  brandId?: string,
): Promise<{ id: string; slug: string }> {
  const slug = `category-${randomUUID()}`;
  const [row] = await asOwner<{ id: string }>(
    database,
    "INSERT INTO kb_categories (brand_id, slug, name) VALUES ($1, $2, 'A test category') RETURNING id",
    [brandId ?? (await demoBrandId(database)), slug],
  );
  if (row === undefined) throw new Error("category insert returned nothing");
  return { id: row.id, slug };
}

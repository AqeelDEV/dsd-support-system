import { Injectable } from "@nestjs/common";
import {
  agentBrandMemberships,
  agents,
  kbArticles,
  kbCategories,
} from "@dsd/db/schema";
import { type KbArticleStatus, SNIPPET_MARKERS } from "@dsd/shared";
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  inArray,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { Position } from "../../common/cursor.js";
import type { Executor } from "../../infrastructure/database.js";

/** Staff see knowledge-base content in their brands only (ADR-0004, section 6). */
function articleInBrandsOf(agentId: string): SQL {
  return inArray(
    kbArticles.brandId,
    sql`(SELECT ${agentBrandMemberships.brandId} FROM ${agentBrandMemberships} WHERE ${agentBrandMemberships.agentId} = ${agentId})`,
  );
}

function categoryInBrandsOf(agentId: string): SQL {
  return inArray(
    kbCategories.brandId,
    sql`(SELECT ${agentBrandMemberships.brandId} FROM ${agentBrandMemberships} WHERE ${agentBrandMemberships.agentId} = ${agentId})`,
  );
}

/** `websearch_to_tsquery` understands quotes, `or` and `-word`, and never fails on odd input. */
const tsquery = (q: string) => sql`websearch_to_tsquery('english', ${q})`;

/** Microsecond timestamps for cursors, as for tickets. */
const exact = (column: SQL | typeof kbArticles.updatedAt) =>
  sql<string>`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * Snippet options: matched words wrapped in private-use characters, which
 * article text can never contain (the sanitiser strips them), so the API
 * can split on them and hand the client plain text.
 */
const HEADLINE_OPTIONS = `StartSel=${SNIPPET_MARKERS.start}, StopSel=${SNIPPET_MARKERS.stop}, MaxWords=30, MinWords=12, MaxFragments=2, FragmentDelimiter=" ... "`;

const author = alias(agents, "author");
const updatedBy = alias(agents, "updated_by");

const staffSummaryColumns = {
  id: kbArticles.id,
  brandId: kbArticles.brandId,
  category: {
    id: kbCategories.id,
    slug: kbCategories.slug,
    name: kbCategories.name,
  },
  slug: kbArticles.slug,
  title: kbArticles.title,
  summary: kbArticles.summary,
  tags: kbArticles.tags,
  status: kbArticles.status,
  version: kbArticles.version,
  publishedAt: kbArticles.publishedAt,
  updatedBy: { id: updatedBy.id, displayName: updatedBy.displayName },
  updatedAt: kbArticles.updatedAt,
  cursorAt: exact(kbArticles.updatedAt),
};

const publicColumns = {
  id: kbArticles.id,
  slug: kbArticles.slug,
  title: kbArticles.title,
  summary: kbArticles.summary,
  tags: kbArticles.tags,
  category: { slug: kbCategories.slug, name: kbCategories.name },
  publishedAt: kbArticles.publishedAt,
};

/** A locked article, with what the publishing rules need. */
export interface LockedArticle {
  id: string;
  brandId: string;
  status: KbArticleStatus;
  version: number;
}

export interface ArticleFields {
  categoryId?: string | null;
  slug?: string;
  title?: string;
  summary?: string;
  bodyMarkdown?: string;
  tags?: string[];
}

export interface PublicFilters {
  categorySlug: string | undefined;
  tag: string | undefined;
}

/** The constraints a client can run into with a duplicate. */
export const UNIQUE = {
  articleSlug: "kb_articles_brand_slug_key",
  categorySlug: "kb_categories_brand_slug_key",
} as const;

/**
 * Knowledge-base rows (FR-4, FR-15). Staff reads filter by the agent's
 * brands; public reads take the public brand and see published articles
 * only, in SQL, so a draft can't come back from a public route.
 */
@Injectable()
export class KbRepository {
  // Categories

  async categoriesForStaff(executor: Executor, agentId: string) {
    return executor
      .select()
      .from(kbCategories)
      .where(categoryInBrandsOf(agentId))
      .orderBy(
        asc(kbCategories.position),
        asc(kbCategories.name),
        asc(kbCategories.id),
      );
  }

  async categoryForStaff(executor: Executor, agentId: string, id: string) {
    const [row] = await executor
      .select()
      .from(kbCategories)
      .where(and(eq(kbCategories.id, id), categoryInBrandsOf(agentId)));
    return row;
  }

  async insertCategory(
    executor: Executor,
    category: { brandId: string; slug: string; name: string; position: number },
  ): Promise<string> {
    const [row] = await executor
      .insert(kbCategories)
      .values(category)
      .returning({ id: kbCategories.id });
    if (row === undefined) throw new Error("category insert returned nothing");
    return row.id;
  }

  async updateCategory(
    executor: Executor,
    id: string,
    fields: { slug?: string; name?: string; position?: number },
  ): Promise<void> {
    await executor
      .update(kbCategories)
      .set(fields)
      .where(eq(kbCategories.id, id));
  }

  async articlesInCategory(executor: Executor, id: string): Promise<number> {
    const [row] = await executor
      .select({ count: count() })
      .from(kbArticles)
      .where(eq(kbArticles.categoryId, id));
    return row?.count ?? 0;
  }

  async deleteCategory(executor: Executor, id: string): Promise<void> {
    await executor.delete(kbCategories).where(eq(kbCategories.id, id));
  }

  /** Whether a category exists in this brand, for an article being filed under it. */
  async categoryInBrand(
    executor: Executor,
    brandId: string,
    id: string,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: kbCategories.id })
      .from(kbCategories)
      .where(and(eq(kbCategories.id, id), eq(kbCategories.brandId, brandId)));
    return row !== undefined;
  }

  async publicCategories(executor: Executor, brandId: string) {
    return executor
      .select({
        slug: kbCategories.slug,
        name: kbCategories.name,
        articleCount: sql<number>`count(${kbArticles.id})::int`,
      })
      .from(kbCategories)
      .leftJoin(
        kbArticles,
        and(
          eq(kbArticles.categoryId, kbCategories.id),
          eq(kbArticles.status, "published"),
        ),
      )
      .where(eq(kbCategories.brandId, brandId))
      .groupBy(kbCategories.id)
      .orderBy(
        asc(kbCategories.position),
        asc(kbCategories.name),
        asc(kbCategories.id),
      );
  }

  // Articles, staff side

  /** Most recently changed first, with one extra row to show whether another page follows. */
  async staffPage(
    executor: Executor,
    agentId: string,
    filters: {
      statuses: readonly KbArticleStatus[] | undefined;
      categoryId: string | undefined;
      q: string | undefined;
    },
    page: { limit: number; after: Position<[string]> | undefined },
  ) {
    const after = page.after;
    return executor
      .select(staffSummaryColumns)
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .innerJoin(updatedBy, eq(updatedBy.id, kbArticles.updatedByAgentId))
      .where(
        and(
          articleInBrandsOf(agentId),
          filters.statuses === undefined
            ? undefined
            : inArray(kbArticles.status, [...filters.statuses]),
          filters.categoryId === undefined
            ? undefined
            : eq(kbArticles.categoryId, filters.categoryId),
          filters.q === undefined
            ? undefined
            : sql`${kbArticles.searchVector} @@ ${tsquery(filters.q)}`,
          after === undefined
            ? undefined
            : sql`(${kbArticles.updatedAt}, ${kbArticles.id}) < (${after.keys[0]}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(kbArticles.updatedAt), desc(kbArticles.id))
      .limit(page.limit + 1);
  }

  async staffArticle(executor: Executor, agentId: string, id: string) {
    const [row] = await executor
      .select({
        ...staffSummaryColumns,
        bodyMarkdown: kbArticles.bodyMarkdown,
        author: { id: author.id, displayName: author.displayName },
        createdAt: kbArticles.createdAt,
      })
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .innerJoin(updatedBy, eq(updatedBy.id, kbArticles.updatedByAgentId))
      .innerJoin(author, eq(author.id, kbArticles.authorAgentId))
      .where(and(eq(kbArticles.id, id), articleInBrandsOf(agentId)));
    return row;
  }

  /** Locks an article in the agent's brands until the transaction ends. */
  async lockForStaff(
    executor: Executor,
    agentId: string,
    id: string,
  ): Promise<LockedArticle | undefined> {
    const [row] = await executor
      .select({
        id: kbArticles.id,
        brandId: kbArticles.brandId,
        status: kbArticles.status,
        version: kbArticles.version,
      })
      .from(kbArticles)
      .where(and(eq(kbArticles.id, id), articleInBrandsOf(agentId)))
      .for("update");
    return row;
  }

  async insertArticle(
    executor: Executor,
    article: Required<Omit<ArticleFields, "categoryId">> & {
      brandId: string;
      categoryId: string | null;
      agentId: string;
    },
  ): Promise<string> {
    const [row] = await executor
      .insert(kbArticles)
      .values({
        brandId: article.brandId,
        categoryId: article.categoryId,
        slug: article.slug,
        title: article.title,
        summary: article.summary,
        bodyMarkdown: article.bodyMarkdown,
        tags: article.tags,
        authorAgentId: article.agentId,
        updatedByAgentId: article.agentId,
      })
      .returning({ id: kbArticles.id });
    if (row === undefined) throw new Error("article insert returned nothing");
    return row.id;
  }

  async updateArticle(
    executor: Executor,
    id: string,
    agentId: string,
    fields: ArticleFields,
  ): Promise<void> {
    await executor
      .update(kbArticles)
      .set({ ...fields, updatedByAgentId: agentId })
      .where(eq(kbArticles.id, id));
  }

  /** Publishes the next version: `published_at` records the latest publication. */
  async publish(
    executor: Executor,
    id: string,
    agentId: string,
  ): Promise<number> {
    const [row] = await executor
      .update(kbArticles)
      .set({
        status: "published",
        version: sql`${kbArticles.version} + 1`,
        publishedAt: sql`now()`,
        updatedByAgentId: agentId,
      })
      .where(eq(kbArticles.id, id))
      .returning({ version: kbArticles.version });
    if (row === undefined) throw new Error("publish updated nothing");
    return row.version;
  }

  async setStatus(
    executor: Executor,
    id: string,
    agentId: string,
    status: "draft" | "archived",
  ): Promise<void> {
    await executor
      .update(kbArticles)
      .set({ status, updatedByAgentId: agentId })
      .where(eq(kbArticles.id, id));
  }

  // Articles, public side

  /** Published articles, newest publication first. */
  async publicBrowse(
    executor: Executor,
    brandId: string,
    filters: PublicFilters,
    page: { limit: number; after: Position<[string]> | undefined },
  ) {
    const after = page.after;
    return executor
      .select({
        ...publicColumns,
        cursorAt: exact(sql`${kbArticles.publishedAt}`),
      })
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .where(
        and(
          this.publicFilters(brandId, filters),
          after === undefined
            ? undefined
            : sql`(${kbArticles.publishedAt}, ${kbArticles.id}) < (${after.keys[0]}::timestamptz, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(kbArticles.publishedAt), desc(kbArticles.id))
      .limit(page.limit + 1);
  }

  /**
   * Published articles matching `q`, best first (FR-4). `ts_rank_cd` weighs
   * the title (A) above the summary (B) above the body (C). The rank is
   * read as float8 in both the select and the cursor comparison, so a
   * cursor's rank compares equal to the row it came from.
   */
  async publicSearch(
    executor: Executor,
    brandId: string,
    q: string,
    filters: PublicFilters,
    page: { limit: number; after: Position<[number]> | undefined },
  ) {
    const query = tsquery(q);
    const rank = sql<number>`ts_rank_cd(${kbArticles.searchVector}, ${query})::float8`;
    const after = page.after;
    return executor
      .select({
        ...publicColumns,
        rank,
        snippet: sql<string>`ts_headline('english', ${kbArticles.summary} || ' ' || ${kbArticles.bodyMarkdown}, ${query}, ${HEADLINE_OPTIONS})`,
      })
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .where(
        and(
          this.publicFilters(brandId, filters),
          sql`${kbArticles.searchVector} @@ ${query}`,
          after === undefined
            ? undefined
            : sql`(${rank}, ${kbArticles.id}) < (${after.keys[0]}::float8, ${after.id}::uuid)`,
        ),
      )
      .orderBy(desc(rank), desc(kbArticles.id))
      .limit(page.limit + 1);
  }

  async publicArticle(executor: Executor, brandId: string, slug: string) {
    const [row] = await executor
      .select({ ...publicColumns, bodyMarkdown: kbArticles.bodyMarkdown })
      .from(kbArticles)
      .leftJoin(kbCategories, eq(kbCategories.id, kbArticles.categoryId))
      .where(
        and(
          eq(kbArticles.brandId, brandId),
          eq(kbArticles.status, "published"),
          eq(kbArticles.slug, slug),
        ),
      );
    return row;
  }

  private publicFilters(
    brandId: string,
    filters: PublicFilters,
  ): SQL | undefined {
    return and(
      eq(kbArticles.brandId, brandId),
      eq(kbArticles.status, "published"),
      filters.categorySlug === undefined
        ? undefined
        : eq(kbCategories.slug, filters.categorySlug),
      filters.tag === undefined
        ? undefined
        : arrayContains(kbArticles.tags, [filters.tag]),
    );
  }
}

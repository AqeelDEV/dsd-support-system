import { Inject, Injectable } from "@nestjs/common";
import {
  type KbPublicArticle,
  type KbPublicArticleQuery,
  type KbPublicArticleSummary,
  type KbPublicCategory,
  PROBLEM_TYPES,
} from "@dsd/shared";
import { z } from "zod";

import { decodeCursor, encodeCursor, pageFrom } from "../../common/cursor.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { BrandsRepository } from "../brands/brands.repository.js";
import { snippetSegments } from "./domain/snippet.js";
import { KbRepository } from "./kb.repository.js";

const BY_PUBLISHED = "published";
const BY_RANK = "rank";

interface PublicRow {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  category: { slug: string; name: string } | null;
  publishedAt: Date | null;
}

/** Published rows always have it (kb_articles_published_ck). */
function publishedAt(row: PublicRow): string {
  if (row.publishedAt === null) {
    throw new Error(`published article without published_at: ${row.slug}`);
  }
  return row.publishedAt.toISOString();
}

function toSummary(
  row: PublicRow,
  snippet: string | null,
): KbPublicArticleSummary {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    tags: row.tags,
    publishedAt: publishedAt(row),
    snippet: snippet === null ? null : snippetSegments(snippet),
  };
}

/**
 * The public help centre (FR-4): published articles of the public brand,
 * browsed newest first or searched with PostgreSQL full-text search. No
 * session is needed, and nothing unpublished can come back, because the
 * queries filter on the status.
 */
@Injectable()
export class KbPublicService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly kb: KbRepository,
    private readonly brands: BrandsRepository,
  ) {}

  async categories(): Promise<KbPublicCategory[]> {
    return this.kb.publicCategories(
      this.db,
      await this.brands.publicBrandId(this.db),
    );
  }

  async articles(query: KbPublicArticleQuery) {
    const brandId = await this.brands.publicBrandId(this.db);
    const filters = { categorySlug: query.category, tag: query.tag };
    if (query.q === undefined) {
      const after =
        query.cursor === undefined
          ? undefined
          : decodeCursor(query.cursor, BY_PUBLISHED, z.tuple([z.string()]));
      const rows = await this.kb.publicBrowse(this.db, brandId, filters, {
        limit: query.limit,
        after,
      });
      return pageFrom(
        rows,
        query.limit,
        (row) => toSummary(row, null),
        (row) =>
          encodeCursor(BY_PUBLISHED, { keys: [row.cursorAt], id: row.id }),
      );
    }
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, BY_RANK, z.tuple([z.number()]));
    const rows = await this.kb.publicSearch(
      this.db,
      brandId,
      query.q,
      filters,
      {
        limit: query.limit,
        after,
      },
    );
    return pageFrom(
      rows,
      query.limit,
      (row) => toSummary(row, row.snippet),
      (row) => encodeCursor(BY_RANK, { keys: [row.rank], id: row.id }),
    );
  }

  async article(slug: string): Promise<KbPublicArticle> {
    const row = await this.kb.publicArticle(
      this.db,
      await this.brands.publicBrandId(this.db),
      slug,
    );
    if (row === undefined) {
      throw new ProblemException(404, PROBLEM_TYPES.blank, "No such article.");
    }
    return {
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      bodyMarkdown: row.bodyMarkdown,
      category: row.category,
      tags: row.tags,
      publishedAt: publishedAt(row),
    };
  }
}

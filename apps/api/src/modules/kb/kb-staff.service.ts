import { Inject, Injectable } from "@nestjs/common";
import {
  type KbArticleCreateRequest,
  type KbArticleUpdateRequest,
  type KbCategory,
  type KbCategoryCreateRequest,
  type KbCategoryUpdateRequest,
  type KbStaffArticle,
  type KbStaffArticleQuery,
  type KbStaffArticleSummary,
  PROBLEM_TYPES,
  sanitizeMarkdown,
  slugify,
} from "@dsd/shared";
import { z } from "zod";

import type { StaffPrincipal } from "../../auth/principal.js";
import { decodeCursor, encodeCursor, pageFrom } from "../../common/cursor.js";
import { sqlState, violates } from "../../common/pg-errors.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { AuditRepository } from "../audit/audit.repository.js";
import { BrandsRepository } from "../brands/brands.repository.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { staffContext } from "../tickets/ticket-changes.js";
import {
  type ArticleFields,
  KbRepository,
  type LockedArticle,
  UNIQUE,
} from "./kb.repository.js";

const BY_UPDATED = "updated";

const notFound = (what: "article" | "category") =>
  new ProblemException(
    404,
    PROBLEM_TYPES.blank,
    `No such ${what} in your brands.`,
  );

const slugTaken = (what: "article" | "category") =>
  new ProblemException(
    409,
    PROBLEM_TYPES.alreadyExists,
    `Another ${what} in this brand already uses that slug.`,
  );

/** Runs `write`, turning a duplicate slug into a 409 instead of a 500. */
async function uniqueSlug<T>(
  what: "article" | "category",
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (
      violates(
        error,
        what === "article" ? UNIQUE.articleSlug : UNIQUE.categorySlug,
      )
    ) {
      throw slugTaken(what);
    }
    throw error;
  }
}

type ArticleRow = NonNullable<
  Awaited<ReturnType<KbRepository["staffArticle"]>>
>;
type ArticleSummaryRow = Awaited<ReturnType<KbRepository["staffPage"]>>[number];

function toSummary(row: ArticleSummaryRow): KbStaffArticleSummary {
  return {
    id: row.id,
    brandId: row.brandId,
    category: row.category,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    tags: row.tags,
    status: row.status,
    version: row.version,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toArticle(row: ArticleRow): KbStaffArticle {
  return {
    ...toSummary(row),
    bodyMarkdown: row.bodyMarkdown,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

function toCategory(row: {
  id: string;
  brandId: string;
  slug: string;
  name: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
}): KbCategory {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Writing and publishing knowledge-base articles (FR-15; ADR-0012).
 * Articles start as drafts. Publishing makes a new version, and saving a
 * published article publishes the saved text as the next version, so what
 * customers read is always what gets indexed for AI suggestions. Every
 * publish, unpublish and archive writes its audit event and, when the
 * public content changes, its outbox event, in the same transaction.
 */
@Injectable()
export class KbStaffService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly kb: KbRepository,
    private readonly brands: BrandsRepository,
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  // Categories

  async categories(principal: StaffPrincipal): Promise<KbCategory[]> {
    const rows = await this.kb.categoriesForStaff(this.db, principal.agent.id);
    return rows.map(toCategory);
  }

  async createCategory(
    principal: StaffPrincipal,
    request: KbCategoryCreateRequest,
  ): Promise<KbCategory> {
    const brandId = await this.brands.forNewContent(
      this.db,
      principal.agent.id,
      request.brandId,
    );
    const id = await uniqueSlug("category", () =>
      this.kb.insertCategory(this.db, {
        brandId,
        name: request.name,
        slug: request.slug ?? slugify(request.name, "category"),
        position: request.position,
      }),
    );
    return this.category(principal, id);
  }

  async updateCategory(
    principal: StaffPrincipal,
    id: string,
    request: KbCategoryUpdateRequest,
  ): Promise<KbCategory> {
    await this.category(principal, id);
    await uniqueSlug("category", () =>
      this.kb.updateCategory(this.db, id, request),
    );
    return this.category(principal, id);
  }

  /** Only an empty category can go: articles keep their category (409 otherwise). */
  async deleteCategory(principal: StaffPrincipal, id: string): Promise<void> {
    await this.category(principal, id);
    const inUse = () =>
      new ProblemException(
        409,
        PROBLEM_TYPES.blank,
        "Articles are filed under this category. Move them first.",
      );
    if ((await this.kb.articlesInCategory(this.db, id)) > 0) throw inUse();
    try {
      await this.kb.deleteCategory(this.db, id);
    } catch (error) {
      // An article filed under it a moment ago: the foreign key refuses.
      if (sqlState(error) === "23503") throw inUse();
      throw error;
    }
  }

  private async category(
    principal: StaffPrincipal,
    id: string,
  ): Promise<KbCategory> {
    const row = await this.kb.categoryForStaff(this.db, principal.agent.id, id);
    if (row === undefined) throw notFound("category");
    return toCategory(row);
  }

  // Articles

  async articles(principal: StaffPrincipal, query: KbStaffArticleQuery) {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, BY_UPDATED, z.tuple([z.string()]));
    const rows = await this.kb.staffPage(
      this.db,
      principal.agent.id,
      { statuses: query.status, categoryId: query.categoryId, q: query.q },
      { limit: query.limit, after },
    );
    return pageFrom(rows, query.limit, toSummary, (row) =>
      encodeCursor(BY_UPDATED, { keys: [row.cursorAt], id: row.id }),
    );
  }

  async article(
    principal: StaffPrincipal,
    id: string,
  ): Promise<KbStaffArticle> {
    const row = await this.kb.staffArticle(this.db, principal.agent.id, id);
    if (row === undefined) throw notFound("article");
    return toArticle(row);
  }

  /** A new draft. The body is sanitised before it is stored. */
  async createArticle(
    principal: StaffPrincipal,
    request: KbArticleCreateRequest,
  ): Promise<KbStaffArticle> {
    const id = await this.db.transaction(async (tx) => {
      const brandId = await this.brands.forNewContent(
        tx,
        principal.agent.id,
        request.brandId,
      );
      const categoryId = request.categoryId ?? null;
      await this.assertCategory(tx, brandId, categoryId);
      return uniqueSlug("article", () =>
        this.kb.insertArticle(tx, {
          brandId,
          categoryId,
          slug: request.slug ?? slugify(request.title, "article"),
          title: request.title,
          summary: request.summary,
          bodyMarkdown: sanitizeMarkdown(request.bodyMarkdown),
          tags: [...new Set(request.tags)],
          agentId: principal.agent.id,
        }),
      );
    });
    return this.article(principal, id);
  }

  /**
   * Saves changes. A published article is republished as the next
   * version, so that needs `kb:publish` as well as `kb:write`.
   */
  async updateArticle(
    principal: StaffPrincipal,
    id: string,
    request: KbArticleUpdateRequest,
    requestId: string,
  ): Promise<KbStaffArticle> {
    await this.underLock(principal, id, async (tx, article) => {
      if (
        article.status === "published" &&
        !principal.permissions.has("kb:publish")
      ) {
        throw new ProblemException(
          403,
          PROBLEM_TYPES.blank,
          "Saving a published article publishes it, which needs the `kb:publish` permission.",
        );
      }
      if (request.categoryId !== undefined) {
        await this.assertCategory(tx, article.brandId, request.categoryId);
      }
      const fields: ArticleFields = {
        ...request,
        ...(request.bodyMarkdown === undefined
          ? {}
          : { bodyMarkdown: sanitizeMarkdown(request.bodyMarkdown) }),
        ...(request.tags === undefined
          ? {}
          : { tags: [...new Set(request.tags)] }),
      };
      await uniqueSlug("article", () =>
        this.kb.updateArticle(tx, article.id, principal.agent.id, fields),
      );
      if (article.status === "published") {
        await this.publishNext(tx, principal, article, requestId);
      }
    });
    return this.article(principal, id);
  }

  /** Publishes a draft or archived article as its next version; a published one is a no-op. */
  async publish(
    principal: StaffPrincipal,
    id: string,
    requestId: string,
  ): Promise<KbStaffArticle> {
    await this.underLock(principal, id, async (tx, article) => {
      if (article.status === "published") return;
      await this.publishNext(tx, principal, article, requestId);
    });
    return this.article(principal, id);
  }

  /** Back to draft: off the help centre, and out of AI retrieval. */
  async unpublish(
    principal: StaffPrincipal,
    id: string,
    requestId: string,
  ): Promise<KbStaffArticle> {
    await this.underLock(principal, id, async (tx, article) => {
      if (article.status === "draft") return;
      await this.withdraw(tx, principal, article, "draft", requestId);
    });
    return this.article(principal, id);
  }

  /** Archived: kept, but out of every list a customer or the AI sees. */
  async archive(
    principal: StaffPrincipal,
    id: string,
    requestId: string,
  ): Promise<KbStaffArticle> {
    await this.underLock(principal, id, async (tx, article) => {
      if (article.status === "archived") return;
      await this.withdraw(tx, principal, article, "archived", requestId);
    });
    return this.article(principal, id);
  }

  private async publishNext(
    tx: Executor,
    principal: StaffPrincipal,
    article: LockedArticle,
    requestId: string,
  ): Promise<void> {
    const version = await this.kb.publish(tx, article.id, principal.agent.id);
    await this.audit.record(tx, staffContext(principal, requestId), [
      {
        ticketId: null,
        entityType: "kb_article",
        entityId: article.id,
        action: "kb.article_published",
        before: { status: article.status, version: article.version },
        after: { status: "published", version },
      },
    ]);
    await this.outbox.add(tx, {
      type: "kb.article_published",
      aggregateType: "kb_article",
      aggregateId: article.id,
      payload: { articleId: article.id, version },
    });
  }

  private async withdraw(
    tx: Executor,
    principal: StaffPrincipal,
    article: LockedArticle,
    to: "draft" | "archived",
    requestId: string,
  ): Promise<void> {
    await this.kb.setStatus(tx, article.id, principal.agent.id, to);
    await this.audit.record(tx, staffContext(principal, requestId), [
      {
        ticketId: null,
        entityType: "kb_article",
        entityId: article.id,
        action:
          to === "draft" ? "kb.article_unpublished" : "kb.article_archived",
        before: { status: article.status },
        after: { status: to },
      },
    ]);
    // Only a change to what the public sees concerns the index.
    if (article.status === "published") {
      await this.outbox.add(tx, {
        type: "kb.article_unpublished",
        aggregateType: "kb_article",
        aggregateId: article.id,
        payload: { articleId: article.id },
      });
    }
  }

  /** A category must belong to the article's brand (422 otherwise, as for an unusable assignee). */
  private async assertCategory(
    tx: Executor,
    brandId: string,
    categoryId: string | null,
  ): Promise<void> {
    if (categoryId === null) return;
    if (!(await this.kb.categoryInBrand(tx, brandId, categoryId))) {
      throw new ProblemException(
        422,
        PROBLEM_TYPES.blank,
        "That category doesn't exist in this article's brand.",
      );
    }
  }

  private async underLock(
    principal: StaffPrincipal,
    id: string,
    change: (tx: Executor, article: LockedArticle) => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const article = await this.kb.lockForStaff(tx, principal.agent.id, id);
      if (article === undefined) throw notFound("article");
      await change(tx, article);
    });
  }
}

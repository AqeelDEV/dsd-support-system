import { Injectable } from "@nestjs/common";
import {
  agentBrandMemberships,
  agents,
  aiSuggestionFeedback,
  aiSuggestions,
  aiSuggestionSources,
  kbArticles,
  kbChunks,
  tickets,
} from "@dsd/db/schema";
import type { AiSuggestionStatus, FeedbackRating } from "@dsd/shared";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

/** A suggestion as staff read it, before citations are attached. */
export interface SuggestionRow {
  id: string;
  ticketId: string;
  status: AiSuggestionStatus;
  draftBody: string | null;
  rejectionReason: string | null;
  requestedById: string | null;
  requestedByName: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  retrievalMode: string;
  createdAt: Date;
  completedAt: Date | null;
  feedbackRating: FeedbackRating | null;
  feedbackComment: string | null;
  feedbackUpdatedAt: Date | null;
  /** `created_at` to the microsecond, for cursors. */
  cursorAt: string;
}

/** One article a ready draft cites, with the text it was given. */
export interface CitationRow {
  suggestionId: string;
  articleId: string;
  slug: string;
  title: string;
  headingPath: string;
  excerpt: string;
  articleVersion: number;
  current: boolean;
}

/** A suggestion's ticket, when it is in one of the agent's brands. */
export interface SuggestionTarget {
  id: string;
  ticketId: string;
  status: AiSuggestionStatus;
}

/** Brand scope for staff (ADR-0004, section 6), on the suggestion's ticket. */
function ticketInBrandsOf(agentId: string): SQL {
  return inArray(
    tickets.brandId,
    sql`(SELECT ${agentBrandMemberships.brandId} FROM ${agentBrandMemberships} WHERE ${agentBrandMemberships.agentId} = ${agentId})`,
  );
}

/**
 * Reading suggestions and recording agents' ratings (ADR-0006, section
 * 11). The API never writes a suggestion: the worker does, and the API only
 * reads them, keeps feedback, and checks one before a reply may use it.
 */
@Injectable()
export class AiSuggestionsRepository {
  /**
   * One page of a ticket's suggestions, newest first, with the agent's own
   * rating, and one row more than `limit` to show whether another follows.
   * The caller has already checked the ticket is in the agent's brands.
   */
  async page(
    executor: Executor,
    agentId: string,
    ticketId: string,
    page: { limit: number; after: { at: string; id: string } | undefined },
  ): Promise<SuggestionRow[]> {
    const after: SQL | undefined =
      page.after === undefined
        ? undefined
        : sql`(${aiSuggestions.createdAt}, ${aiSuggestions.id}) < (${page.after.at}::timestamptz, ${page.after.id}::uuid)`;
    return executor
      .select({
        id: aiSuggestions.id,
        ticketId: aiSuggestions.ticketId,
        status: aiSuggestions.status,
        draftBody: aiSuggestions.draftBody,
        rejectionReason: aiSuggestions.rejectionReason,
        requestedById: aiSuggestions.requestedByAgentId,
        requestedByName: agents.displayName,
        provider: aiSuggestions.provider,
        model: aiSuggestions.model,
        promptVersion: aiSuggestions.promptVersion,
        retrievalMode: aiSuggestions.retrievalMode,
        createdAt: aiSuggestions.createdAt,
        completedAt: aiSuggestions.completedAt,
        feedbackRating: aiSuggestionFeedback.rating,
        feedbackComment: aiSuggestionFeedback.comment,
        feedbackUpdatedAt: aiSuggestionFeedback.updatedAt,
        cursorAt: sql<string>`to_char(${aiSuggestions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(aiSuggestions)
      .leftJoin(agents, eq(agents.id, aiSuggestions.requestedByAgentId))
      .leftJoin(
        aiSuggestionFeedback,
        and(
          eq(aiSuggestionFeedback.suggestionId, aiSuggestions.id),
          eq(aiSuggestionFeedback.agentId, agentId),
        ),
      )
      .where(and(eq(aiSuggestions.ticketId, ticketId), after))
      .orderBy(desc(aiSuggestions.createdAt), desc(aiSuggestions.id))
      .limit(page.limit + 1);
  }

  /**
   * The cited sources of these suggestions, in retrieval order. The excerpt
   * is the chunk's text, which never changes for its article version, so it
   * is exactly what the draft was based on; the title is the article's as it
   * is now; `current` says whether that text is still what's published.
   */
  async citations(
    executor: Executor,
    suggestionIds: readonly string[],
  ): Promise<CitationRow[]> {
    if (suggestionIds.length === 0) return [];
    return executor
      .select({
        suggestionId: aiSuggestionSources.suggestionId,
        articleId: kbArticles.id,
        slug: kbArticles.slug,
        title: kbArticles.title,
        headingPath: kbChunks.headingPath,
        excerpt: kbChunks.content,
        articleVersion: kbChunks.articleVersion,
        current: sql<boolean>`(${kbChunks.isCurrent} AND ${kbArticles.status} = 'published' AND ${kbArticles.version} = ${kbChunks.articleVersion})`,
      })
      .from(aiSuggestionSources)
      .innerJoin(kbChunks, eq(kbChunks.id, aiSuggestionSources.chunkId))
      .innerJoin(kbArticles, eq(kbArticles.id, kbChunks.articleId))
      .where(
        and(
          inArray(aiSuggestionSources.suggestionId, [...suggestionIds]),
          eq(aiSuggestionSources.cited, true),
        ),
      )
      .orderBy(
        asc(aiSuggestionSources.suggestionId),
        asc(aiSuggestionSources.rank),
      );
  }

  /** The suggestion and its ticket, or undefined when it's missing or outside the agent's brands. */
  async target(
    executor: Executor,
    agentId: string,
    suggestionId: string,
  ): Promise<SuggestionTarget | undefined> {
    const [row] = await executor
      .select({
        id: aiSuggestions.id,
        ticketId: aiSuggestions.ticketId,
        status: aiSuggestions.status,
      })
      .from(aiSuggestions)
      .innerJoin(tickets, eq(tickets.id, aiSuggestions.ticketId))
      .where(
        and(eq(aiSuggestions.id, suggestionId), ticketInBrandsOf(agentId)),
      );
    return row;
  }

  /** The agent's one rating of a suggestion, replaced if they rate it again. */
  async saveFeedback(
    executor: Executor,
    feedback: {
      suggestionId: string;
      agentId: string;
      rating: FeedbackRating;
      comment: string | null;
    },
  ): Promise<{
    rating: FeedbackRating;
    comment: string | null;
    updatedAt: Date;
  }> {
    const [row] = await executor
      .insert(aiSuggestionFeedback)
      .values(feedback)
      .onConflictDoUpdate({
        target: [
          aiSuggestionFeedback.suggestionId,
          aiSuggestionFeedback.agentId,
        ],
        set: {
          rating: feedback.rating,
          comment: feedback.comment,
          updatedAt: sql`now()`,
        },
      })
      .returning({
        rating: aiSuggestionFeedback.rating,
        comment: aiSuggestionFeedback.comment,
        updatedAt: aiSuggestionFeedback.updatedAt,
      });
    if (row === undefined) throw new Error("feedback upsert returned nothing");
    return row;
  }

  /** The database's clock, which the worker's rows are stamped with too. */
  async now(executor: Executor): Promise<Date> {
    const result = await executor.execute<{ now: Date }>(
      sql`SELECT now() AS now`,
    );
    const now = result.rows[0]?.now;
    if (now === undefined) throw new Error("now() returned nothing");
    return new Date(now);
  }
}

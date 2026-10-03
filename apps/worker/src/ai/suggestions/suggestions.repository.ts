import type { Database } from "@dsd/db";
import { aiSuggestions, aiSuggestionSources } from "@dsd/db/schema";
import type { AiSuggestionStatus, RetrievalMode } from "@dsd/shared";
import { and, eq, sql } from "drizzle-orm";

import type { DraftOutcome } from "./drafter.js";

export interface SuggestionStart {
  ticketId: string;
  triggerEventId: string;
  requestedByAgentId: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  retrievalMode: RetrievalMode;
}

/** The longest provider error kept on a failed suggestion. */
const MAX_ERROR_LENGTH = 500;

/**
 * `ai_suggestions` and `ai_suggestion_sources`, the only things the AI
 * pipeline writes (ADR-0006, section 1). There is one suggestion per ticket
 * and triggering event, so a retried or repeated job finds the same row
 * instead of adding one (ADR-0005, section 5).
 */
export class SuggestionsRepository {
  constructor(private readonly db: Database) {}

  /**
   * The suggestion for this ticket and event, created as `pending` if it
   * doesn't exist yet. A failed one (a replayed dead letter) goes back to
   * `pending`; any other status is returned as it is, so a job that runs
   * again after finishing does nothing.
   */
  async start(
    start: SuggestionStart,
  ): Promise<{ id: string; status: AiSuggestionStatus }> {
    const [row] = await this.db
      .insert(aiSuggestions)
      .values({
        ticketId: start.ticketId,
        triggerEventId: start.triggerEventId,
        requestedByAgentId: start.requestedByAgentId,
        provider: start.provider,
        model: start.model,
        promptVersion: start.promptVersion,
        retrievalMode: start.retrievalMode,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [aiSuggestions.ticketId, aiSuggestions.triggerEventId],
        set: {
          status: sql`CASE WHEN ${aiSuggestions.status} = 'failed' THEN 'pending'::ai_suggestion_status ELSE ${aiSuggestions.status} END`,
          error: sql`CASE WHEN ${aiSuggestions.status} = 'failed' THEN NULL ELSE ${aiSuggestions.error} END`,
          completedAt: sql`CASE WHEN ${aiSuggestions.status} = 'failed' THEN NULL ELSE ${aiSuggestions.completedAt} END`,
        },
      })
      .returning({ id: aiSuggestions.id, status: aiSuggestions.status });
    if (row === undefined)
      throw new Error("suggestion upsert returned nothing");
    return row;
  }

  /**
   * Records the outcome and every retrieved chunk in one transaction, only
   * if the suggestion is still pending. Returns false when another run got
   * there first, in which case nothing is written.
   */
  async finish(id: string, outcome: DraftOutcome): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updated = await tx
        .update(aiSuggestions)
        .set({
          status: outcome.status,
          model: outcome.model,
          retrievalMode: outcome.retrieval.mode,
          topVectorScore: outcome.retrieval.topVectorScore,
          topFtsScore: outcome.retrieval.topKeywordScore,
          draftBody: outcome.draft,
          output: outcome.output,
          rejectionReason: outcome.rejectionReason,
          latencyMs: outcome.latencyMs,
          inputTokens: outcome.usage?.inputTokens ?? null,
          outputTokens: outcome.usage?.outputTokens ?? null,
          completedAt: sql`now()`,
        })
        .where(
          and(eq(aiSuggestions.id, id), eq(aiSuggestions.status, "pending")),
        )
        .returning({ id: aiSuggestions.id });
      if (updated.length === 0) return false;
      const cited = new Set(outcome.citedChunkIds);
      if (outcome.retrieval.chunks.length > 0) {
        await tx.insert(aiSuggestionSources).values(
          outcome.retrieval.chunks.map((chunk) => ({
            suggestionId: id,
            chunkId: chunk.chunkId,
            rank: chunk.rank,
            vectorScore: chunk.vectorScore,
            ftsScore: chunk.keywordScore,
            fusedScore: chunk.fusedScore,
            cited: cited.has(chunk.chunkId),
          })),
        );
      }
      return true;
    });
  }

  /**
   * Marks this ticket's older suggestions that are still pending as failed.
   * A newer message replaces a debounced job while it waits, including one
   * waiting to retry, and the replaced job never finishes; without this its
   * suggestion would show as being drafted for ever. Only older rows are
   * touched, and only one job per ticket runs at a time, so a draft in
   * progress is never marked.
   */
  async supersedeOlder(id: string, ticketId: string): Promise<void> {
    await this.db
      .update(aiSuggestions)
      .set({
        status: "failed",
        error: "Superseded by a newer draft for this ticket before it finished",
        completedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiSuggestions.ticketId, ticketId),
          eq(aiSuggestions.status, "pending"),
          sql`${aiSuggestions.createdAt} < (SELECT created_at FROM ai_suggestions WHERE id = ${id})`,
        ),
      );
  }

  /** Marks a suggestion failed after its job's last attempt (ADR-0005, section 4). */
  async fail(
    ticketId: string,
    triggerEventId: string,
    error: string,
  ): Promise<void> {
    await this.db
      .update(aiSuggestions)
      .set({
        status: "failed",
        error: error.slice(0, MAX_ERROR_LENGTH),
        completedAt: sql`now()`,
      })
      .where(
        and(
          eq(aiSuggestions.ticketId, ticketId),
          eq(aiSuggestions.triggerEventId, triggerEventId),
          eq(aiSuggestions.status, "pending"),
        ),
      );
  }

  /** Of `chunkIds`, those whose article is still published at that chunk's version. */
  async stillPublished(chunkIds: readonly string[]): Promise<Set<string>> {
    if (chunkIds.length === 0) return new Set();
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT c.id FROM kb_chunks c JOIN kb_articles a ON a.id = c.article_id
       WHERE c.id IN ${[...chunkIds]} AND c.is_current
         AND a.status = 'published' AND a.version = c.article_version`);
    return new Set(result.rows.map((row) => row.id));
  }
}

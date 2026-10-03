import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";
import type { AiSuggestionStatus } from "@dsd/shared";

import { asOwner } from "./database.js";
import { newArticle } from "./kb.js";

export interface NewSuggestion {
  status?: AiSuggestionStatus;
  draft?: string;
  rejectionReason?: string;
  requestedByAgentId?: string;
  /** Written this long ago, for ordering tests. */
  secondsAgo?: number;
}

/** A suggestion as the worker stores it, and the article chunk it cites. */
export interface StoredSuggestion {
  id: string;
  articleId: string;
  chunkId: string;
}

/**
 * A suggestion written straight to the database as the schema owner, the
 * way the worker would store it: a `ready` one has a draft and cites one
 * chunk of a fresh published article, with a second chunk retrieved but
 * not cited. The API never writes suggestions, so tests make them here.
 */
export async function newSuggestion(
  database: TestDatabase,
  ticketId: string,
  suggestion: NewSuggestion = {},
): Promise<StoredSuggestion> {
  const status = suggestion.status ?? "ready";
  const article = await newArticle(database, {
    status: "published",
    title: "How long refunds take",
  });
  const [cited, other] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO kb_chunks (article_id, article_version, chunk_index, heading_path, content, token_count)
     VALUES ($1, 1, 0, 'How long refunds take > Timing', 'Refunds reach your card in 3 to 5 working days.', 12),
            ($1, 1, 1, 'How long refunds take > Card statements', 'Your bank may show the refund as pending first.', 11)
     RETURNING id`,
    [article.id],
  );
  const [row] = await asOwner<{ id: string }>(
    database,
    `INSERT INTO ai_suggestions (ticket_id, status, trigger_event_id, requested_by_agent_id, provider,
                                 model, prompt_version, retrieval_mode, draft_body, output,
                                 rejection_reason, created_at, completed_at)
     VALUES ($1, $2::ai_suggestion_status, $3, $4, 'mock', 'mock-grounded-v1', 'reply-draft/v1', 'hybrid',
             CASE WHEN $2 = 'ready' THEN $5 END,
             CASE WHEN $2 IN ('ready', 'rejected') THEN '{"status":"answered"}'::jsonb END,
             $6, now() - make_interval(secs => $7),
             CASE WHEN $2 <> 'pending' THEN now() - make_interval(secs => $7) END)
     RETURNING id`,
    [
      ticketId,
      status,
      randomUUID(),
      suggestion.requestedByAgentId ?? null,
      suggestion.draft ??
        "Refunds reach your card in 3 to 5 working days after we issue them.",
      status === "rejected"
        ? (suggestion.rejectionReason ?? "citation_not_in_retrieved_set")
        : null,
      suggestion.secondsAgo ?? 0,
    ],
  );
  if (row === undefined || cited === undefined || other === undefined) {
    throw new Error("suggestion insert returned nothing");
  }
  await asOwner(
    database,
    `INSERT INTO ai_suggestion_sources (suggestion_id, chunk_id, rank, vector_score, fts_score, fused_score, cited)
     VALUES ($1, $2, 1, 0.81, 0.4, 0.032, true), ($1, $3, 2, 0.62, NULL, 0.016, false)`,
    [row.id, cited.id, other.id],
  );
  return { id: row.id, articleId: article.id, chunkId: cited.id };
}
